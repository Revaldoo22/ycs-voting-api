import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { Round, RoundSchool } from "../../database/entities";

@Injectable()
export class RoundsService {
  constructor(
    private readonly db: DataSource,
    @InjectRepository(Round) private readonly rounds: Repository<Round>,
    @InjectRepository(RoundSchool)
    private readonly roundSchools: Repository<RoundSchool>,
  ) {}

  /** Round yang sedang berjalan (dipakai stempel vote & halaman publik). */
  active(): Promise<Round | null> {
    return this.rounds.findOneBy({ status: "active" });
  }

  list() {
    return this.db.query(`
      select r.*,
             (select count(*) from round_schools rs
               where rs.round_id = r.id)::int                       as school_count,
             (select count(*) from round_schools rs
               where rs.round_id = r.id and rs.status = 'lolos')::int as lolos_count,
             (select coalesce(sum(dv.points), 0) from daily_votes dv
               where dv.round_id = r.id)::int                       as total_points
      from rounds r
      order by r.created_at`);
  }

  /** Versi publik: hanya round aktif/selesai (draft disembunyikan). */
  publicList() {
    return this.db.query(`
      select r.id, r.name, r.status, r.starts_at, r.ends_at,
             (select count(*) from round_schools rs
               where rs.round_id = r.id)::int as school_count
      from rounds r
      where r.status in ('active', 'closed')
      order by r.created_at desc`);
  }

  /** Edit pengaturan gelombang: nama, jadwal, aturan lolos. */
  async updateSettings(
    id: string,
    dto: {
      name?: string;
      starts_at?: string | null;
      ends_at?: string | null;
      top_n?: number;
    },
  ) {
    const round = await this.mustExist(id);
    if (dto.name !== undefined) round.name = dto.name.trim();
    if (dto.starts_at !== undefined)
      round.startsAt = dto.starts_at ? new Date(dto.starts_at) : null;
    if (dto.ends_at !== undefined)
      round.endsAt = dto.ends_at ? new Date(dto.ends_at) : null;
    if (dto.top_n !== undefined)
      round.topN = Math.max(1, Math.min(dto.top_n, 100));
    await this.rounds.save(round);
    return { ok: true };
  }

  /** Daftar sekolah dalam round (nama, kabupaten, status, skor). */
  roundSchoolList(id: string) {
    return this.db.query(
      `select rs.school_id, rs.status, s.name as school_name,
              coalesce(rg.name, 'Tanpa Kabupaten') as region_name,
              coalesce((
                select sum(p.total_points) from participants p
                where p.school_id = s.id and p.status = 'active'
              ), 0)::int as points,
              (select count(*) from participants p
               where p.school_id = s.id and p.status = 'active')::int as participants
       from round_schools rs
       join schools s on s.id = rs.school_id
       left join regions rg on rg.id = s.region_id
       where rs.round_id = $1
       order by region_name, points desc`,
      [id],
    );
  }

  /** Tambah satu sekolah ke round (idempotent). */
  async addSchool(id: string, schoolId: string) {
    const round = await this.mustExist(id);
    if (round.status === "closed") {
      throw new BadRequestException("Gelombang sudah ditutup.");
    }
    await this.db.query(
      `insert into round_schools (round_id, school_id, status)
       values ($1, $2, 'active') on conflict (round_id, school_id) do nothing`,
      [id, schoolId],
    );
    return { ok: true };
  }

  /** Keluarkan sekolah dari round. */
  async removeSchool(id: string, schoolId: string) {
    const round = await this.mustExist(id);
    if (round.status === "closed") {
      throw new BadRequestException("Gelombang sudah ditutup.");
    }
    await this.roundSchools.delete({ roundId: id, schoolId });
    return { ok: true };
  }

  create(name: string) {
    return this.rounds.save(this.rounds.create({ name: name.trim() }));
  }

  private async mustExist(id: string): Promise<Round> {
    const round = await this.rounds.findOneBy({ id });
    if (!round) throw new NotFoundException("Gelombang tidak ditemukan.");
    return round;
  }

  /**
   * Isi peserta gelombang: semua sekolah aktif, atau hanya yang gugur di
   * gelombang sebelumnya (gelombang susulan).
   */
  async populate(id: string, source: "all" | "gugur", fromRoundId?: string) {
    const round = await this.mustExist(id);
    if (round.status === "closed") {
      throw new BadRequestException("Gelombang sudah ditutup.");
    }

    let schoolIds: string[];
    if (source === "gugur") {
      if (!fromRoundId) {
        throw new BadRequestException("Pilih gelombang sumber (yang gugur).");
      }
      const rows = await this.roundSchools.findBy({
        roundId: fromRoundId,
        status: "gugur",
      });
      schoolIds = rows.map((r) => r.schoolId);
    } else {
      const rows: { id: string }[] = await this.db.query(
        `select distinct s.id from schools s
         join participants p on p.school_id = s.id and p.status = 'active'`,
      );
      schoolIds = rows.map((r) => r.id);
    }

    if (schoolIds.length === 0) {
      throw new BadRequestException("Tidak ada sekolah untuk dimasukkan.");
    }

    // Idempotent: skip sekolah yang sudah terdaftar di round ini.
    await this.db.query(
      `insert into round_schools (round_id, school_id, status)
       select $1, unnest($2::uuid[]), 'active'
       on conflict (round_id, school_id) do nothing`,
      [id, schoolIds],
    );
    return { ok: true, added: schoolIds.length };
  }

