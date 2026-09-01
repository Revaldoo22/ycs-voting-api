import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { DataSource } from "typeorm";
import { JwtGuard } from "../../common/guards/jwt.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { NotificationsService } from "./notifications.service";

class BroadcastDto {
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  title!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  body!: string;

  /** Kirim hanya ke akun yang belum jadi peserta. */
  @IsOptional()
  @IsBoolean()
  only_non_participants?: boolean;

  /**
   * Lewati akun yang sudah menerima pengumuman dalam N jam terakhir, supaya
   * tombol yang tertekan dua kali tidak membanjiri lonceng voter.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(720)
  dedupe_hours?: number;
}

/** Pengumuman massal ke akun voter, mis. ajakan mendaftar jadi peserta. */
@Controller("admin/notifications")
@UseGuards(JwtGuard, RolesGuard)
@Roles("admin")
export class NotificationsAdminController {
  constructor(
    private readonly db: DataSource,
    private readonly notifications: NotificationsService,
  ) {}

  /** Perkiraan jumlah penerima, supaya admin tahu dampaknya sebelum kirim. */
  @Get("audience")
  async audience() {
    const [row] = (await this.db.query(
      `select
         count(*) filter (where pr.role = 'voter')::int as total_akun,
         count(*) filter (
           where pr.role = 'voter'
             and not exists (
               select 1 from participants p
               where p.profile_id = pr.id
                  or (pr.email is not null
                      and lower(p.email) = lower(pr.email))
             )
         )::int as belum_peserta
       from profiles pr`,
    )) as { total_akun: number; belum_peserta: number }[];
    return row;
  }

  @Post("broadcast")
  broadcast(@Body() dto: BroadcastDto) {
    return this.notifications.broadcast({
      type: "announcement",
      title: dto.title.trim(),
      body: dto.body.trim(),
      onlyNonParticipants: dto.only_non_participants ?? true,
      dedupeHours: dto.dedupe_hours ?? 24,
    });
  }
}
