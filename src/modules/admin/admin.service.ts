import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";

export interface VoterFilters {
  participantId?: string;
  from?: string;
  to?: string;
  search?: string;
  status?: string;
  school?: string;
  limit?: number;
  offset?: number;
  sort?: "recent" | "points_desc" | "points_asc";
}

export interface ActivityFilters {
  kind?: string;
  participantId?: string;
  from?: string;
  to?: string;
  search?: string;
  qstatus?: string;
  limit?: number;
  offset?: number;
}

/**
 * Admin aggregates — SQL ported from the old Supabase RPCs
 * (admin_stats, daily_vote_series, voter_growth_series, admin_voters 0025,
 * admin_activity_log 0024, voter_distribution, participant_point_log 0022,
 * participant_supporters_detail). All rows snake_case (old API shape).
 */
@Injectable()
export class AdminService {
  constructor(private readonly db: DataSource) {}

  async stats() {
    const rows = await this.db.query(`
      select
        (select count(distinct school_id) from participants
          where school_id is not null)::int                          as total_schools,
        (select count(*) from participants)::int                     as total_participants,
        (select count(distinct voter_phone) from daily_votes
          where voter_phone is not null)::int                        as total_voters,
        (select count(*) from daily_votes)::int                      as total_votes,
        (select coalesce(sum(total_points), 0) from participants)::int as total_points`);
    return rows[0];
  }

  /**
   * Rentang tanggal untuk chart. Prioritas: from/to eksplisit → lifetime
   * (dari vote pertama) → N hari terakhir. Batas ≤ 400 hari agar chart wajar.
   */
  private async resolveRange(opts: {
    from?: string;
    to?: string;
    days?: number;
    lifetime?: boolean;
  }): Promise<{ from: string; to: string }> {
    const to = opts.to ?? new Date().toISOString().slice(0, 10);
    if (opts.from) return { from: opts.from, to };
    if (opts.lifetime) {
      const r = await this.db.query(
        `select to_char(min(vote_date), 'YYYY-MM-DD') as f from daily_votes`,
      );
      const from = r[0]?.f ?? to;
      return { from, to };
    }
    const days = Math.min(Math.max(opts.days ?? 14, 1), 400);
    const d = new Date(to);
    d.setDate(d.getDate() - (days - 1));
    return { from: d.toISOString().slice(0, 10), to };
  }

  private clampSpan(from: string, to: string): { from: string; to: string } {
    // Cegah generate_series raksasa: maksimum 400 hari.
    const f = new Date(from);
    const t = new Date(to);
    const span = Math.round((+t - +f) / 86400000);
    if (span > 400) f.setTime(+t - 400 * 86400000);
    return { from: f.toISOString().slice(0, 10), to };
  }

  async voteSeries(opts: {
    from?: string;
    to?: string;
    days?: number;
    lifetime?: boolean;
  }) {
    const rng = await this.resolveRange(opts);
    const r = this.clampSpan(rng.from, rng.to);
    return this.db.query(
      `select to_char(d::date, 'YYYY-MM-DD') as day,
              coalesce((select count(*) from daily_votes dv
                        where dv.vote_date = d::date), 0)::int as votes
       from generate_series($1::date, $2::date, interval '1 day') d
       order by d`,
      [r.from, r.to],
    );
  }

  async voterGrowth(opts: {
    from?: string;
    to?: string;
    days?: number;
    lifetime?: boolean;
  }) {
    const rng = await this.resolveRange(opts);
    const r = this.clampSpan(rng.from, rng.to);
    return this.db.query(
      `select to_char(d::date, 'YYYY-MM-DD') as day,
              (select count(distinct voter_phone) from daily_votes
               where voter_phone is not null
                 and created_at::date <= d::date)::int as cumulative
       from generate_series($1::date, $2::date, interval '1 day') d
       order by d`,
      [r.from, r.to],
    );
  }

  /**
   * Leads PMB: semua voter yang sudah onboarding (profil + survey), untuk
   * ditindaklanjuti tim PMB. Filter opsional niat kuliah & awareness.
   */
  async leads(f: { intent?: string; awareness?: string }) {
    return this.db.query(
      `select pr.name, pr.phone_number, pr.email,
              sc.name as school_name, pr.voter_class, pr.voter_status,
              reg.name as kabupaten, prov.name as provinsi,
              pr.college_intent, pr.stekom_awareness, pr.stekom_source,
              pr.created_at
       from profiles pr
       left join schools sc on sc.id = pr.school_id
       left join regions reg on reg.id = pr.region_id
       left join regions prov on prov.id = reg.parent_id
       where pr.role = 'voter' and pr.onboarded = true
         and ($1::text is null or pr.college_intent = $1)
         and ($2::text is null or pr.stekom_awareness = $2)
       order by pr.created_at desc`,
      [f.intent || null, f.awareness || null],
    );
  }

