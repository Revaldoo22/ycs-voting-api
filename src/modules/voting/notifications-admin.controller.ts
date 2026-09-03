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
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import type { JwtPayload } from "../../common/guards/jwt.guard";
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
      // Semua akun non-admin dihitung, TERMASUK yang belum onboarding:
      // notifikasi tampil di lonceng begitu mereka login, dan justru merekalah
      // sasaran ajakan mendaftar. Menyaringnya lewat onboarded membuang
      // sebagian besar calon peserta.
      //
      // Peserta hasil sync dari web pendaftaran dibuatkan profil ber-role
      // 'participant', jadi role voter saja tidak cukup untuk memisahkan.
      // Pengecekan record peserta tetap dilakukan lewat profile_id maupun
      // email, untuk peserta yang mendaftar sendiri sebagai voter.
      `select
         count(*)::int as total_akun,
         count(*) filter (
           where pr.role <> 'participant'
             and not exists (
               select 1 from participants p
               where p.profile_id = pr.id
                  or (pr.email is not null
                      and lower(p.email) = lower(pr.email))
             )
         )::int as belum_peserta,
         -- Akun yang akan DILEWATI dedupe: sudah menerima pengumuman dalam
         -- 24 jam terakhir. Ditampilkan supaya admin tak bingung melihat
         -- "terkirim 7" padahal sasarannya belasan ribu.
         (select count(*)::int from (
            select distinct n.profile_id from notifications n
             where n.type = 'announcement'
               and n.created_at > now() - interval '24 hours'
          ) d)::int as dilewati_dedupe
       from profiles pr
       where pr.role <> 'admin'`,
    )) as {
      total_akun: number;
      belum_peserta: number;
      dilewati_dedupe: number;
    }[];
    return row;
  }

  /**
   * Riwayat pengiriman + jumlah klik tautannya. clicks = total klik,
   * click_accounts = akun unik yang mengklik (satu orang bisa klik berkali).
   */
  @Get("log")
  log() {
    return this.db.query(
      `select a.id, a.title, a.body, a.sent_count, a.only_non_participants,
              a.sent_by, a.created_at,
              (select count(*) from announcement_clicks ac
                where ac.announcement_id = a.id)::int as clicks,
              (select count(distinct ac.profile_id) from announcement_clicks ac
                where ac.announcement_id = a.id
                  and ac.profile_id is not null)::int as click_accounts,
              (select count(*) from notifications n
                where n.announcement_id = a.id
                  and n.read_at is not null)::int as read_count
       from announcements a
       order by a.created_at desc
       limit 100`,
    );
  }

  @Post("broadcast")
  broadcast(@Body() dto: BroadcastDto, @CurrentUser() user: JwtPayload) {
    return this.notifications.broadcast({
      type: "announcement",
      // Nama admin bila ada, kalau tidak id profilnya, supaya riwayat
      // tetap bisa dilacak siapa pengirimnya.
      sentBy: user?.name ?? user?.sub ?? null,
      title: dto.title.trim(),
      body: dto.body.trim(),
      onlyNonParticipants: dto.only_non_participants ?? true,
      dedupeHours: dto.dedupe_hours ?? 24,
    });
  }
}
