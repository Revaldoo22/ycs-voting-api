import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { IsOptional, IsString } from "class-validator";
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

/** Admin: read-only (data wilayah berasal dari import CSV, bukan input manual). */
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
}
