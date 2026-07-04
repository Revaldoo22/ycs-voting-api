import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from "class-validator";
import { BadRequestException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import {
  Participant,
  ParticipantContent,
  Profile,
} from "../../database/entities";
import { hashPassword } from "../../common/utils/password";
import { JwtGuard, JwtPayload } from "../../common/guards/jwt.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";

class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;
}

class UpdatePhotoDto {
  @IsUrl({ require_tld: false }, { message: "URL foto tidak valid." })
  photo_url!: string;
}

class ChangePasswordDto {
  @IsString()
  @MaxLength(72)
  password!: string;
}

class ContentDto {
  @IsIn(["engage", "sound"])
  kind!: "engage" | "sound";

  @IsUrl({}, { message: "Link tidak valid" })
  url!: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  label?: string;
}

/** Old path parity: /api/participant/* — the logged-in participant's own data. */
@Controller("participant")
@UseGuards(JwtGuard, RolesGuard)
@Roles("participant")
export class ParticipantSelfController {
  constructor(
    private readonly db: DataSource,
    @InjectRepository(Participant)
    private readonly participants: Repository<Participant>,
    @InjectRepository(ParticipantContent)
    private readonly contents: Repository<ParticipantContent>,
  ) {}

  private async myParticipant(user: JwtPayload): Promise<Participant> {
    const p = await this.participants.findOneBy({ profileId: user.sub });
    if (!p) throw new NotFoundException("Akun ini tidak tertaut dengan peserta.");
    return p;
  }

  /** Participant row + school + profile (old dashboard bootstrap). */
  @Get("me")
  async me(@CurrentUser() user: JwtPayload) {
    const rows = await this.db.query(
      `select p.*,
              case when s.id is null then null
                   else json_build_object('id', s.id, 'name', s.name) end as schools,
              json_build_object('id', pr.id, 'name', pr.name,
                                'phone_number', pr.phone_number, 'role', pr.role,
                                'school_id', pr.school_id, 'created_at', pr.created_at)
                as profile
       from participants p
       left join schools s on s.id = p.school_id
       join profiles pr on pr.id = p.profile_id
       where p.profile_id = $1`,
      [user.sub],
    );
    if (!rows[0])
      throw new NotFoundException("Akun ini tidak tertaut dengan peserta.");
    return rows[0];
  }

  @Post("profile")
  async updateProfile(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateProfileDto,
  ) {
    const p = await this.myParticipant(user);
    p.description = dto.description?.trim() || null;
    await this.participants.save(p);
    return { ok: true };
  }

  @Post("photo")
  async updatePhoto(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdatePhotoDto,
  ) {
    const p = await this.myParticipant(user);
    p.photoUrl = dto.photo_url;
    await this.participants.save(p);
    return { ok: true };
  }

  @Post("password")
  async changePassword(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ChangePasswordDto,
  ) {
    if (dto.password.length < 6) {
      throw new BadRequestException("Password minimal 6 karakter.");
    }
    await this.db
      .getRepository(Profile)
      .update({ id: user.sub }, { passwordHash: hashPassword(dto.password) });
    return { ok: true };
  }

  @Get("contents")
  async myContents(@CurrentUser() user: JwtPayload) {
    const p = await this.myParticipant(user);
    return this.contents.find({
      where: { participantId: p.id },
      order: { createdAt: "DESC" },
    });
  }

  @Post("contents")
  async addContent(@CurrentUser() user: JwtPayload, @Body() dto: ContentDto) {
    const p = await this.myParticipant(user);
    return this.contents.save(
      this.contents.create({
        participantId: p.id,
        kind: dto.kind,
        url: dto.url.trim(),
        label: dto.label?.trim() || null,
      }),
    );
  }

  @Delete("contents/:id")
  async removeContent(
    @CurrentUser() user: JwtPayload,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    const p = await this.myParticipant(user);
    const res = await this.contents.delete({ id, participantId: p.id });
    if (!res.affected) throw new NotFoundException("Konten tidak ditemukan.");
    return { ok: true };
  }
}
