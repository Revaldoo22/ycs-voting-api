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
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Quest } from "../../database/entities";
import { JwtGuard } from "../../common/guards/jwt.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { NotFoundException } from "@nestjs/common";

class QuestDto {
  @IsString()
  @MinLength(2, { message: "Nama quest minimal 2 karakter" })
  @MaxLength(150)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsInt()
  @Min(0, { message: "Poin tidak boleh negatif" })
  @Max(1000)
  point!: number;

  @IsOptional()
  @IsIn(["active", "inactive"])
  status?: "active" | "inactive";

  @IsOptional()
  @IsIn(["link", "file"])
  proof_type?: "link" | "file";

  @IsOptional()
  @IsIn(["once", "daily", "global"])
  frequency?: "once" | "daily" | "global";

  @IsOptional()
  @IsIn(["engage", "sound"])
  content_kind?: "engage" | "sound" | null;

  @IsOptional()
  @IsUrl({ require_tld: false }, { message: "Link tidak valid" })
  ref_link?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  ref_image?: string;
}

function toEntity(dto: Partial<QuestDto>) {
  return {
    ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
    ...(dto.description !== undefined
      ? { description: dto.description?.trim() || null }
      : {}),
    ...(dto.point !== undefined ? { point: dto.point } : {}),
    ...(dto.status !== undefined ? { status: dto.status } : {}),
    ...(dto.proof_type !== undefined ? { proofType: dto.proof_type } : {}),
    ...(dto.frequency !== undefined ? { frequency: dto.frequency } : {}),
    ...(dto.content_kind !== undefined ? { contentKind: dto.content_kind } : {}),
    ...(dto.ref_link !== undefined ? { refLink: dto.ref_link || null } : {}),
    ...(dto.ref_image !== undefined ? { refImage: dto.ref_image || null } : {}),
  };
}

@Controller("admin/quests")
@UseGuards(JwtGuard, RolesGuard)
@Roles("admin")
export class QuestsController {
  constructor(
    @InjectRepository(Quest) private readonly quests: Repository<Quest>,
  ) {}

  @Get()
  list() {
    return this.quests.find({ order: { createdAt: "ASC" } });
  }

  @Post()
  create(@Body() dto: QuestDto) {
    return this.quests.save(this.quests.create(toEntity(dto)));
  }

  @Patch(":id")
  async update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: QuestDto,
  ) {
    const quest = await this.quests.findOneBy({ id });
    if (!quest) throw new NotFoundException("Quest tidak ditemukan.");
    Object.assign(quest, toEntity(dto));
    return this.quests.save(quest);
  }

  @Delete(":id")
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    const res = await this.quests.delete({ id });
    if (!res.affected) throw new NotFoundException("Quest tidak ditemukan.");
    return { ok: true };
  }
}
