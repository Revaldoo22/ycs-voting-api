import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from "class-validator";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ParticipantContent } from "../../database/entities";
import { NotFoundException } from "@nestjs/common";
import { ParticipantsService } from "./participants.service";

class AdminContentDto {
  @IsIn(["engage", "sound"])
  kind!: "engage" | "sound";

  @IsUrl({}, { message: "Link tidak valid" })
  url!: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  label?: string;
}
import {
  CreateParticipantDto,
  UpdateParticipantDto,
} from "./dto/participant.dto";
import { JwtGuard } from "../../common/guards/jwt.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";

class GoldenBuzzerDto {
  /** true = tandai Golden Buzzer, false = lepas tandanya. */
  @IsBoolean()
  on!: boolean;
}

/** Old path parity: /api/admin/participants. */
@Controller("admin/participants")
@UseGuards(JwtGuard, RolesGuard)
@Roles("admin")
export class ParticipantsController {
  constructor(
    private readonly participants: ParticipantsService,
    @InjectRepository(ParticipantContent)
    private readonly contents: Repository<ParticipantContent>,
  ) {}

  @Get()
  list() {
    return this.participants.list();
  }

  /** Daftar Golden Buzzer. Sebelum @Patch(":id") agar tak tertangkap UUID. */
  @Get("golden-buzzer")
  goldenBuzzers() {
    return this.participants.goldenBuzzers();
  }

  /** Tandai / lepas Golden Buzzer (langsung lolos, vote ditutup). */
  @Patch(":id/golden-buzzer")
  setGoldenBuzzer(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: GoldenBuzzerDto,
  ) {
    return this.participants.setGoldenBuzzer(id, dto.on);
  }

  @Post()
  create(@Body() dto: CreateParticipantDto) {
    return this.participants.create(dto);
  }

  @Patch(":id")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateParticipantDto,
  ) {
    return this.participants.update(id, dto);
  }

  @Delete(":id")
  remove(@Param("id", ParseUUIDPipe) id: string) {
    return this.participants.remove(id);
  }

  // ---- Konten peserta (fallback admin; sumber utama = app kedua) ----
  @Get(":id/contents")
  listContents(@Param("id", ParseUUIDPipe) id: string) {
    return this.contents.find({
      where: { participantId: id },
      order: { createdAt: "DESC" },
    });
  }

  @Post(":id/contents")
  addContent(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: AdminContentDto,
  ) {
    return this.contents.save(
      this.contents.create({
        participantId: id,
        kind: dto.kind,
        url: dto.url.trim(),
        label: dto.label?.trim() || null,
      }),
    );
  }

  @Delete(":id/contents/:contentId")
  async removeContent(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("contentId", ParseUUIDPipe) contentId: string,
  ) {
    const res = await this.contents.delete({ id: contentId, participantId: id });
    if (!res.affected) throw new NotFoundException("Konten tidak ditemukan.");
    return { ok: true };
  }
}