  /** Insight PMB: niat kuliah + sebaran kabupaten voter ber-akun. */
  async pmbInsight() {
    const intent = await this.db.query(`
      select coalesce(college_intent, 'belum_isi') as intent, count(*)::int as count
      from profiles where role = 'voter' and onboarded = true
      group by 1 order by count desc`);
    const regions = await this.db.query(`
      select rg.name as region, count(*)::int as count
      from profiles pr join regions rg on rg.id = pr.region_id
      where pr.role = 'voter' and pr.onboarded = true
      group by rg.name order by count desc limit 12`);
    const total = await this.db.query(`
      select count(*)::int as c from profiles
      where role = 'voter' and onboarded = true`);
    return { total: total[0].c, intent, regions };
  }

  /** Combined voter roster (votes + approved quests), filterable + paged. */
  private votersCte = `
    with v as (
      select voter_phone, max(voter_name) as nm, max(voter_email) as em,
             max(voter_status) as st, max(voter_school) as sch, max(voter_class) as cls,
             count(*) as votes, coalesce(sum(points), 0) as pts,
             min(created_at) as first_c, max(created_at) as last_c
      from daily_votes
      where voter_phone is not null
        and ($1::uuid is null or participant_id = $1)
        and ($2::date is null or created_at::date >= $2)
        and ($3::date is null or created_at::date <= $3)
      group by voter_phone
    ),
    q as (
      select s.voter_phone, max(s.voter_name) as nm, max(s.voter_email) as em,
             max(s.voter_status) as st, max(s.voter_school) as sch, max(s.voter_class) as cls,
             count(*) as quests, coalesce(sum(qu.point), 0) as pts,
             min(s.created_at) as first_c, max(s.created_at) as last_c
      from submissions s join quests qu on qu.id = s.quest_id
      where s.status = 'approved' and s.voter_phone is not null
        and ($1::uuid is null or s.participant_id = $1)
        and ($2::date is null or s.created_at::date >= $2)
        and ($3::date is null or s.created_at::date <= $3)
      group by s.voter_phone
    ),
    -- Voter yang sudah daftar (onboarded) — ikut walau belum vote/quest.
    -- Hanya relevan saat TIDAK memfilter per peserta ($1 null).
    prof as (
      select pr.phone_number as voter_phone, pr.name as nm, pr.email as em,
             pr.voter_status as st, sc.name as sch, pr.voter_class as cls,
             pr.created_at as first_c, pr.created_at as last_c
      from profiles pr
      left join schools sc on sc.id = pr.school_id
      where pr.role = 'voter' and pr.onboarded = true
        and pr.phone_number is not null
        and $1::uuid is null
        and ($2::date is null or pr.created_at::date >= $2)
        and ($3::date is null or pr.created_at::date <= $3)
    ),
    va as (
      select coalesce(v.voter_phone, q.voter_phone) as voter_phone,
             coalesce(v.nm, q.nm) as nm,
             coalesce(v.em, q.em) as em,
             coalesce(v.st, q.st) as st,
             coalesce(v.sch, q.sch) as sch,
             coalesce(v.cls, q.cls) as cls,
             coalesce(v.votes, 0) as votes,
             coalesce(q.quests, 0) as quests,
             coalesce(v.pts, 0) + coalesce(q.pts, 0) as points,
             least(v.first_c, q.first_c) as first_c,
             greatest(v.last_c, q.last_c) as last_c
      from v full outer join q on q.voter_phone = v.voter_phone
    ),
    combined as (
      select coalesce(va.voter_phone, prof.voter_phone) as voter_phone,
             coalesce(va.nm, prof.nm, va.voter_phone, prof.voter_phone) as voter_name,
             coalesce(va.em, prof.em) as voter_email,
             coalesce(va.st, prof.st) as voter_status,
             coalesce(va.sch, prof.sch) as voter_school,
             coalesce(va.cls, prof.cls) as voter_class,
             coalesce(va.votes, 0) as votes,
             coalesce(va.quests, 0) as quests,
             coalesce(va.points, 0) as points,
             coalesce(va.first_c, prof.first_c) as first_seen,
             coalesce(va.last_c, prof.last_c) as last_seen
      from va full outer join prof on prof.voter_phone = va.voter_phone
    ),
    enriched as (
      select c.*, rgn.name as region, pr.college_intent
      from combined c
      left join profiles pr on pr.phone_number = c.voter_phone
      left join regions rgn on rgn.id = pr.region_id
    ),
    filtered as (
      select * from enriched
      where ($4::text is null
              or voter_name ilike '%' || $4 || '%'
              or voter_phone ilike '%' || $4 || '%'
              or voter_email ilike '%' || $4 || '%')
        and ($5::text is null or voter_status = $5)
        and ($6::text is null or voter_school ilike '%' || $6 || '%')
    )`;

  private voterArgs(f: VoterFilters) {
    return [
      f.participantId || null,
      f.from || null,
      f.to || null,
      f.search || null,
      f.status || null,
      f.school || null,
    ];
  }

