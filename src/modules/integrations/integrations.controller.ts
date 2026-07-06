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

  /** NPSN sekolah (dari data master). Kalau cocok, kabupaten/provinsi otomatis
   *  ikut — tak perlu region_code. Paling direkomendasikan. */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  npsn?: string;

  /** Nama sekolah — dipakai kalau npsn tak dikirim/tak cocok (find-or-create). */
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
    // 1. by NPSN — sekolah master, region sudah ikut.
    if (opts.npsn?.trim()) {
      const master = await this.db
        .getRepository(School)
        .findOneBy({ npsn: opts.npsn.trim() });
      if (master) return master;
    }
    // 2. by nama (find-or-create) + petakan region opsional.
    const name = (opts.name ?? "").trim();
    if (!name) return null;
    const school = await this.schools.createOrGet({ name });
    if (opts.regionCode && !school.regionId) {
      const region = await this.regions.findOneBy({ code: opts.regionCode });
      if (region) {
        school.regionId = region.id;
        await this.db.getRepository("schools").save(school);
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
    const school = await this.resolveSchool({
      npsn: dto.npsn,
      name: dto.school_name,
      regionCode: dto.region_code,
    });

    // Kunci: email peserta. Adopsi peserta lama by nomor kalau email belum ada.
    let participant = await this.participants.findOneBy({ email });
    if (!participant) {
      const byPhone = await this.findByPhone(phone);
      if (byPhone) participant = byPhone;
    }

    // Nomor WA tak boleh dipakai profil LAIN (selain peserta ini).
    const phoneClash = await this.profiles.findOneBy({ phoneNumber: phone });
    if (phoneClash && (!participant || phoneClash.id !== participant.profileId)) {
      throw new ConflictException("Nomor WhatsApp sudah dipakai akun lain.");
    }
    // Email peserta tak boleh == email VOTER lain (bentrok identitas).
    const emailClash = await this.profiles.findOneBy({ email });
    if (
      emailClash &&
      emailClash.role !== "participant" &&
      (!participant || emailClash.id !== participant.profileId)
    ) {
      throw new ConflictException("Email sudah dipakai akun voter lain.");
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
    return { participant, contents };
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
