import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { Repository } from "typeorm";
import { Region } from "../../database/entities";
import { JwtGuard } from "../../common/guards/jwt.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";

class RegionQuery {
  /** province | regency | district — default province. */
  @IsOptional()
  @IsString()
  level?: string;

  /** Kode BPS induk (regency butuh provinceCode, district butuh regencyCode). */
  @IsOptional()
  @IsString()
  parent_code?: string;
}

/**
 * Wilayah hierarkis (dari schools.csv). Dipakai wizard voter: pilih provinsi →
 * kabupaten → kecamatan (dependent dropdown). Publik (tak butuh login).
 */
@Controller("public/regions")
export class PublicRegionsController {
  constructor(
    @InjectRepository(Region) private readonly regions: Repository<Region>,
  ) {}

  @Get()
  async list(@Query() q: RegionQuery) {
    const level = (q.level as Region["level"]) || "province";
    const qb = this.regions
      .createQueryBuilder("r")
      .where("r.level = :level", { level })
      .orderBy("r.name", "ASC");
    if (q.parent_code) {
      qb.andWhere(
        "r.parent_id = (select id from regions where code = :pc)",
        { pc: q.parent_code },
      );
    }
    return qb.getMany();
  }
}

class CreateRegionDto {
  @IsString()
  @MinLength(2, { message: "Nama kabupaten minimal 2 karakter" })
  @MaxLength(100)
  name!: string;

  /** Provinsi induk (opsional, hanya label bila dikirim). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  province?: string;
}

/**
 * Admin: sebagian besar wilayah berasal dari import CSV, tapi kabupaten/kota
 * yang belum ada boleh ditambah manual (mis. saat memetakan sekolah yang
 * NPSN-nya tak ada di master). Region manual dapat kode sintetis "MAN-...".
 */
@Controller("admin/regions")
@UseGuards(JwtGuard, RolesGuard)
@Roles("admin")
export class RegionsController {
  constructor(
    @InjectRepository(Region) private readonly regions: Repository<Region>,
  ) {}

  @Get()
  list(@Query() q: RegionQuery) {
    const level = (q.level as Region["level"]) || "regency";
    return this.regions.find({ where: { level }, order: { name: "ASC" } });
  }

  @Post()
  async create(@Body() dto: CreateRegionDto) {
    const name = dto.name.trim();
    // Idempoten: kalau nama kabupaten sudah ada, pakai yang itu.
    const existing = await this.regions
      .createQueryBuilder("r")
      .where("r.level = :lvl", { lvl: "regency" })
      .andWhere("LOWER(r.name) = LOWER(:name)", { name })
      .getOne();
    if (existing) return existing;

    // Kode sintetis unik untuk region manual (kolom code unik & wajib).
    const code = "MAN-" + name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").slice(0, 40);
    const clash = await this.regions.findOneBy({ code });
    if (clash) throw new ConflictException("Kabupaten sudah ada.");

    return this.regions.save(
      this.regions.create({ name, code, level: "regency", parentId: null }),
    );
  }

  @Delete(":id")
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    const region = await this.regions.findOneBy({ id });
    if (!region) throw new NotFoundException("Kabupaten tidak ditemukan.");
    // Hanya region manual (kode sintetis) yang boleh dihapus — data master
    // dari CSV dilindungi agar peta wilayah tak rusak.
    if (!region.code.startsWith("MAN-")) {
      throw new BadRequestException(
        "Kabupaten dari data master tidak bisa dihapus.",
      );
    }
    await this.regions.delete({ id });
    return { ok: true };
  }
}
