import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { IsOptional, IsString, MaxLength } from "class-validator";
import { DataSource } from "typeorm";
import { JwtGuard } from "../../common/guards/jwt.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RaffleEventsService } from "./raffle-events.service";

class DrawDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  prize?: string;
}

/** Undian kupon (hadiah handphone) - khusus admin. */
@Controller("admin/raffle")
@UseGuards(JwtGuard, RolesGuard)
@Roles("admin")
export class RaffleController {
  constructor(
    private readonly db: DataSource,
    private readonly events: RaffleEventsService,
  ) {}

  /** Ringkasan: total kupon, belum diundi, daftar pemenang. */
  @Get()
  async summary() {
    const stats = await this.db.query(`
      select count(*)::int as total,
             count(*) filter (where won_at is null)::int as remaining
      from coupons`);
    const winners = await this.db.query(`
      select c.code, c.prize, c.won_at, pr.name, pr.phone_number, pr.email,
             pr.follow_proof_url
      from coupons c join profiles pr on pr.id = c.profile_id
      where c.won_at is not null
      order by c.won_at desc`);
    return { ...stats[0], winners };
  }

  /**
   * Daftar kupon + pemiliknya + status undian. Pencarian di SQL (bukan filter
   * di browser) karena hasil dibatasi 500 baris: tanpa ini, kupon di luar 500
   * terbaru tak akan pernah ketemu walau kodenya diketik di kotak cari.
   *
   * status: "pending" = belum diundi, "won" = sudah menang, kosong = semua.
   */
  @Get("coupons")
  coupons(@Query("status") status?: string, @Query("search") search?: string) {
    const q = search?.trim() || null;
    const st = status === "pending" || status === "won" ? status : null;
    return this.db.query(
      `select c.code, c.source, c.prize, c.won_at, c.created_at,
              pr.id as profile_id, pr.name as voter_name,
              pr.email as voter_email, pr.phone_number as voter_phone
       from coupons c
       join profiles pr on pr.id = c.profile_id
       where ($1::text is null or
              ($1 = 'won' and c.won_at is not null) or
              ($1 = 'pending' and c.won_at is null))
         and ($2::text is null or (
              c.code ilike '%' || $2 || '%'
           or pr.name ilike '%' || $2 || '%'
           or pr.email ilike '%' || $2 || '%'
           or pr.phone_number ilike '%' || $2 || '%'
         ))
       order by c.won_at desc nulls last, c.created_at desc
       limit 500`,
      [st, q],
    );
  }

  /** Jumlah kupon per status (badge tab, tak ikut batas 500 baris). */
  @Get("coupons/counts")
  async couponCounts() {
    const rows = await this.db.query(
      `select count(*)::int as total,
              count(*) filter (where won_at is null)::int as pending,
              count(*) filter (where won_at is not null)::int as won
       from coupons`,
    );
    return rows[0];
  }

  /** Sampel nama acak dari kolam (bahan animasi shuffle di mode live). */
  @Get("candidates")
  candidates() {
    return this.db.query(`
      select pr.name, c.code
      from coupons c join profiles pr on pr.id = c.profile_id
      where c.won_at is null
      order by random() limit 60`);
  }

  /** Tarik satu pemenang acak dari kupon yang belum menang. Atomik. */
  @Post("draw")
  async draw(@Body() dto: DrawDto) {
    const rows = await this.db.query(
      `update coupons c set won_at = now(), prize = $1
       from (
         select id from coupons
         where won_at is null
         order by random() limit 1
         for update skip locked
       ) pick
       where c.id = pick.id
       returning c.code, c.prize, c.won_at, c.profile_id,
         (select name from profiles p where p.id = c.profile_id) as name,
         (select phone_number from profiles p where p.id = c.profile_id) as phone_number,
         (select email from profiles p where p.id = c.profile_id) as email`,
      // Tanpa default hadiah utama: dulu nilainya "Handphone", jadi undian
      // yang dikirim tanpa hadiah tercatat menang hadiah utama hanya karena
      // kolomnya dibiarkan kosong.
      [dto.prize?.trim() || "Hadiah undian"],
    );
    // UPDATE ... RETURNING lewat TypeORM: [records, affectedCount]
    const records = Array.isArray(rows[0]) ? rows[0] : rows;
    const winner = records[0];
    if (!winner) {
      throw new NotFoundException("Tidak ada kupon tersisa untuk diundi.");
    }
    // Notifikasi TIDAK dikirim di sini: mode slot mengungkap kode digit demi
    // digit dan bisa dibatalkan di tengah jalan. Frontend memanggil
    // POST confirm/:code setelah pemenang benar-benar diumumkan.
    //
    // Log dicatat di sini (bukan di confirm) supaya undian yang dibatalkan di
    // tengah jalan tetap meninggalkan jejak di Log Aktivitas.
    await this.events.record({
      couponCode: winner.code,
      profileId: winner.profile_id,
      eventType: "won",
      prize: winner.prize,
    });
    return { winner };
  }

