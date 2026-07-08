import {
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import {
  Participant,
  ParticipantContent,
  Profile,
  Region,
  School,
} from "../../database/entities";
import { ApiKeyGuard } from "../../common/guards/api-key.guard";
import { normalizePhone } from "../../common/utils/normalize";
import { SchoolsService } from "../schools/schools.service";

class UpsertParticipantDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  /** Kunci idempoten: kirim 2x nomor sama = update, bukan duplikat. */
  @IsString()
  @MinLength(8)
  @MaxLength(20)
  @Matches(/^[0-9+\-\s().]+$/)
  phone_number!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(150)
  school_name!: string;

  /** Kode BPS kabupaten (opsional) — sekolah baru langsung terpetakan. */
  @IsOptional()
  @IsString()
  @MaxLength(10)
  region_code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  photo_url?: string;

  @IsOptional()
  @IsIn(["active", "inactive"])
  status?: "active" | "inactive";
}

class ChangePhoneDto {
  @IsString()
  @MinLength(8)
  @MaxLength(20)
  @Matches(/^[0-9+\-\s().]+$/)
  new_phone!: string;
}

/** Update peserta by ID — semua field opsional; hanya yang dikirim diubah. */
class UpdateParticipantDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(20)
  @Matches(/^[0-9+\-\s().]+$/)
  phone_number?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  school_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  region_code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  photo_url?: string;

  @IsOptional()
  @IsIn(["active", "inactive"])
  status?: "active" | "inactive";
}

/**
 * Sinkron peserta dari web kedua (master). Di-address pakai EMAIL (kunci
 * idempoten). Create kalau baru, update kalau email sudah ada. Email juga
 * dasar pencocokan voter (voter SSO email sama = peserta ini).
 */
class SyncParticipantDto {
  @IsEmail({}, { message: "Email tidak valid" })
  @MaxLength(150)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  external_id?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(20)
  @Matches(/^[0-9+\-\s().]+$/)
  phone_number!: string;

  /** NPSN sekolah (dari data master) — WAJIB. Dari NPSN, kabupaten & provinsi
   *  otomatis terisi (tak perlu region_code). 8 digit angka. */
  @IsString({ message: "npsn wajib diisi." })
  @Matches(/^\d{8}$/, { message: "npsn harus 8 digit angka." })
  npsn!: string;

  /** Nama sekolah — cadangan tampilan bila NPSN belum ada di master. */
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  school_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  region_code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  photo_url?: string;

  @IsOptional()
  @IsIn(["active", "inactive"])
  status?: "active" | "inactive";
}

/** Upsert sekolah by nama (case-insensitive) + petakan kabupaten. */
class UpsertSchoolDto {
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  region_code?: string;
}

class ContentItemDto {
  @IsIn(["engage", "sound"])
  kind!: "engage" | "sound";

  @IsUrl()
  url!: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  label?: string;
}

class SyncContentsDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ContentItemDto)
  contents!: ContentItemDto[];
}

/**
 * API server-ke-server untuk aplikasi kedua (pendaftaran). Aplikasi itu
 * jadi sumber utama data peserta; admin di sini tetap bisa create/update
 * sebagai cadangan. Semua endpoint idempoten by nomor WA.
 */
@Controller("integrations")
@UseGuards(ApiKeyGuard)
export class IntegrationsController {
  constructor(
    private readonly db: DataSource,
    @InjectRepository(Participant)
    private readonly participants: Repository<Participant>,
    @InjectRepository(Profile)
    private readonly profiles: Repository<Profile>,
    @InjectRepository(Region)
    private readonly regions: Repository<Region>,
    @InjectRepository(ParticipantContent)
    private readonly contents: Repository<ParticipantContent>,
    private readonly schools: SchoolsService,
  ) {}

  private async findByPhone(phone: string) {
    const profile = await this.profiles.findOneBy({
      phoneNumber: normalizePhone(phone),
      role: "participant",
    });
    if (!profile) return null;
    return this.participants.findOneBy({ profileId: profile.id });
  }

