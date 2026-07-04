import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { IsOptional, IsString, MaxLength } from "class-validator";
import { DataSource } from "typeorm";
import { JwtGuard } from "../../common/guards/jwt.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";

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
  constructor(private readonly db: DataSource) {}

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
       returning c.code, c.prize, c.won_at,
         (select name from profiles p where p.id = c.profile_id) as name,
         (select phone_number from profiles p where p.id = c.profile_id) as phone_number,
         (select email from profiles p where p.id = c.profile_id) as email`,
      [dto.prize?.trim() || "Handphone"],
    );
    // UPDATE ... RETURNING lewat TypeORM: [records, affectedCount]
    const records = Array.isArray(rows[0]) ? rows[0] : rows;
    if (!records[0]) {
      throw new NotFoundException("Tidak ada kupon tersisa untuk diundi.");
    }
    return { winner: records[0] };
  }

  /** Batalkan kemenangan (salah undi) - kupon kembali ke kolam. */
  @Delete("winners/:code")
  async cancel(@Param("code") code: string) {
    const res = await this.db.query(
      `update coupons set won_at = null, prize = null
       where code = $1 and won_at is not null returning code`,
      [code],
    );
    const records = Array.isArray(res[0]) ? res[0] : res;
    if (!records[0]) throw new NotFoundException("Pemenang tidak ditemukan.");
    return { ok: true };
  }
}
