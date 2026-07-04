import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Region, School } from "../../database/entities";
import { JwtGuard } from "../../common/guards/jwt.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";

class RegionDto {
  @IsString()
  @MinLength(2, { message: "Nama kabupaten minimal 2 karakter" })
  @MaxLength(150)
  name!: string;

  /** Kode BPS (opsional) — kunci join ke GeoJSON peta. */
  @IsOptional()
  @IsString()
  @MaxLength(10)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  province?: string;
}

@Controller("admin/regions")
@UseGuards(JwtGuard, RolesGuard)
@Roles("admin")
export class RegionsController {
  constructor(
    @InjectRepository(Region) private readonly regions: Repository<Region>,
    @InjectRepository(School) private readonly schools: Repository<School>,
  ) {}

  @Get()
  list() {
    return this.regions.find({ order: { name: "ASC" } });
  }

  @Post()
  create(@Body() dto: RegionDto) {
    return this.regions.save(
      this.regions.create({
        name: dto.name.trim(),
        code: dto.code?.trim() || null,
        province: dto.province?.trim() || null,
      }),
    );
  }

  @Patch(":id")
  async update(@Param("id", ParseUUIDPipe) id: string, @Body() dto: RegionDto) {
    const region = await this.regions.findOneBy({ id });
    if (!region) throw new NotFoundException("Kabupaten tidak ditemukan.");
    region.name = dto.name.trim();
    if (dto.code !== undefined) region.code = dto.code?.trim() || null;
    if (dto.province !== undefined)
      region.province = dto.province?.trim() || null;
    return this.regions.save(region);
  }

  @Delete(":id")
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    const used = await this.schools.countBy({ regionId: id });
    if (used > 0) {
      throw new ConflictException(
        `Masih ada ${used} sekolah di kabupaten ini.`,
      );
    }
    const res = await this.regions.delete({ id });
    if (!res.affected) throw new NotFoundException("Kabupaten tidak ditemukan.");
    return { ok: true };
  }
}

@Controller("public/regions")
export class PublicRegionsController {
  constructor(
    @InjectRepository(Region) private readonly regions: Repository<Region>,
  ) {}

  @Get()
  list() {
    return this.regions.find({ order: { name: "ASC" } });
  }
}
