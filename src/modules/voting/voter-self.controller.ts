import { Controller, Get, UseGuards } from "@nestjs/common";
import { DataSource } from "typeorm";
import { JwtGuard, JwtPayload } from "../../common/guards/jwt.guard";
import { CurrentUser } from "../../common/decorators/current-user.decorator";

/** Riwayat hari ini untuk voter login: vote yang masuk + sisa kuota fav20. */
@Controller("voter")
@UseGuards(JwtGuard)
export class VoterSelfController {
  constructor(private readonly db: DataSource) {}

  @Get("today")
  async today(@CurrentUser() user: JwtPayload) {
    const rows = await this.db.query(
      `select dv.vote_kind, dv.points, dv.created_at,
              p.id as participant_id, p.name as participant_name
       from daily_votes dv
       join participants p on p.id = dv.participant_id
       join profiles pr on pr.phone_number = dv.voter_phone
       where pr.id = $1 and dv.vote_date = current_date
       order by dv.created_at desc`,
      [user.sub],
    );
    const favUsed = new Set(
      rows
        .filter((r: { vote_kind: string }) => r.vote_kind === "fav20")
        .map((r: { participant_id: string }) => r.participant_id),
    ).size;
    return { votes: rows, fav_quota: { used: favUsed, max: 10 } };
  }

  /** Kupon undian milik voter (dari follow). */
  @Get("coupons")
  coupons(@CurrentUser() user: JwtPayload) {
    return this.db.query(
      `select c.code, c.source, c.created_at, pr.name as owner_name
       from coupons c join profiles pr on pr.id = c.profile_id
       where c.profile_id = $1
       order by c.created_at desc`,
      [user.sub],
    );
  }

  /**
   * Peringkat sekolah si voter: global & di dalam kabupatennya.
   * Skor sekolah = jumlah total_points peserta aktifnya.
   */
  @Get("school-rank")
  async schoolRank(@CurrentUser() user: JwtPayload) {
    const rows = await this.db.query(
      `with scores as (
         select s.id, s.name, s.region_id,
                coalesce(rg.name, 'Tanpa Kabupaten') as region_name,
                coalesce((
                  select sum(p.total_points) from participants p
                  where p.school_id = s.id and p.status = 'active'
                ), 0) as points
         from schools s
         left join regions rg on rg.id = s.region_id
       ),
       ranked as (
         select *,
                rank() over (order by points desc)::int as global_rank,
                rank() over (partition by region_id order by points desc)::int as region_rank,
                count(*) over ()::int as global_total,
                count(*) over (partition by region_id)::int as region_total
         from scores
       )
       select r.id as school_id, r.region_id, r.name as school_name, r.region_name, r.points::int,
              r.global_rank, r.global_total, r.region_rank, r.region_total
       from ranked r
       join profiles pr on pr.school_id = r.id
       where pr.id = $1`,
      [user.sub],
    );
    return rows[0] ?? null;
  }
}