  voters(f: VoterFilters) {
    const order =
      f.sort === "points_desc"
        ? "points desc"
        : f.sort === "points_asc"
          ? "points asc"
          : "first_seen desc nulls last";
    return this.db.query(
      `${this.votersCte}
       select voter_phone, voter_name, voter_email, voter_status, voter_school,
              voter_class, region, college_intent,
              votes::int, quests::int, points::int,
              first_seen, last_seen
       from filtered order by ${order}
       limit $7 offset $8`,
      [...this.voterArgs(f), Math.min(f.limit ?? 25, 1000), f.offset ?? 0],
    );
  }

  async votersCount(f: VoterFilters) {
    const rows = await this.db.query(
      `${this.votersCte} select count(*)::int as c from filtered`,
      this.voterArgs(f),
    );
    return Number(rows[0]?.c ?? 0);
  }

  /** Per-participant breakdown for one voter (by phone). */
  voterDistribution(phone: string) {
    return this.db.query(
      `with v as (
         select participant_id, count(*) as votes, coalesce(sum(points), 0) as pts
         from daily_votes where voter_phone = $1 group by participant_id
       ),
       q as (
         select s.participant_id, count(*) as quests, coalesce(sum(qu.point), 0) as pts
         from submissions s join quests qu on qu.id = s.quest_id
         where s.status = 'approved' and s.voter_phone = $1
         group by s.participant_id
       ),
       ids as (select participant_id from v union select participant_id from q)
       select i.participant_id, p.name as participant_name, sch.name as school_name,
              coalesce(v.votes, 0)::int as votes,
              coalesce(q.quests, 0)::int as quests,
              (coalesce(v.pts, 0) + coalesce(q.pts, 0))::int as points
       from ids i
       join participants p on p.id = i.participant_id
       left join schools sch on sch.id = p.school_id
       left join v on v.participant_id = i.participant_id
       left join q on q.participant_id = i.participant_id
       order by 6 desc`,
      [phone],
    );
  }

  /** Every point that entered a participant (votes + approved quests). */
  pointLog(participantId: string) {
    return this.db.query(
      `select 'vote'::text as kind,
              case when dv.vote_kind = 'fav20' then 'Vote Favorit (+20)'
                   else 'Vote Harian (+5)' end as source,
              coalesce(dv.voter_name, dv.voter_phone) as voter_name,
              dv.voter_phone, dv.points, dv.created_at
       from daily_votes dv
       where dv.participant_id = $1
       union all
       select 'quest'::text, q.name,
              coalesce(s.voter_name, s.voter_phone), s.voter_phone,
              q.point, s.created_at
       from submissions s join quests q on q.id = s.quest_id
       where s.participant_id = $1 and s.status = 'approved'
       order by created_at desc`,
      [participantId],
    );
  }

  /** Supporters of one participant, admin detail shape (AdminVoter rows). */
  supportersDetail(participantId: string) {
    return this.voters({ participantId, limit: 1000, sort: "points_desc" });
  }

  /** Unified activity feed: daily5/fav20 votes + quest submissions. */
  private activityCte = `
    with acts as (
      select dv.vote_kind as kind,
             case when dv.vote_kind = 'fav20' then 'Vote Favorit (+20)'
                  else 'Vote Harian (+5)' end as source,
             coalesce(dv.voter_name, dv.voter_phone) as voter_name,
             dv.voter_phone, p.name as participant_name, dv.participant_id,
             dv.points, 'approved'::text as status, dv.created_at
      from daily_votes dv
      join participants p on p.id = dv.participant_id
      union all
      select 'quest'::text, q.name,
             coalesce(s.voter_name, s.voter_phone), s.voter_phone,
             p.name, s.participant_id, q.point, s.status, s.created_at
      from submissions s
      join quests q on q.id = s.quest_id
      join participants p on p.id = s.participant_id
    ),
    filtered as (
      select * from acts
      where ($1::text = 'all' or kind = $1)
        and ($2::uuid is null or participant_id = $2)
        and ($3::date is null or created_at::date >= $3)
        and ($4::date is null or created_at::date <= $4)
        and ($5::text is null
              or voter_name ilike '%' || $5 || '%'
              or voter_phone ilike '%' || $5 || '%'
              or participant_name ilike '%' || $5 || '%')
        and ($6::text is null or kind <> 'quest' or status = $6)
    )`;

  private activityArgs(f: ActivityFilters) {
    return [
      f.kind || "all",
      f.participantId || null,
      f.from || null,
      f.to || null,
      f.search || null,
      f.qstatus || null,
    ];
  }

  activityLog(f: ActivityFilters) {
    return this.db.query(
      `${this.activityCte}
       select kind, source, voter_name, voter_phone, participant_name,
              points, status, created_at
       from filtered order by created_at desc
       limit $7 offset $8`,
      [...this.activityArgs(f), Math.min(f.limit ?? 30, 1000), f.offset ?? 0],
    );
  }

  async activityLogCount(f: ActivityFilters) {
    const rows = await this.db.query(
      `${this.activityCte} select count(*)::int as c from filtered`,
      this.activityArgs(f),
    );
    return Number(rows[0]?.c ?? 0);
  }
}