  /**
   * Resolusi sekolah untuk sync peserta. Prioritas:
   *   1. `npsn` → cocokkan sekolah master (dari CSV) — region/kabupaten sudah
   *      terisi otomatis. Paling andal.
   *   2. `name` → find-or-create by nama; petakan kabupaten via `regionCode`
   *      kalau dikirim.
   */
  private async resolveSchool(opts: {
    npsn?: string;
    name?: string;
    regionCode?: string;
  }) {
    // 1. by NPSN — sekolah master, region sudah ikut. NPSN dinormalisasi
    // (buang non-digit) agar spasi/format kecil tak bikin gagal cocok.
    const npsn = (opts.npsn ?? "").replace(/\D/g, "");
    if (npsn) {
      const master = await this.db
        .getRepository(School)
        .findOneBy({ npsn });
      if (master) return master;
    }
    // 2. by nama (find-or-create) + petakan region.
    const name = (opts.name ?? "").trim();
    if (!name) return null;
    const school = await this.schools.createOrGet({ name });

    // Jaring pengaman region kalau sekolah (baru/lama) belum punya region:
    if (!school.regionId) {
      let regionId: string | null = null;
      // a. dari regionCode (kode BPS) bila dikirim.
      if (opts.regionCode) {
        const region = await this.regions.findOneBy({ code: opts.regionCode });
        regionId = region?.id ?? null;
      }
      // b. warisi region dari sekolah master yang namanya cocok (NPSN salah/
      //    kosong tapi nama ada di master) — supaya kabupaten tetap terisi.
      if (!regionId) {
        const rows = (await this.db.query(
          `select region_id from schools
             where npsn is not null and region_id is not null
               and upper(regexp_replace(name, '\\s+', ' ', 'g'))
                 = upper(regexp_replace($1, '\\s+', ' ', 'g'))
             limit 1`,
          [name],
        )) as { region_id: string }[];
        regionId = rows[0]?.region_id ?? null;
      }
      if (regionId) {
        school.regionId = regionId;
        await this.db.getRepository(School).save(school);
      }
    }
    return school;
  }

  /**
   * Sinkron peserta dari web kedua (master) by EMAIL.
   * Web kedua = sumber data; sini replika. Create bila email baru, update
   * bila email sudah ada. Email juga jadi dasar pencocokan voter (voter SSO
   * dengan email sama = peserta ini → tak boleh vote dirinya).
   */
  @Post("participants/sync")
  async syncParticipant(@Body() dto: SyncParticipantDto) {
    const phone = normalizePhone(dto.phone_number);
    const email = dto.email.trim().toLowerCase();

    // NPSN wajib cocok sekolah master → kabupaten/provinsi dijamin terisi.
    const npsn = dto.npsn.replace(/\D/g, "");
    const master = await this.db.getRepository(School).findOneBy({ npsn });
    if (!master) {
      throw new ConflictException(
        `NPSN ${dto.npsn} tidak ditemukan di data master sekolah.`,
      );
    }
    const school = master;

    // Kunci: email peserta. Adopsi peserta lama by nomor kalau email belum ada.
    let participant = await this.participants.findOneBy({ email });
    if (!participant) {
      const byPhone = await this.findByPhone(phone);
      if (byPhone) participant = byPhone;
    }

    // Profil VOTER dengan email sama → di-UPGRADE jadi peserta (bukan ditolak).
    // Orang yang sudah daftar sebagai voter lalu mendaftarkan diri jadi peserta:
    // akunnya sama, role naik voter → participant, dan dibuatkan record peserta
    // yang menaut ke profil itu. Data vote/onboarding lamanya tetap.
    const emailProfile = await this.profiles.findOneBy({ email });
    if (
      !participant &&
      emailProfile &&
      emailProfile.role === "voter"
    ) {
      emailProfile.role = "participant";
      const existingPart = await this.participants.findOneBy({
        profileId: emailProfile.id,
      });
      participant = existingPart ?? this.participants.create({
        profileId: emailProfile.id,
      });
    }

    // Nomor WA tak boleh dipakai profil LAIN (selain peserta/akun ini).
    const phoneClash = await this.profiles.findOneBy({ phoneNumber: phone });
    if (
      phoneClash &&
      phoneClash.id !== participant?.profileId &&
      phoneClash.id !== emailProfile?.id
    ) {
      throw new ConflictException("Nomor WhatsApp sudah dipakai akun lain.");
    }

    if (participant) {
      participant.email = email;
      if (dto.external_id !== undefined) participant.externalId = dto.external_id;
      participant.name = dto.name.trim();
      participant.schoolId = school?.id ?? null;
      participant.description = dto.description?.trim() || null;
      if (dto.photo_url !== undefined) participant.photoUrl = dto.photo_url;
      if (dto.status !== undefined) participant.status = dto.status;
      const saved = await this.participants.save(participant);
      if (participant.profileId) {
        await this.profiles.update(
          { id: participant.profileId },
          {
            name: dto.name.trim(),
            phoneNumber: phone,
            email,
            schoolId: school?.id ?? null,
            // Pastikan profil (mis. voter yg di-upgrade) berperan peserta.
            role: "participant",
          },
        );
      }
      return { created: false, participant: saved };
    }

    // Peserta baru: profil + participant. Email disimpan di keduanya.
    const created = await this.db.transaction(async (em) => {
      const profile = await em.getRepository(Profile).save({
        name: dto.name.trim(),
        phoneNumber: phone,
        email,
        role: "participant" as const,
        schoolId: school?.id ?? null,
      });
      return em.getRepository(Participant).save({
        email,
        externalId: dto.external_id ?? null,
        profileId: profile.id,
        name: dto.name.trim(),
        schoolId: school?.id ?? null,
        description: dto.description?.trim() || null,
        photoUrl: dto.photo_url ?? null,
        status: dto.status ?? ("active" as const),
      });
    });
    return { created: true, participant: created };
  }