  /** Aktifkan round ini; round aktif lain otomatis kembali ke draft. */
  async activate(id: string) {
    await this.mustExist(id);
    await this.db.transaction(async (em) => {
      await em
        .getRepository(Round)
        .update({ status: "active" }, { status: "draft" });
      await em
        .getRepository(Round)
        .update({ id }, { status: "active", startsAt: new Date() });
    });
    return { ok: true };
  }

  /**
   * Klasemen sekolah per kabupaten. Poin sekolah = jumlah total_points
   * seluruh peserta aktif sekolah itu (vote + quest yang disetujui).
   */
  standings(id: string) {
    return this.db.query(
      `select rs.school_id, s.name as school_name, rs.status,
              rg.id as region_id, coalesce(rg.name, 'Tanpa Kabupaten') as region_name,
              coalesce(pt.points, 0)::int as points,
              coalesce(v.votes, 0)::int as votes
       from round_schools rs
       join schools s on s.id = rs.school_id
       left join regions rg on rg.id = s.region_id
       left join lateral (
         select sum(p.total_points) as points
         from participants p
         where p.school_id = rs.school_id and p.status = 'active'
       ) pt on true
       left join lateral (
         select count(*) as votes
         from daily_votes dv
         join participants p on p.id = dv.participant_id
         where dv.round_id = $1 and p.school_id = rs.school_id
       ) v on true
       where rs.round_id = $1
       order by region_name, points desc`,
      [id],
    );
  }

  /**
   * Tutup gelombang + promosi: top-N sekolah per kabupaten (by poin vote
   * round ini) berstatus 'lolos', sisanya 'gugur'.
   */
  async close(id: string, topN?: number) {
    const round = await this.mustExist(id);
    if (round.status === "closed") {
      throw new BadRequestException("Gelombang sudah ditutup.");
    }
    const n = Math.max(1, Math.min(topN || round.topN || 1, 100));

    await this.db.transaction(async (em) => {
      // Ranking per kabupaten → set lolos/gugur sekali jalan.
      await em.query(
        `with ranked as (
           select rs.id,
                  row_number() over (
                    partition by coalesce(rg.id::text, 'none')
                    order by coalesce(v.points, 0) desc, s.name
                  ) as rnk
           from round_schools rs
           join schools s on s.id = rs.school_id
           left join regions rg on rg.id = s.region_id
           left join lateral (
             select sum(p.total_points) as points
             from participants p
             where p.school_id = rs.school_id and p.status = 'active'
           ) v on true
           where rs.round_id = $1
         )
         update round_schools rs set status =
           case when r.rnk <= $2 then 'lolos' else 'gugur' end
         from ranked r where r.id = rs.id`,
        [id, n],
      );
      await em
        .getRepository(Round)
        .update({ id }, { status: "closed", endsAt: new Date() });
    });
    return { ok: true };
  }

  async remove(id: string) {
    const round = await this.mustExist(id);
    if (round.status === "active") {
      throw new BadRequestException("Nonaktifkan dulu sebelum menghapus.");
    }
    await this.roundSchools.delete({ roundId: id });
    await this.rounds.delete({ id });
    return { ok: true };
  }

  /**
   * Ranking sekolah (semua / satu kabupaten). Skor = jumlah total_points
   * peserta aktif. Rank dihitung setelah filter kabupaten.
   */
  schoolRankings(regionId?: string) {
    return this.db.query(
      `with scores as (
         select s.id as school_id, s.name as school_name, s.region_id,
                coalesce(rg.name, 'Tanpa Kabupaten') as region_name,
                coalesce((
                  select sum(p.total_points) from participants p
                  where p.school_id = s.id and p.status = 'active'
                ), 0) as points,
                (select count(*) from participants p
                 where p.school_id = s.id and p.status = 'active')::int as participants
         from schools s
         left join regions rg on rg.id = s.region_id
         where $1::uuid is null or s.region_id = $1
       )
       select school_id, school_name, region_id, region_name, participants,
              points::int, rank() over (order by points desc)::int as rank
       from scores
       order by points desc, school_name
       limit 300`,
      [regionId ?? null],
    );
  }

  /** Detail satu sekolah + peringkat global & kabupaten. */
  async schoolDetail(id: string) {
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
                count(*) over ()::int as global_total,
                rank() over (partition by region_id order by points desc)::int as region_rank,
                count(*) over (partition by region_id)::int as region_total
         from scores
       )
       select id as school_id, name as school_name, region_id, region_name,
              points::int, global_rank, global_total, region_rank, region_total
       from ranked where id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  /**
   * Agregasi heatmap per kabupaten. Poin = jumlah total_points peserta
   * aktif (vote + quest); votes = jumlah vote masuk.
   */
  heatmap() {
    return this.db.query(
      `select rg.id as region_id, rg.name as region_name, rg.code, rg.province,
              count(distinct s.id)::int as schools,
              count(distinct p.id)::int as participants,
              coalesce(sum(p.total_points), 0)::int as points,
              coalesce((
                select count(*) from daily_votes dv
                join participants p2 on p2.id = dv.participant_id
                join schools s2 on s2.id = p2.school_id
                where s2.region_id = rg.id
              ), 0)::int as votes
       from regions rg
       left join schools s on s.region_id = rg.id
       left join participants p on p.school_id = s.id and p.status = 'active'
       group by rg.id, rg.name, rg.code, rg.province
       order by points desc, rg.name`,
    );
  }
}
