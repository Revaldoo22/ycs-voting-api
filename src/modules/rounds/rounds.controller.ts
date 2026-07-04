import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { RoundsService } from "./rounds.service";
import { JwtGuard } from "../../common/guards/jwt.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";

class CreateRoundDto {
  @IsString()
  @MinLength(2, { message: "Nama gelombang minimal 2 karakter" })
  @MaxLength(100)
  name!: string;
}

class CreateFullRoundDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  sequence?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5000)
  top_n?: number;

  @IsOptional()
  @IsIn(["per_region", "global"])
  select_mode?: "per_region" | "global";

  @IsOptional()
  @IsString()
  scheduled_close_at?: string | null;

  @IsOptional()
  @IsBoolean()
  activate?: boolean;
}

class PopulateDto {
  @IsIn(["all", "gugur"])
  source!: "all" | "gugur";

  @IsOptional()
  @IsUUID()
  from_round_id?: string;
}

class UpdateRoundDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  starts_at?: string | null;

  @IsOptional()
  @IsString()
  ends_at?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5000)
  top_n?: number;

  @IsOptional()
  @IsIn(["per_region", "global"])
  select_mode?: "per_region" | "global";

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  sequence?: number;

  @IsOptional()
  @IsString()
  scheduled_close_at?: string | null;
}

class AddSchoolDto {
  @IsUUID()
  school_id!: string;
}

class CloseDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5000)
  top_n?: number;

  @IsOptional()
  @IsIn(["per_region", "global"])
  select_mode?: "per_region" | "global";
}

class BotBoostDto {
  @IsUUID()
  school_id!: string;

  @IsInt()
  @Min(1)
  @Max(10000)
  votes!: number;
}

@Controller("admin/rounds")
@UseGuards(JwtGuard, RolesGuard)
@Roles("admin")
export class RoundsController {
  constructor(private readonly rounds: RoundsService) {}

  @Get()
  list() {
    return this.rounds.list();
  }

  @Post()
  create(@Body() dto: CreateRoundDto) {
    return this.rounds.create(dto.name);
  }

  @Post("full")
  createFull(@Body() dto: CreateFullRoundDto) {
    return this.rounds.createFull(dto);
  }

  @Get(":id/standings")
  standings(@Param("id", ParseUUIDPipe) id: string) {
    return this.rounds.standings(id);
  }

  @Post(":id/populate")
  populate(@Param("id", ParseUUIDPipe) id: string, @Body() dto: PopulateDto) {
    return this.rounds.populate(id, dto.source, dto.from_round_id);
  }

  @Patch(":id")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateRoundDto) {
    return this.rounds.updateSettings(id, dto);
  }

  @Get(":id/schools")
  roundSchools(@Param("id", ParseUUIDPipe) id: string) {
    return this.rounds.roundSchoolList(id);
  }

  @Post(":id/schools")
  addSchool(@Param("id", ParseUUIDPipe) id: string, @Body() dto: AddSchoolDto) {
    return this.rounds.addSchool(id, dto.school_id);
  }

  @Delete(":id/schools/:schoolId")
  removeSchool(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("schoolId", ParseUUIDPipe) schoolId: string,
  ) {
    return this.rounds.removeSchool(id, schoolId);
  }

  @Post(":id/activate")
  activate(@Param("id", ParseUUIDPipe) id: string) {
    return this.rounds.activate(id);
  }

  @Post(":id/close")
  close(@Param("id", ParseUUIDPipe) id: string, @Body() dto: CloseDto) {
    return this.rounds.close(id, dto.top_n, dto.select_mode);
  }

  @Post(":id/bot-boost")
  botBoost(@Param("id", ParseUUIDPipe) id: string, @Body() dto: BotBoostDto) {
    return this.rounds.botBoost(id, dto.school_id, dto.votes);
  }

  @Delete(":id/bot-boost")
  removeBotVotes(@Param("id", ParseUUIDPipe) id: string) {
    return this.rounds.removeBotVotes(id);
  }

  @Delete(":id")
  remove(@Param("id", ParseUUIDPipe) id: string) {
    return this.rounds.remove(id);
  }
}

/** Endpoint publik: heatmap + round berjalan. */
@Controller("public")
export class PublicRoundsController {
  constructor(private readonly rounds: RoundsService) {}

  @Get("heatmap")
  heatmap() {
    return this.rounds.heatmap();
  }

  @Get("school-rankings")
  schoolRankings(@Query("region_id") regionId?: string) {
    return this.rounds.schoolRankings(regionId || undefined);
  }

  @Get("schools/:id/detail")
  schoolDetail(@Param("id", ParseUUIDPipe) id: string) {
    return this.rounds.schoolDetail(id);
  }

  @Get("active-round")
  async activeRound() {
    return (await this.rounds.active()) ?? null;
  }

  /** Daftar gelombang untuk halaman hasil publik (tanpa draft kosong). */
  @Get("rounds")
  publicRounds() {
    return this.rounds.publicList();
  }

  /** Klasemen/hasil satu gelombang — publik (live saat aktif, final saat tutup). */
  @Get("rounds/:id/results")
  results(@Param("id", ParseUUIDPipe) id: string) {
    return this.rounds.standings(id);
  }
}