  /** Snapshot peserta by email (verifikasi replikasi). */
  @Get("participants/by-email/:email")
  async getByEmail(@Param("email") emailParam: string) {
    const email = emailParam.trim().toLowerCase();
    const participant = await this.participants.findOneBy({ email });
    if (!participant) throw new NotFoundException("Peserta tidak ditemukan.");
    const contents = await this.contents.findBy({
      participantId: participant.id,
    });
    // Sertakan ringkasan (id link, stats voter/poin, peringkat) — sama seperti
    // by-name, tapi email jadi kunci yang unik & tak ambigu.
    const summary = await this.participantSummary(participant.id);
    return { ...summary, participant, contents };
  }

  /**
   * Cari peserta by nama (untuk web kedua bikin link view voting).
   * Return id (untuk /peserta/{id}), stats akun (voter unik + total poin),
   * dan peringkat di sekolah / kabupaten / nasional.
   * Cocokkan case-insensitive; kalau nama ganda → 409 (pakai email/id lain).
   */
  @Get("participants/by-name/:name")
  async getByName(@Param("name") nameParam: string) {
    const name = nameParam.trim();
    if (name.length < 2)
      throw new NotFoundException("Nama terlalu pendek.");
    const matches = await this.participants
      .createQueryBuilder("p")
      .where("lower(p.name) = lower(:name)", { name })
      .getMany();
    if (matches.length === 0)
      throw new NotFoundException("Peserta tidak ditemukan.");
    if (matches.length > 1)
      throw new ConflictException(
        "Nama ini terdaftar lebih dari satu peserta. Gunakan endpoint by-email.",
      );
    return this.participantSummary(matches[0].id);
  }

