import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";

/**
 * Public read endpoints. Aggregate SQL is ported 1:1 from the old Supabase
 * RPCs (migration 0022) and returns snake_case rows — the frontend types
 * (src/types/database.ts) are unchanged.
 */
@Injectable()
export class PublicService {
  constructor(private readonly db: DataSource) {}

  schools() {
    return this.db.query(`select * from schools order by name`);
  }

  schoolsWithParticipants() {
    return this.db.query(`
      select distinct s.id, s.name
      from schools s
      join participants p on p.school_id = s.id and p.status = 'active'
      order by s.name`);
  }

  /** Cari sekolah (wizard voter): filter wilayah + keyword. Limit 50. */
  searchSchools(f: {
    q?: string;
    regencyCode?: string;
    districtCode?: string;
  }) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (f.districtCode) {
      params.push(f.districtCode);
      where.push(`s.district_code = $${params.length}`);
    } else if (f.regencyCode) {
      params.push(f.regencyCode);
      where.push(`s.regency_code = $${params.length}`);
    }
    if (f.q) {
      params.push(`%${f.q}%`);
      where.push(`(s.name ilike $${params.length} or s.npsn ilike $${params.length})`);
    }
    const clause = where.length ? `where ${where.join(" and ")}` : "";
    return this.db.query(
      `select id, name, npsn, jenjang, regency_code, district_code
       from schools s ${clause}
       order by s.name limit 50`,
      params,
    );
  }

  participants(schoolId?: string) {
    return this.db.query(
      `select p.*,
              case when s.id is null then null
                   else json_build_object('id', s.id, 'name', s.name,
                                          'region_id', s.region_id,
                                          'kabupaten', reg.name,
                                          'provinsi', prov.name) end as schools
       from participants p
       left join schools s on s.id = p.school_id
       left join regions reg on reg.id = s.region_id
       left join regions prov on prov.id = reg.parent_id
       where ($1::uuid is null or p.school_id = $1)
       order by p.total_points desc`,
      [schoolId ?? null],
    );
  }

  leaderboard(limit = 50) {
    return this.db.query(
      `select p.*,
              case when s.id is null then null
                   else json_build_object('id', s.id, 'name', s.name) end as schools
       from participants p
       left join schools s on s.id = p.school_id
       where p.status = 'active'
       order by p.total_points desc
       limit $1`,
      [Math.min(Math.max(limit, 1), 200)],
    );
  }

  async participant(id: string) {
    const rows = await this.db.query(
      `select p.*,
              case when s.id is null then null
                   else json_build_object('id', s.id, 'name', s.name) end as schools
       from participants p
       left join schools s on s.id = p.school_id
       where p.id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  contents(participantId: string) {
    return this.db.query(
      `select * from participant_contents
       where participant_id = $1 order by created_at desc`,
      [participantId],
    );
  }

  pointHistory(participantId: string) {
    return this.db.query(
      `with vote_day as (
         select vote_date as day, coalesce(sum(points), 0) as pts
         from daily_votes where participant_id = $1 group by vote_date
       ),
       quest_day as (
         select s.created_at::date as day, coalesce(sum(q.point), 0) as pts
         from submissions s join quests q on q.id = s.quest_id
         where s.participant_id = $1 and s.status = 'approved'
         group by s.created_at::date
       ),
       merged as (
         select day, sum(pts) as points
         from (select day, pts from vote_day union all select day, pts from quest_day) u
         group by day
       )
       select to_char(day, 'YYYY-MM-DD') as day, points::int as points,
              sum(points) over (order by day)::int as cumulative
       from merged order by day`,
      [participantId],
    );
  }

  topSupporters(participantId: string, limit = 10) {
    return this.db.query(
      `with vote_pts as (
         select voter_phone, max(voter_name) as nm, max(voter_status) as st,
                count(*) as votes, coalesce(sum(points), 0) as pts
         from daily_votes
         where participant_id = $1 and voter_phone is not null
         group by voter_phone
       ),
       quest_pts as (
         select s.voter_phone, max(s.voter_name) as nm, max(s.voter_status) as st,
                coalesce(sum(q.point), 0) as pts
         from submissions s join quests q on q.id = s.quest_id
         where s.participant_id = $1 and s.status = 'approved'
           and s.voter_phone is not null
         group by s.voter_phone
       ),
       combined as (
         select coalesce(v.nm, qp.nm, v.voter_phone, qp.voter_phone) as nm,
                coalesce(v.st, qp.st) as st,
                coalesce(v.votes, 0) as votes,
                coalesce(v.pts, 0) + coalesce(qp.pts, 0) as points
         from vote_pts v
         full outer join quest_pts qp on qp.voter_phone = v.voter_phone
       )
       select nm as voter_name, st as voter_status, votes::int, points::int
       from combined where points > 0 order by points desc limit $2`,
      [participantId, limit],
    );
  }

  async supporterCount(participantId: string) {
    const rows = await this.db.query(
      `select count(distinct phone)::int as c from (
         select voter_phone as phone from daily_votes
         where participant_id = $1 and voter_phone is not null
         union
         select voter_phone from submissions
         where participant_id = $1 and status = 'approved' and voter_phone is not null
       ) u`,
      [participantId],
    );
    return Number(rows[0]?.c ?? 0);
  }

  async rank(participantId: string) {
    const rows = await this.db.query(
      `select rnk from (
         select id, rank() over (order by total_points desc) as rnk
         from participants where status = 'active'
       ) r where id = $1`,
      [participantId],
    );
    return rows[0] ? Number(rows[0].rnk) : null;
  }

  topVoters(limit = 5) {
    return this.db.query(
      `with v as (
         select voter_phone, max(voter_name) as nm, max(voter_school) as school,
                count(*) as votes, coalesce(sum(points), 0) as pts
         from daily_votes where voter_phone is not null group by voter_phone
       ),
       q as (
         select s.voter_phone, max(s.voter_name) as nm,
                count(*) as quests, coalesce(sum(qu.point), 0) as quest_points
         from submissions s join quests qu on qu.id = s.quest_id
         where s.status = 'approved' and s.voter_phone is not null
         group by s.voter_phone
       )
       select coalesce(v.nm, q.nm, v.voter_phone, q.voter_phone) as voter_name,
              coalesce(v.school, '') as school_name,
              coalesce(v.votes, 0)::int as votes,
              coalesce(q.quests, 0)::int as quests,
              (coalesce(v.pts, 0) + coalesce(q.quest_points, 0))::int as score
       from v full outer join q on q.voter_phone = v.voter_phone
       where coalesce(v.votes, 0) > 0 or coalesce(q.quests, 0) > 0
       order by score desc limit $1`,
      [limit],
    );
  }

  quests(activeOnly: boolean) {
    return this.db.query(
      `select * from quests
       where ($1::boolean = false or status = 'active')
       order by created_at`,
      [activeOnly],
    );
  }

  /** content_ids already submitted (non-rejected) by this voter email. */
  async doneContentIds(participantId: string, questId: string, email: string) {
    const rows = await this.db.query(
      `select content_id from submissions
       where participant_id = $1 and quest_id = $2
         and voter_email = $3 and status <> 'rejected'
         and content_id is not null`,
      [participantId, questId, email.trim().toLowerCase()],
    );
    return rows.map((r: { content_id: string }) => r.content_id);
  }
}
