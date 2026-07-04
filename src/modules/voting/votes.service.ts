import { ConflictException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { Coupon, DailyVote, Participant, Profile } from "../../database/entities";
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

  /** Port of cast_vote v3 (migration 0022) — same checks, same error codes. */
  async cast(
    d: CastVoteDto,
    serverHash: string | null,
    ipHash: string | null,
  ) {
    const kind = d.kind ?? "daily5";
    const points = kind === "fav20" ? 20 : 5;
    const phone = d.phone_number.trim();
    const email = d.email.trim().toLowerCase();

    if (!(await this.settings.isEventOpen())) throw new VoteError("EVENTCLOSED");

    const participant = await this.participants.findOneBy({
      id: d.participant_id,
      status: "active",
    });
    if (!participant) throw new VoteError("NOTFOUND");

    // Self-vote block (participant's own WhatsApp number).
    const pPhone = await this.antiCheat.participantPhone(d.participant_id);
    if (pPhone !== null && pPhone === phone) throw new VoteError("SELFVOTE");

    // One WhatsApp number = one name.
    if (await this.antiCheat.phoneNameConflict(phone, d.name)) {
      throw new VoteError("PHONE_NAME");
    }

    // Already voted this participant today with this kind (device/phone/email)?
    const dup = await this.votes
      .createQueryBuilder("dv")
      .where("dv.participant_id = :pid", { pid: d.participant_id })
      .andWhere("dv.vote_date = CURRENT_DATE")
      .andWhere("dv.vote_kind = :kind", { kind })
      .andWhere(
        "(dv.device_fingerprint = :fp OR dv.voter_phone = :phone OR dv.voter_email = :email)",
        { fp: d.fingerprint, phone, email },
      )
      .getExists();
    if (dup) throw new VoteError("ALREADYVOTED");

    // fav20: max 10 distinct participants per voter (by phone) per day.
    if (kind === "fav20") {
      const used = await this.votes
        .createQueryBuilder("dv")
        .select("COUNT(DISTINCT dv.participant_id)", "c")
        .where("dv.vote_kind = 'fav20'")
        .andWhere("dv.vote_date = CURRENT_DATE")
        .andWhere("dv.voter_phone = :phone", { phone })
        .getRawOne<{ c: string }>();
      if (Number(used?.c ?? 0) >= 10) throw new VoteError("FAV_LIMIT");
    }

    // IP soft-limit (cross-kind, distinct emails per hashed IP per day).
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

    // Gate follow (harian): voter ber-akun wajib pernah konfirmasi follow
    // akun Univ STEKOM - cukup SEKALI seumur event, lintas peserta.
    const profile = await this.dataSource
      .getRepository(Profile)
      .findOneBy({ phoneNumber: phone, role: "voter" });
    let grantCoupon = false;
    if (kind === "daily5" && profile && !profile.followedAt) {
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
          voterName: d.name.trim(),
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