  /** Ringkasan + peringkat satu peserta by id. Dipakai getByName. */
  private async participantSummary(participantId: string) {
    // Stats voter unik (distinct nomor WA) untuk peserta ini.
    const stats = (
      (await this.db.query(
        `select count(distinct voter_phone)::int as voters,
                count(*)::int as votes
           from daily_votes where participant_id = $1`,
        [participantId],
      )) as { voters: number; votes: number }[]
    )[0] ?? { voters: 0, votes: 0 };

    // Peringkat: rank by total_points DESC (id sebagai tiebreak deterministik)
    // di tiga lingkup — nasional, kabupaten (region sekolah), sekolah.
    const rank = (
      (await this.db.query(
        `with ranked as (
           select p.id, p.name, p.total_points, p.school_id, s.region_id,
             rank() over (order by p.total_points desc, p.id)::int as nat,
             rank() over (
               partition by s.region_id order by p.total_points desc, p.id
             )::int as reg,
             rank() over (
               partition by p.school_id order by p.total_points desc, p.id
             )::int as sch
           from participants p
           left join schools s on s.id = p.school_id
           where p.status = 'active'
         ),
         counts as (
           select
             (select count(*) from ranked)::int as nat_total,
             (select count(*) from ranked r2 where r2.region_id
                = (select region_id from ranked where id = $1))::int as reg_total,
             (select count(*) from ranked r3 where r3.school_id
                = (select school_id from ranked where id = $1))::int as sch_total
         )
         select r.name, r.total_points, r.school_id, r.region_id,
                r.nat, r.reg, r.sch,
                c.nat_total, c.reg_total, c.sch_total
           from ranked r, counts c
          where r.id = $1`,
        [participantId],
      )) as {
        name: string;
        total_points: number;
        school_id: string | null;
        region_id: string | null;
        nat: number;
        reg: number;
        sch: number;
        nat_total: number;
        reg_total: number;
        sch_total: number;
      }[]
    )[0];

    if (!rank) throw new NotFoundException("Peserta tidak ditemukan.");

    // Nama sekolah & kabupaten untuk label di web kedua.
    const loc = (
      (await this.db.query(
        `select s.name as school_name, r.name as regency_name
           from schools s
           left join regions r on r.id = s.region_id
          where s.id = $1`,
        [rank.school_id],
      )) as { school_name: string; regency_name: string | null }[]
    )[0];

    return {
      id: participantId,
      name: rank.name,
      view_url: `https://idola.stekom.ac.id/peserta/${participantId}`,
      school_name: loc?.school_name ?? null,
      regency_name: loc?.regency_name ?? null,
      stats: {
        total_points: rank.total_points,
        voters: stats.voters,
        votes: stats.votes,
      },
      rank: {
        school: rank.school_id
          ? { position: rank.sch, total: rank.sch_total }
          : null,
        regency: rank.region_id
          ? { position: rank.reg, total: rank.reg_total }
          : null,
        national: { position: rank.nat, total: rank.nat_total },
      },
    };
  }

