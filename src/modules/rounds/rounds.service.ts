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

  /**
   * Sinkron keanggotaan otomatis: setiap sekolah yang punya peserta aktif
   * (sudah terdaftar) masuk round selama round belum ditutup. Peserta baru
   * daftar = sekolahnya ikut nimbrung. Idempotent (skip yang sudah ada).
   * Tidak menyentuh carry_points / status sekolah yang sudah tercatat.
   */
  private async syncActiveSchools(roundId: string): Promise<void> {
    await this.db.query(
      `insert into round_schools (round_id, school_id, status)
       select $1, s.id, 'active'
       from schools s
       where exists (
         select 1 from participants p
         where p.school_id = s.id and p.status = 'active'
       )
       on conflict (round_id, school_id) do nothing`,
      [roundId],
    );
  }

  async list() {
    // Sync keanggotaan round aktif dulu agar school_count akurat.
    const activeRound = await this.rounds.findOneBy({ status: "active" });
    if (activeRound) await this.syncActiveSchools(activeRound.id);
    return this.db.query(`
      select r.*,
             (select count(*) from round_schools rs
               where rs.round_id = r.id)::int                       as school_count,
             (select count(*) from round_schools rs
               where rs.round_id = r.id and rs.status = 'lolos')::int as lolos_count,
             (select coalesce(sum(
                 rs.carry_points + coalesce((
                   select sum(p.total_points) from participants p
                   where p.school_id = rs.school_id and p.status = 'active'
                 ), 0)
               ), 0)
              from round_schools rs
              where rs.round_id = r.id)::int                        as total_points
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
      select_mode?: "per_region" | "global";
      sequence?: number;
      scheduled_close_at?: string | null;
    },
  ) {
    const round = await this.mustExist(id);
    if (dto.name !== undefined) round.name = dto.name.trim();
    if (dto.starts_at !== undefined)
      round.startsAt = dto.starts_at ? new Date(dto.starts_at) : null;
    if (dto.ends_at !== undefined)
      round.endsAt = dto.ends_at ? new Date(dto.ends_at) : null;
    if (dto.select_mode !== undefined) round.selectMode = dto.select_mode;
    if (dto.sequence !== undefined) round.sequence = Math.max(0, dto.sequence);
    if (dto.scheduled_close_at !== undefined)
      round.scheduledCloseAt = dto.scheduled_close_at
        ? new Date(dto.scheduled_close_at)
        : null;
    if (dto.top_n !== undefined) {
      const cap = round.selectMode === "global" ? 5000 : 100;
      round.topN = Math.max(1, Math.min(dto.top_n, cap));
    }
    await this.rounds.save(round);
    return { ok: true };
  }

  /** Daftar sekolah dalam round (nama, kabupaten, status, skor). */
  async roundSchoolList(id: string) {
    const round = await this.rounds.findOneBy({ id });
    // Hanya round AKTIF yang auto-terisi. Draft tetap kosong sampai
    // diaktifkan; closed sudah final.
    if (round && round.status === "active") await this.syncActiveSchools(id);
    return this.db.query(
      `select rs.school_id, rs.status, s.name as school_name,
              coalesce(rg.name, 'Tanpa Kabupaten') as region_name,
              rs.carry_points::int as carry_points,
              coalesce(pt.points, 0)::int as round_points,
              (rs.carry_points + coalesce(pt.points, 0))::int as points,
              (select count(*) from participants p
               where p.school_id = s.id and p.status = 'active')::int as participants
       from round_schools rs
       join schools s on s.id = rs.school_id
       left join regions rg on rg.id = s.region_id
       left join lateral (
         select coalesce(sum(p.total_points), 0) as points
         from participants p
         where p.school_id = rs.school_id and p.status = 'active'
       ) pt on true
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

  /**
   * Buat gelombang dengan seluruh pengaturan sekaligus (dipakai admin saat
   * menyiapkan seri gelombang: Grup A/B/C dengan jadwal auto-close).
   */
  async createFull(dto: {
    name: string;
    sequence?: number;
    top_n?: number;
    select_mode?: "per_region" | "global";
    scheduled_close_at?: string | null;
    activate?: boolean;
  }) {
    const mode = dto.select_mode ?? "per_region";
    const cap = mode === "global" ? 5000 : 100;
    return this.db.transaction(async (em) => {
      const rr = em.getRepository(Round);
      // Hanya satu round aktif pada satu waktu.
      if (dto.activate) {
        await rr.update({ status: "active" }, { status: "draft" });
      }
      return rr.save(
        rr.create({
          name: dto.name.trim(),
          sequence: Math.max(0, dto.sequence ?? 0),
          selectMode: mode,
          topN: Math.max(1, Math.min(dto.top_n ?? 1, cap)),
          scheduledCloseAt: dto.scheduled_close_at
            ? new Date(dto.scheduled_close_at)
            : null,
          status: dto.activate ? "active" : "draft",
          startsAt: dto.activate ? new Date() : null,
        }),
      );
    });
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

    if (source === "gugur") {
      if (!fromRoundId) {
        throw new BadRequestException("Pilih gelombang sumber (yang gugur).");
      }
      // Sekolah gugur + poin akhirnya di round sumber (carry + vote round itu).
      // Carry round baru = floor(50% poin akhir). Poin peserta asli tak diubah.
      const rows: { school_id: string; final_points: number }[] =
        await this.db.query(
          `select rs.school_id,
                  (rs.carry_points + coalesce(v.points, 0))::int as final_points
           from round_schools rs
           left join lateral (
             select coalesce(sum(dv.points), 0) as points
             from daily_votes dv
             join participants p on p.id = dv.participant_id
             where dv.round_id = $1 and p.school_id = rs.school_id
           ) v on true
           where rs.round_id = $1 and rs.status = 'gugur'`,
          [fromRoundId],
        );
      if (rows.length === 0) {
        throw new BadRequestException("Tidak ada sekolah gugur di gelombang itu.");
      }
      // Idempotent + set carry. Update carry juga saat sudah ada (re-populate).
      for (const r of rows) {
        await this.db.query(
          `insert into round_schools (round_id, school_id, status, carry_points)
           values ($1, $2, 'active', $3)
           on conflict (round_id, school_id)
           do update set carry_points = excluded.carry_points`,
          [id, r.school_id, Math.floor(r.final_points * 0.5)],
        );
      }
      return { ok: true, added: rows.length };
    }

    const rows: { id: string }[] = await this.db.query(
      `select distinct s.id from schools s
       join participants p on p.school_id = s.id and p.status = 'active'`,
    );
    const schoolIds = rows.map((r) => r.id);
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
  async standings(id: string) {
    const round = await this.rounds.findOneBy({ id });
    // Hanya round AKTIF yang auto-terisi. Draft tetap kosong sampai
    // diaktifkan; closed sudah final.
    if (round && round.status === "active") await this.syncActiveSchools(id);
    return this.db.query(
      `select rs.school_id, s.name as school_name, rs.status,
              rg.id as region_id, coalesce(rg.name, 'Tanpa Kabupaten') as region_name,
              rs.carry_points::int as carry_points,
              coalesce(pt.points, 0)::int as round_points,
              (rs.carry_points + coalesce(pt.points, 0))::int as points,
              coalesce(rv.votes, 0)::int as votes
       from round_schools rs
       join schools s on s.id = rs.school_id
       left join regions rg on rg.id = s.region_id
       left join lateral (
         select coalesce(sum(p.total_points), 0) as points
         from participants p
         where p.school_id = rs.school_id and p.status = 'active'
       ) pt on true
       left join lateral (
         select count(*) as votes
         from daily_votes dv
         join participants p on p.id = dv.participant_id
         where dv.round_id = $1 and p.school_id = rs.school_id
       ) rv on true
       where rs.round_id = $1
       order by region_name, points desc`,
      [id],
    );
  }

  /**
   * Tutup gelombang + promosi + gulir otomatis ke gelombang berikutnya.
   *
   * 1. Sync keanggotaan (semua sekolah dgn peserta ikut dinilai).
   * 2. Top-N sekolah per kabupaten → 'lolos', sisanya 'gugur'.
   * 3. Buat gelombang berikutnya (aktif) berisi sekolah GUGUR dengan
   *    carry_points = 50% poin akhirnya. Sekolah lolos tidak ikut.
   * 4. Sync sekolah dgn peserta baru ke gelombang berikutnya (auto).
   *
   * Mengembalikan id gelombang baru agar UI bisa langsung refresh.
   */
  async close(
    id: string,
    topN?: number,
    selectMode?: "per_region" | "global",
  ) {
    const round = await this.mustExist(id);
    if (round.status === "closed") {
      throw new BadRequestException("Gelombang sudah ditutup.");
    }
    const mode = selectMode ?? round.selectMode ?? "per_region";
    // Global (mis. 200 semifinalis) butuh cap lebih tinggi dari per-kabupaten.
    const cap = mode === "global" ? 5000 : 100;
    const n = Math.max(1, Math.min(topN || round.topN || 1, cap));

    // Pastikan semua sekolah dgn peserta tercatat sebelum dinilai.
    await this.syncActiveSchools(id);

    let nextRoundId = "";
    await this.db.transaction(async (em) => {
      // Ranking → set lolos/gugur. 'global' = lintas kabupaten (1 partisi),
      // 'per_region' = per kabupaten.
      const partition =
        mode === "global"
          ? "partition by 1"
          : "partition by coalesce(rg.id::text, 'none')";
      await em.query(
        `with ranked as (
           select rs.id,
                  row_number() over (
                    ${partition}
                    order by (rs.carry_points + coalesce(v.points, 0)) desc, s.name
                  ) as rnk
           from round_schools rs
           join schools s on s.id = rs.school_id
           left join regions rg on rg.id = s.region_id
           left join lateral (
             select coalesce(sum(p.total_points), 0) as points
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

      // Nonaktifkan round aktif lain (harusnya cuma ini).
      await em
        .getRepository(Round)
        .update({ status: "active" }, { status: "draft" });

      // Gelombang berikutnya = draft dengan sequence terdekat > sequence ini.
      // Kalau tak ada (mis. sudah gelombang terakhir), bikin 'Lanjutan' baru.
      const rr = em.getRepository(Round);
      let next = await rr
        .createQueryBuilder("r")
        .where("r.status = :st", { st: "draft" })
        .andWhere("r.sequence > :seq", { seq: round.sequence })
        .orderBy("r.sequence", "ASC")
        .addOrderBy("r.created_at", "ASC")
        .getOne();
      if (next) {
        next.status = "active";
        next.startsAt = new Date();
        await rr.save(next);
      } else {
        next = await rr.save(
          rr.create({
            name: `${round.name} — Lanjutan`,
            topN: round.topN,
            selectMode: round.selectMode,
            sequence: round.sequence + 1,
            status: "active",
            startsAt: new Date(),
          }),
        );
      }
      nextRoundId = next.id;

      // Isi sekolah GUGUR + carry 50% dari poin akhir mereka di round ini.
      await em.query(
        `insert into round_schools (round_id, school_id, status, carry_points)
         select $2, rs.school_id, 'active',
                floor((rs.carry_points + coalesce(v.points, 0)) * 0.5)::int
         from round_schools rs
         left join lateral (
           select coalesce(sum(p.total_points), 0) as points
           from participants p
           where p.school_id = rs.school_id and p.status = 'active'
         ) v on true
         where rs.round_id = $1 and rs.status = 'gugur'
         on conflict (round_id, school_id) do nothing`,
        [id, nextRoundId],
      );

      // Sekolah dgn peserta (termasuk pendaftar baru) yang BELUM ikut
      // (mis. sekolah baru / yang lolos tidak dimasukkan di atas) → auto.
      // Catatan: sekolah lolos TIDAK ikut, jadi kecualikan yang lolos di round ini.
      await em.query(
        `insert into round_schools (round_id, school_id, status)
         select $2, s.id, 'active'
         from schools s
         where exists (
           select 1 from participants p
           where p.school_id = s.id and p.status = 'active'
         )
         and not exists (
           select 1 from round_schools rl
           where rl.round_id = $1 and rl.school_id = s.id and rl.status = 'lolos'
         )
         on conflict (round_id, school_id) do nothing`,
        [id, nextRoundId],
      );
    });
    return { ok: true, next_round_id: nextRoundId };
  }

  /**
   * Boost sintetis: tambah N vote bot ke sekolah target, dibagi acak ke
   * peserta aktif sekolah itu. Tiap vote = +5 poin, ditandai is_bot=true dan
   * distempel round ini agar bisa di-rollback. total_points peserta ikut naik.
   */
  async botBoost(roundId: string, schoolId: string, votes: number) {
    const round = await this.mustExist(roundId);
    if (round.status === "closed") {
      throw new BadRequestException("Gelombang sudah ditutup.");
    }
    const n = Math.max(1, Math.min(Math.floor(votes), 10000));

    const parts: { id: string }[] = await this.db.query(
      `select id from participants where school_id = $1 and status = 'active'`,
      [schoolId],
    );
    if (parts.length === 0) {
      throw new BadRequestException(
        "Sekolah ini tidak punya peserta aktif untuk di-boost.",
      );
    }

    const POINTS = 5;
    await this.db.transaction(async (em) => {
      // Bagi N vote acak ke peserta (round-robin dari urutan yang di-shuffle
      // secara deterministik per index — cukup untuk sebaran boost).
      const tally = new Map<string, number>();
      for (let i = 0; i < n; i++) {
        const p = parts[(i * 7 + 3) % parts.length];
        tally.set(p.id, (tally.get(p.id) ?? 0) + 1);
      }
      for (const [participantId, count] of tally) {
        // Satu baris per vote; fingerprint unik agar tak tabrak unique index.
        for (let k = 0; k < count; k++) {
          await em.query(
            `insert into daily_votes
               (participant_id, round_id, vote_kind, points, is_bot,
                device_fingerprint, voter_name)
             values ($1, $2, 'daily5', $3, true,
                     'bot:' || gen_random_uuid()::text, 'Boost')`,
            [participantId, roundId, POINTS],
          );
        }
        await em.query(
          `update participants set total_points = total_points + $2 where id = $1`,
          [participantId, count * POINTS],
        );
      }
    });
    return { ok: true, votes: n, participants: parts.length, points: n * POINTS };
  }

  /** Rollback semua vote bot di gelombang ini (kurangi kembali poin peserta). */
  async removeBotVotes(roundId: string) {
    await this.mustExist(roundId);
    const result = await this.db.transaction(async (em) => {
      // Kembalikan poin per peserta sesuai total vote bot mereka di round ini.
      await em.query(
        `update participants p set total_points = greatest(0, p.total_points - agg.pts)
         from (
           select participant_id, coalesce(sum(points), 0) as pts
           from daily_votes
           where round_id = $1 and is_bot = true
           group by participant_id
         ) agg
         where agg.participant_id = p.id`,
        [roundId],
      );
      const del: { count: string }[] = await em.query(
        `with d as (
           delete from daily_votes where round_id = $1 and is_bot = true returning 1
         ) select count(*)::text as count from d`,
        [roundId],
      );
      return Number(del[0]?.count ?? 0);
    });
    return { ok: true, removed: result };
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
      `select rg.id as region_id, rg.name as region_name, rg.code,
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
       where rg.level = 'regency'
       group by rg.id, rg.name, rg.code
       order by points desc, rg.name`,
    );
  }
}
