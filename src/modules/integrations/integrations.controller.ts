import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import {
  ArrayMaxSize,
  IsArray,
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

  /** Upsert peserta by nomor WA. Balikan { created, participant }. */
  @Post("participants")
  async upsert(@Body() dto: UpsertParticipantDto) {
    const phone = normalizePhone(dto.phone_number);

    // Sekolah find-or-create; kalau ada region_code, petakan kabupatennya.
    const school = await this.schools.createOrGet({ name: dto.school_name });
    if (dto.region_code && !school.regionId) {
      const region = await this.regions.findOneBy({ code: dto.region_code });
      if (region) {
        school.regionId = region.id;
        await this.db.getRepository("schools").save(school);
      }
    }

    const existing = await this.findByPhone(phone);
    if (existing) {
      existing.name = dto.name.trim();
      existing.schoolId = school.id;
      if (dto.description !== undefined)
        existing.description = dto.description?.trim() || null;
      if (dto.photo_url !== undefined) existing.photoUrl = dto.photo_url;
      if (dto.status !== undefined) existing.status = dto.status;
      const saved = await this.participants.save(existing);
      await this.profiles.update(
        { phoneNumber: phone },
        { name: dto.name.trim(), schoolId: school.id },
      );
      return { created: false, participant: saved };
    }

    const participant = await this.db.transaction(async (em) => {
      const profile = await em.getRepository(Profile).save({
        name: dto.name.trim(),
        phoneNumber: phone,
        role: "participant" as const,
        schoolId: school.id,
      });
      return em.getRepository(Participant).save({
        profileId: profile.id,
        name: dto.name.trim(),
        schoolId: school.id,
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

  /** Full-sync konten peserta (replace seluruh daftar) — idempoten. */
  @Put("participants/:phone/contents")
  async syncContents(
    @Param("phone") phone: string,
    @Body() dto: SyncContentsDto,
  ) {
    const participant = await this.findByPhone(phone);
    if (!participant) throw new NotFoundException("Peserta tidak ditemukan.");

    await this.db.transaction(async (em) => {
      await em
        .getRepository(ParticipantContent)
        .delete({ participantId: participant.id });
      if (dto.contents.length > 0) {
        await em.getRepository(ParticipantContent).insert(
          dto.contents.map((c) => ({
            participantId: participant.id,
            kind: c.kind,
            url: c.url.trim(),
            label: c.label?.trim() || null,
          })),
        );
      }
    });
    return { ok: true, count: dto.contents.length };
  }
}