  // ── Leaderboard (untuk ditampilkan di web pendaftaran) ──────────────
  private clampLimit(raw?: string) {
    const n = Number(raw ?? 50);
    return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 1), 200) : 50;
  }

  /** Peringkat peserta by total poin (nasional). */
  @Get("leaderboard/participants")
  async leaderboardParticipants(@Query("limit") limit?: string) {
    const rows = (await this.db.query(
      `select
         row_number() over (order by p.total_points desc, p.id)::int as position,
         p.id, p.name, p.total_points::int as total_points,
         s.name as school_name, r.name as regency_name,
         (select count(distinct voter_phone) from daily_votes dv
            where dv.participant_id = p.id)::int as voters
       from participants p
       left join schools s on s.id = p.school_id
       left join regions r on r.id = s.region_id
       where p.status = 'active'
       order by p.total_points desc, p.id
       limit $1`,
      [this.clampLimit(limit)],
    )) as unknown[];
    return { count: rows.length, leaderboard: rows };
  }

  /** Peringkat sekolah by akumulasi poin peserta-pesertanya. */
  @Get("leaderboard/schools")
  async leaderboardSchools(@Query("limit") limit?: string) {
    const rows = (await this.db.query(
      `with agg as (
         select s.id, s.name, r.name as regency_name,
                count(p.id)::int as participants,
                coalesce(sum(p.total_points), 0)::int as total_points
         from schools s
         join participants p on p.school_id = s.id and p.status = 'active'
         left join regions r on r.id = s.region_id
         group by s.id, s.name, r.name
       )
       select row_number() over (order by total_points desc, name)::int as position,
              id, name as school_name, regency_name, participants, total_points
       from agg
       order by total_points desc, name
       limit $1`,
      [this.clampLimit(limit)],
    )) as unknown[];
    return { count: rows.length, leaderboard: rows };
  }

  /** Peringkat voter/pendukung by skor (vote + quest). */
  @Get("leaderboard/voters")
  async leaderboardVoters(@Query("limit") limit?: string) {
    const rows = (await this.db.query(
      `with v as (
         select voter_phone, max(voter_name) as nm, max(voter_school) as school,
                count(*) as votes, coalesce(sum(points), 0) as pts
         from daily_votes where voter_phone is not null group by voter_phone
       ),
       q as (
         select s.voter_phone, max(s.voter_name) as nm,
                count(*) as quests, coalesce(sum(qu.point), 0) as quest_points
         from submissions s join quests qu on qu.id = s.quest_id
         where s.status = 'approved' and s.voter_phone is not null
         group by s.voter_phone
       ),
       merged as (
         select coalesce(v.nm, q.nm, v.voter_phone, q.voter_phone) as voter_name,
                coalesce(v.school, '') as school_name,
                coalesce(v.votes, 0)::int as votes,
                coalesce(q.quests, 0)::int as quests,
                (coalesce(v.pts, 0) + coalesce(q.quest_points, 0))::int as score
         from v full outer join q on q.voter_phone = v.voter_phone
       )
       select row_number() over (order by score desc)::int as position,
              voter_name, school_name, votes, quests, score
       from merged
       where votes > 0 or quests > 0
       order by score desc
       limit $1`,
      [this.clampLimit(limit)],
    )) as unknown[];
    return { count: rows.length, leaderboard: rows };
  }

  /** Upsert peserta by nomor WA (dipertahankan; kunci = nomor). */
  @Post("participants")
  async upsert(@Body() dto: UpsertParticipantDto) {
    const phone = normalizePhone(dto.phone_number);
    const school = await this.resolveSchool({ name: dto.school_name, regionCode: dto.region_code });

    const existing = await this.findByPhone(phone);
    if (existing) {
      existing.name = dto.name.trim();
      existing.schoolId = school?.id ?? null;
      if (dto.description !== undefined)
        existing.description = dto.description?.trim() || null;
      if (dto.photo_url !== undefined) existing.photoUrl = dto.photo_url;
      if (dto.status !== undefined) existing.status = dto.status;
      const saved = await this.participants.save(existing);
      await this.profiles.update(
        { phoneNumber: phone },
        { name: dto.name.trim(), schoolId: school?.id ?? null },
      );
      return { created: false, participant: saved };
    }

    const participant = await this.db.transaction(async (em) => {
      const profile = await em.getRepository(Profile).save({
        name: dto.name.trim(),
        phoneNumber: phone,
        role: "participant" as const,
        schoolId: school?.id ?? null,
      });
      return em.getRepository(Participant).save({
        profileId: profile.id,
        name: dto.name.trim(),
        schoolId: school?.id ?? null,
        description: dto.description?.trim() || null,
        photoUrl: dto.photo_url ?? null,
        status: dto.status ?? ("active" as const),
      });
    });
    return { created: true, participant };
  }

  /** Snapshot peserta + kontennya (untuk verifikasi sinkron). */
  @Get("participants/:phone")
  async get(@Param("phone") phone: string) {
    const participant = await this.findByPhone(phone);
    if (!participant) throw new NotFoundException("Peserta tidak ditemukan.");
    const contents = await this.contents.findBy({
      participantId: participant.id,
    });
    return { participant, contents };
  }

  /**
   * Ganti nomor WA peserta. Nomor = identitas login + anti-cheat (self-vote),
   * jadi diubah di profiles. Nomor baru harus belum dipakai akun lain.
   */
  @Patch("participants/:phone/phone")
  async changePhone(
    @Param("phone") phone: string,
    @Body() dto: ChangePhoneDto,
  ) {
    const oldPhone = normalizePhone(phone);
    const newPhone = normalizePhone(dto.new_phone);

    const profile = await this.profiles.findOneBy({
      phoneNumber: oldPhone,
      role: "participant",
    });
    if (!profile) throw new NotFoundException("Peserta tidak ditemukan.");

    if (newPhone === oldPhone) {
      return { ok: true, changed: false };
    }

    // Nomor baru tidak boleh sudah dipakai akun lain (peran apa pun).
    const taken = await this.profiles.findOneBy({ phoneNumber: newPhone });
    if (taken) {
      throw new ConflictException("Nomor WhatsApp baru sudah dipakai akun lain.");
    }

    profile.phoneNumber = newPhone;
    await this.profiles.save(profile);
    return { ok: true, changed: true, phone_number: newPhone };
  }

  /**
   * Update peserta by ID (kunci sync andal dari web kedua). Semua field
   * opsional; nomor WA pun bisa diganti di sini (dicek unik).
   */
  @Patch("participants/id/:id")
  async updateById(
    @Param("id") id: string,
    @Body() dto: UpdateParticipantDto,
  ) {
    const participant = await this.participants.findOneBy({ id });
    if (!participant) throw new NotFoundException("Peserta tidak ditemukan.");
    const profile = participant.profileId
      ? await this.profiles.findOneBy({ id: participant.profileId })
      : null;

    // Ganti nomor WA (cek unik lintas akun).
    if (dto.phone_number !== undefined && profile) {
      const newPhone = normalizePhone(dto.phone_number);
      if (newPhone !== profile.phoneNumber) {
        const taken = await this.profiles.findOneBy({ phoneNumber: newPhone });
        if (taken) {
          throw new ConflictException(
            "Nomor WhatsApp sudah dipakai akun lain.",
          );
        }
        profile.phoneNumber = newPhone;
      }
    }

    // Sekolah (find-or-create + petakan kabupaten).
    if (dto.school_name !== undefined) {
      const school = await this.resolveSchool({ name: dto.school_name, regionCode: dto.region_code });
      participant.schoolId = school?.id ?? null;
      if (profile) profile.schoolId = school?.id ?? null;
    }

    if (dto.name !== undefined) {
      participant.name = dto.name.trim();
      if (profile) profile.name = dto.name.trim();
    }
    if (dto.description !== undefined)
      participant.description = dto.description?.trim() || null;
    if (dto.photo_url !== undefined) participant.photoUrl = dto.photo_url;
    if (dto.status !== undefined) participant.status = dto.status;

    if (profile) await this.profiles.save(profile);
    const saved = await this.participants.save(participant);
    return { ok: true, participant: saved };
  }

  /** Daftar kabupaten (untuk web kedua memetakan sekolah ke kabupaten). */
  @Get("regions")
  listRegions() {
    return this.regions.find({ order: { name: "ASC" } });
  }

  /** Upsert sekolah by nama (case-insensitive) + set kabupaten via kode BPS. */
  @Post("schools")
  async upsertSchool(@Body() dto: UpsertSchoolDto) {
    const school = await this.resolveSchool({ name: dto.name, regionCode: dto.region_code });
    return { ok: true, school };
  }

  /** Full-replace konten peserta (dipakai kedua endpoint di bawah). */
  private async replaceContents(participantId: string, dto: SyncContentsDto) {
    await this.db.transaction(async (em) => {
      await em
        .getRepository(ParticipantContent)
        .delete({ participantId });
      if (dto.contents.length > 0) {
        await em.getRepository(ParticipantContent).insert(
          dto.contents.map((c) => ({
            participantId,
            kind: c.kind,
            url: c.url.trim(),
            label: c.label?.trim() || null,
          })),
        );
      }
    });
    return { ok: true, count: dto.contents.length };
  }

  /** Sync konten peserta by EMAIL (utama, konsisten dgn sync peserta). */
  @Put("participants/by-email/:email/contents")
  async syncContentsByEmail(
    @Param("email") emailParam: string,
    @Body() dto: SyncContentsDto,
  ) {
    const email = emailParam.trim().toLowerCase();
    const participant = await this.participants.findOneBy({ email });
    if (!participant) throw new NotFoundException("Peserta tidak ditemukan.");
    return this.replaceContents(participant.id, dto);
  }

  /** (Legacy) Sync konten by nomor WA. */
  @Put("participants/:phone/contents")
  async syncContents(
    @Param("phone") phone: string,
    @Body() dto: SyncContentsDto,
  ) {
    const participant = await this.findByPhone(phone);
    if (!participant) throw new NotFoundException("Peserta tidak ditemukan.");
    return this.replaceContents(participant.id, dto);
  }
}
