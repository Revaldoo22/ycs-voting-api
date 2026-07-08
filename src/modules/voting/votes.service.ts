import { ConflictException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import {
  Coupon,
  DailyVote,
  Participant,
  Profile,
  School,
} from "../../database/entities";
import { SettingsService } from "../settings/settings.service";
import { RoundsService } from "../rounds/rounds.service";
import { AntiCheatService } from "./anti-cheat.service";
import { CastVoteDto } from "./dto/voter-info.dto";

/** Coded errors the controller maps to user-facing messages (old contract). */
export class VoteError extends ConflictException {
  constructor(public readonly code: string) {
    super(code);
  }
}

@Injectable()
export class VotesService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(DailyVote)
    private readonly votes: Repository<DailyVote>,
    @InjectRepository(Participant)
    private readonly participants: Repository<Participant>,
    private readonly settings: SettingsService,
    private readonly antiCheat: AntiCheatService,
    private readonly rounds: RoundsService,
  ) {}

  /**
   * Identitas voter WAJIB dari akun login (SSO Google + wizard selesai).
   * Menolak kalau belum login / belum onboarded / bukan voter. Field
   * identitas (nama/WA/email/status/sekolah/kelas) diambil dari profil,
   * bukan dari body — jadi tak bisa dipalsukan lewat API.
   */
  private async resolveVoter(actorId?: string) {
    if (!actorId) throw new VoteError("LOGIN_REQUIRED");
    const profile = await this.dataSource
      .getRepository(Profile)
      .findOneBy({ id: actorId });
    // Voter maupun peserta (role "participant") boleh vote peserta lain.
    if (!profile || (profile.role !== "voter" && profile.role !== "participant")) {
      throw new VoteError("LOGIN_REQUIRED");
    }

    // Peserta (email akun cocok record peserta) boleh vote peserta lain TANPA
    // onboarding — identitas WA/nama/sekolah diambil dari record peserta itu,
    // status "peserta". Kunci: email (SSO Google). Backend = sumber kebenaran.
    if (!profile.onboarded && profile.email) {
      const rows = (await this.dataSource.query(
        `select p.name, p.school_id, pr.phone_number, s.name as school_name
           from participants p
           join profiles pr on pr.id = p.profile_id
           left join schools s on s.id = p.school_id
          where lower(p.email) = lower($1)
          limit 1`,
        [profile.email],
      )) as {
        name: string;
        school_id: string | null;
        phone_number: string | null;
        school_name: string | null;
      }[];
      const part = rows[0];
      if (part?.phone_number) {
        return {
          profile,
          phone: part.phone_number.trim(),
          email: profile.email.trim().toLowerCase(),
          fields: {
            name: part.name ?? profile.name ?? "",
            phone_number: part.phone_number,
            email: profile.email,
            status: "peserta",
            school: part.school_name ?? undefined,
            class: undefined,
          },
        };
      }
    }

    if (!profile.onboarded || !profile.phoneNumber || !profile.email) {
      throw new VoteError("ONBOARDING_REQUIRED");
    }
    const school = profile.schoolId
      ? await this.dataSource
          .getRepository(School)
          .findOneBy({ id: profile.schoolId })
      : null;
    return {
      profile,
      phone: profile.phoneNumber.trim(),
      email: profile.email.trim().toLowerCase(),
      fields: {
        name: profile.name ?? "",
        phone_number: profile.phoneNumber,
        email: profile.email,
        status: (profile.voterStatus ?? "teman_luar") as string,
        school: school?.name ?? undefined,
        class: profile.voterClass ?? undefined,
      },
    };
  }

  /**
   * Cast vote. Aturan: 1 email/akun = 1 vote SEUMUR EVENT (bukan harian,
   * bukan per peserta). Sekali vote sukses, akun itu tak bisa vote lagi ke
   * peserta manapun. Setiap vote menambah +1 poin ke peserta.
   */
  async cast(
    d: CastVoteDto,
    serverHash: string | null,
    ipHash: string | null,
    actorId?: string,
  ) {
    const kind = "daily5";
    const points = 1;

    // Identitas voter WAJIB dari akun login (SSO + wizard), bukan dari body.
    // Body hanya menyumbang participant_id, fingerprint, kind, follow proof.
    const identity = await this.resolveVoter(actorId);
    const phone = identity.phone;
    const email = identity.email;
    const name = identity.fields.name;
    d = { ...d, ...identity.fields };

    if (!(await this.settings.isEventOpen())) throw new VoteError("EVENTCLOSED");

    const participant = await this.participants.findOneBy({
      id: d.participant_id,
      status: "active",
    });
    if (!participant) throw new VoteError("NOTFOUND");

    // Self-vote block: voter tak boleh vote peserta yang email/WA-nya = miliknya.
    if (await this.antiCheat.isSelfVote(d.participant_id, email, phone)) {
      throw new VoteError("SELFVOTE");
    }

    // One WhatsApp number = one name.
    if (await this.antiCheat.phoneNameConflict(phone, name)) {
      throw new VoteError("PHONE_NAME");
    }

    // 1 akun = 1 vote SEUMUR EVENT. Kalau email/WA/device ini sudah pernah
    // vote (peserta manapun, kapanpun), tolak — tak ada reset harian.
    const dup = await this.votes
      .createQueryBuilder("dv")
      .where(
        "(dv.device_fingerprint = :fp OR dv.voter_phone = :phone OR dv.voter_email = :email)",
        { fp: d.fingerprint, phone, email },
      )
      .getExists();
    if (dup) throw new VoteError("ALREADYVOTED");

    // IP soft-limit (distinct emails per hashed IP per day).
    if (ipHash) {
      const limit = (await this.settings.get()).ipDailyLimit ?? 5;
      const cnt = await this.votes
        .createQueryBuilder("dv")
        .select("COUNT(DISTINCT dv.voter_email)", "c")
        .where("dv.ip_hash = :ipHash", { ipHash })
        .andWhere("dv.vote_date = CURRENT_DATE")
        .getRawOne<{ c: string }>();
      if (Number(cnt?.c ?? 0) >= limit) throw new VoteError("IPLIMIT");
    }

    // Gate follow: voter wajib pernah konfirmasi follow akun Universitas
    // STEKOM sebelum vote apa pun (daily5 & fav20) — cukup SEKALI seumur
    // event, lintas peserta & lintas jenis.
    const profile = identity.profile;
    let grantCoupon = false;
    if (profile && !profile.followedAt) {
      if (!d.follow_confirmed) throw new VoteError("FOLLOW_REQUIRED");
      if (!d.follow_proof_url) throw new VoteError("FOLLOW_PROOF_REQUIRED");
      grantCoupon = true; // follow pertama + vote sukses = kupon undian
    }

    // Stempel gelombang aktif (null bila tidak ada round berjalan).
    const activeRound = await this.rounds.active();
    // Periode gelombang habis → vote ditolak sampai panitia menutup/mengganti.
    if (activeRound?.endsAt && new Date() > activeRound.endsAt) {
      throw new VoteError("ROUND_ENDED");
    }

    // Insert + point bump in one transaction; unique indexes are the final
    // guard against concurrent double-submits (Postgres error 23505).
    try {
      return await this.dataSource.transaction(async (em) => {
        await em.getRepository(DailyVote).insert({
          participantId: d.participant_id,
          roundId: activeRound?.id ?? null,
          deviceFingerprint: d.fingerprint,
          serverHash,
          ipHash,
          voteKind: kind,
          points,
          voterName: name.trim(),
          voterPhone: phone,
          voterEmail: email,
          voterStatus: d.status,
          voterSchool: d.school?.trim() || null,
          voterClass: d.class?.trim() || null,
        });
        await em
          .getRepository(Participant)
          .increment({ id: d.participant_id }, "totalPoints", points);

        // Follow terkonfirmasi: catat + terbitkan kupon undian (sekali).
        if (grantCoupon && profile) {
          await em.getRepository(Profile).update(
            { id: profile.id },
            {
              followedAt: new Date(),
              followProofUrl: d.follow_proof_url ?? null,
            },
          );
          const code =
            "YCS-" +
            Array.from({ length: 2 }, () =>
              Math.random().toString(36).slice(2, 6).toUpperCase(),
            ).join("-");
          await em
            .getRepository(Coupon)
            .createQueryBuilder()
            .insert()
            .values({ profileId: profile.id, code, source: "follow" })
            .orIgnore() // unique (profile, source): idempoten saat race
            .execute();
        }

        return em.getRepository(Participant).findOneBy({ id: d.participant_id });
      });
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        throw new VoteError("ALREADYVOTED");
      }
      throw err;
    }
  }
}