  /**
   * Kunci pemenang sebagai final: kirim notifikasi ke voter. Dipanggil setelah
   * pemenang diumumkan di panggung (semua digit terungkap / undi cepat).
   * Idempoten: notifikasi tidak digandakan bila dipanggil dua kali.
   */
  @Post("confirm/:code")
  async confirm(@Param("code") code: string) {
    const rows = await this.db.query(
      `select c.code, c.prize, c.profile_id
       from coupons c
       where c.code = $1 and c.won_at is not null`,
      [code],
    );
    const winner = rows[0];
    if (!winner) throw new NotFoundException("Pemenang tidak ditemukan.");

    await this.db.query(
      `insert into notifications (profile_id, type, title, body)
       select $1, 'coupon_won', $2, $3
       where not exists (
         select 1 from notifications
         where profile_id = $1 and type = 'coupon_won' and body like $4
       )`,
      [
        winner.profile_id,
        "Selamat, kamu menang undian!",
        `Kupon undianmu (${winner.code}) terpilih sebagai pemenang: ${winner.prize}. Cek di menu Kupon Saya.`,
        `%${winner.code}%`,
      ],
    );
    return { ok: true };
  }

  /** Batalkan kemenangan (salah undi) - kupon kembali ke kolam. */
  @Delete("winners/:code")
  async cancel(@Param("code") code: string) {
    // Hadiah dibaca dulu: setelah update, prize sudah null dan tak bisa
    // dicatat di log.
    const before = await this.db.query(
      `select prize from coupons where code = $1 and won_at is not null`,
      [code],
    );
    const oldPrize: string | null = before[0]?.prize ?? null;

    const res = await this.db.query(
      `update coupons set won_at = null, prize = null
       where code = $1 and won_at is not null
       returning code, profile_id`,
      [code],
    );
    const records = Array.isArray(res[0]) ? res[0] : res;
    const row = records[0];
    if (!row) throw new NotFoundException("Pemenang tidak ditemukan.");

    await this.events.record({
      couponCode: row.code,
      profileId: row.profile_id,
      eventType: "cancelled",
      prize: oldPrize,
    });

    // Kalau pemenang sudah pernah diumumkan (confirm dipanggil), notifikasi
    // "kamu menang" sudah ada di akun voter. Hapus supaya voter tidak
    // menyimpan kabar menang yang ternyata dibatalkan. Tidak ada notifikasi
    // untuk pembatalan di tengah undian slot, jadi query ini no-op di situ.
    await this.db.query(
      `delete from notifications
       where profile_id = $1 and type = 'coupon_won' and body like $2`,
      [row.profile_id, `%${code}%`],
    );

    return { ok: true };
  }

  /**
   * Update hadiah pemenang setelah putaran Spin Wheel.
   *
   * Baris raffle_events-nya ikut diperbarui. Mode roda memanggil /draw SEBELUM
   * roda berhenti, jadi log awal terisi hadiah tebakan dari kolom admin. Kalau
   * hanya coupons yang dikoreksi, Log Aktivitas selamanya menampilkan hadiah
   * yang salah, dan panitia mengira ada yang menang hadiah utama padahal
   * tidak.
   */
  @Post("winners/:code/prize")
  async updatePrize(@Param("code") code: string, @Body("prize") prize: string) {
    if (!prize) throw new NotFoundException("Hadiah tidak valid.");
    const clean = prize.trim();
    await this.db.transaction(async (em) => {
      await em.query(
        `update coupons set prize = $1 where code = $2 and won_at is not null`,
        [clean, code],
      );
      // Hanya log kemenangan terakhir kupon ini, supaya riwayat undian lama
      // yang sudah dibatalkan tidak ikut tertimpa.
      await em.query(
        `update raffle_events set prize = $1
          where id = (
            select id from raffle_events
             where coupon_code = $2 and event_type = 'won'
             order by created_at desc limit 1
          )`,
        [clean, code],
      );
    });
    return { ok: true };
  }
}
