import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, EntityManager, Repository } from "typeorm";
import { Round, RoundParticipant } from "../../database/entities";

/** Batas atas top_n. Semifinal global bisa ratusan (mis. 200 peserta). */
const TOP_N_CAP = 5000;

/**
 * Skor peserta dalam satu round = carry_points + poin vote yang masuk di
 * round itu. Dipakai berulang di standings/close/populate, jadi satu sumber.
 * Query yang memakainya harus menaruh round_id di $1.
 */
const ROUND_POINTS_LATERAL = `
  left join lateral (
    select coalesce(sum(dv.points), 0) as points
    from daily_votes dv
    where dv.participant_id = rp.participant_id and dv.round_id = $1
  ) pt on true`;

@Injectable()
export class RoundsService {
  constructor(
    private readonly db: DataSource,
    @InjectRepository(Round) private readonly rounds: Repository<Round>,
    @InjectRepository(RoundParticipant)
    private readonly roundParticipants: Repository<RoundParticipant>,
  ) {}

  /** Round yang sedang berjalan (dipakai stempel vote & halaman publik). */
  active(): Promise<Round | null> {
    return this.rounds.findOneBy({ status: "active" });
  }

  /**
   * Sinkron keanggotaan otomatis: setiap peserta aktif masuk round selama
   * round belum ditutup. Peserta baru daftar = langsung ikut nimbrung.
   * Idempotent (skip yang sudah ada). Tidak menyentuh carry_points / status
   * peserta yang sudah tercatat.
   */
  private async syncActiveParticipants(roundId: string): Promise<void> {
    // Peserta yang sudah lolos (di gelombang mana pun) atau ditandai Golden
    // Buzzer tidak ikut lagi: 1 peserta hanya bisa lolos sekali, dan yang
    // sudah lolos berhenti berkompetisi.
    await this.db.query(
      `insert into round_participants (round_id, participant_id, status)
       select $1, p.id, 'active'
       from participants p
       where p.status = 'active'
         and p.golden_buzzer = false
         and not exists (
           select 1 from round_participants rl
           where rl.participant_id = p.id and rl.status = 'lolos'
         )
       on conflict (round_id, participant_id) do nothing`,
      [roundId],
    );
  }

  async list() {
    // Sync keanggotaan round aktif dulu agar participant_count akurat.
    const activeRound = await this.rounds.findOneBy({ status: "active" });
    if (activeRound) await this.syncActiveParticipants(activeRound.id);
    return this.db.query(`
      select r.*,
             -- Kuota efektif = dasar + sisa slot gelombang sebelumnya
             -- yang sudah ditutup (ketentuan akumulasi slot).
             (r.top_n + coalesce((
                select sum(greatest(pr.top_n - (
                  -- Slot terpakai HANYA yang lolos lewat gelombang. Golden
                  -- Buzzer jalur terpisah dan tidak memakai slot gelombang,
                  -- jadi slot yang ditinggalkannya ikut digulirkan.
                  select count(*) from round_participants rp2
                    join participants p2 on p2.id = rp2.participant_id
                   where rp2.round_id = pr.id and rp2.status = 'lolos'
                     and p2.golden_buzzer = false
                ), 0))
                from rounds pr
                where pr.sequence < r.sequence and pr.status = 'closed'
             ), 0))::int as effective_quota,
             coalesce((
                select sum(greatest(pr.top_n - (
                  -- Slot terpakai HANYA yang lolos lewat gelombang. Golden
                  -- Buzzer jalur terpisah dan tidak memakai slot gelombang,
                  -- jadi slot yang ditinggalkannya ikut digulirkan.
                  select count(*) from round_participants rp2
                    join participants p2 on p2.id = rp2.participant_id
                   where rp2.round_id = pr.id and rp2.status = 'lolos'
                     and p2.golden_buzzer = false
                ), 0))
                from rounds pr
                where pr.sequence < r.sequence and pr.status = 'closed'
             ), 0)::int as carried_slots,
             (select count(*) from round_participants rp
               where rp.round_id = r.id)::int                         as participant_count,
             (select count(distinct p.school_id) from round_participants rp
               join participants p on p.id = rp.participant_id
               where rp.round_id = r.id)::int                         as school_count,
             (select count(*) from round_participants rp
               join participants p on p.id = rp.participant_id
               where rp.round_id = r.id and rp.status = 'lolos'
                 and p.golden_buzzer = false)::int as lolos_count,
             (select coalesce(sum(
                 rp.carry_points + coalesce((
                   select sum(dv.points) from daily_votes dv
                   where dv.participant_id = rp.participant_id
                     and dv.round_id = r.id
                 ), 0)
               ), 0)
              from round_participants rp
              where rp.round_id = r.id)::int                          as total_points
      from rounds r
      order by r.created_at`);
  }

  /** Versi publik: hanya round aktif/selesai (draft disembunyikan). */
  publicList() {
    return this.db.query(`
      select r.id, r.name, r.status, r.starts_at, r.ends_at, r.top_n,
             r.sequence, r.is_final,
             -- Kuota efektif = dasar + sisa slot gelombang sebelumnya
             -- yang sudah ditutup (ketentuan akumulasi slot).
             (r.top_n + coalesce((
                select sum(greatest(pr.top_n - (
                  -- Slot terpakai HANYA yang lolos lewat gelombang. Golden
                  -- Buzzer jalur terpisah dan tidak memakai slot gelombang,
                  -- jadi slot yang ditinggalkannya ikut digulirkan.
                  select count(*) from round_participants rp2
                    join participants p2 on p2.id = rp2.participant_id
                   where rp2.round_id = pr.id and rp2.status = 'lolos'
                     and p2.golden_buzzer = false
                ), 0))
                from rounds pr
                where pr.sequence < r.sequence and pr.status = 'closed'
             ), 0))::int as effective_quota,
             coalesce((
                select sum(greatest(pr.top_n - (
                  -- Slot terpakai HANYA yang lolos lewat gelombang. Golden
                  -- Buzzer jalur terpisah dan tidak memakai slot gelombang,
                  -- jadi slot yang ditinggalkannya ikut digulirkan.
                  select count(*) from round_participants rp2
                    join participants p2 on p2.id = rp2.participant_id
                   where rp2.round_id = pr.id and rp2.status = 'lolos'
                     and p2.golden_buzzer = false
                ), 0))
                from rounds pr
                where pr.sequence < r.sequence and pr.status = 'closed'
             ), 0)::int as carried_slots,
             (select count(*) from round_participants rp
               where rp.round_id = r.id)::int as participant_count,
             (select count(*) from round_participants rp
               join participants p on p.id = rp.participant_id
               where rp.round_id = r.id and rp.status = 'lolos'
                 and p.golden_buzzer = false)::int
               as lolos_count,
             (select count(distinct p.school_id) from round_participants rp
               join participants p on p.id = rp.participant_id
               where rp.round_id = r.id)::int as school_count
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
      is_final?: boolean;
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
    if (dto.is_final !== undefined) round.isFinal = dto.is_final;
    if (dto.top_n !== undefined) {
      round.topN = Math.max(1, Math.min(dto.top_n, TOP_N_CAP));
    }
    await this.rounds.save(round);
    return { ok: true };
  }

  /** Daftar peserta dalam round (nama, sekolah, kabupaten, status, skor). */
  async roundParticipantList(id: string) {
    const round = await this.rounds.findOneBy({ id });
    // Hanya round AKTIF yang auto-terisi. Draft tetap kosong sampai
    // diaktifkan; closed sudah final.
    if (round && round.status === "active") {
      await this.syncActiveParticipants(id);
    }
    return this.db.query(
      `select rp.participant_id, rp.status, p.name as participant_name,
              p.photo_url, p.school_id,
              coalesce(s.name, 'Tanpa Sekolah') as school_name,
              coalesce(rg.name, 'Tanpa Kabupaten') as region_name,
              rp.carry_points::int as carry_points,
              coalesce(pt.points, 0)::int as round_points,
              (rp.carry_points + coalesce(pt.points, 0))::int as points
       from round_participants rp
       join participants p on p.id = rp.participant_id
       left join schools s on s.id = p.school_id
       left join regions rg on rg.id = s.region_id
       ${ROUND_POINTS_LATERAL}
       where rp.round_id = $1
       order by points desc, p.name`,
      [id],
    );
  }

  /** Tambah satu peserta ke round (idempotent). */
  async addParticipant(id: string, participantId: string) {
    const round = await this.mustExist(id);
    if (round.status === "closed") {
      throw new BadRequestException("Gelombang sudah ditutup.");
    }
    await this.db.query(
      `insert into round_participants (round_id, participant_id, status)
       values ($1, $2, 'active')
       on conflict (round_id, participant_id) do nothing`,
      [id, participantId],
    );
    return { ok: true };
  }

  /** Keluarkan peserta dari round. */
  async removeParticipant(id: string, participantId: string) {
    const round = await this.mustExist(id);
    if (round.status === "closed") {
      throw new BadRequestException("Gelombang sudah ditutup.");
    }
    await this.roundParticipants.delete({ roundId: id, participantId });
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
    is_final?: boolean;
  }) {
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
          selectMode: dto.select_mode ?? "global",
          topN: Math.max(1, Math.min(dto.top_n ?? 1, TOP_N_CAP)),
          scheduledCloseAt: dto.scheduled_close_at
            ? new Date(dto.scheduled_close_at)
            : null,
          isFinal: dto.is_final ?? false,
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
   * Isi peserta gelombang: semua peserta aktif, atau hanya yang gugur di
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
      // Peserta gugur + poin akhirnya di round sumber (carry + vote round itu).
      // Carry round baru = floor(50% poin akhir). total_points peserta tak
      // diubah.
      const rows: { participant_id: string; final_points: number }[] =
        await this.db.query(
          `select rp.participant_id,
                  (rp.carry_points + coalesce(pt.points, 0))::int as final_points
           from round_participants rp
           ${ROUND_POINTS_LATERAL}
           where rp.round_id = $1 and rp.status = 'gugur'`,
          [fromRoundId],
        );
      if (rows.length === 0) {
        throw new BadRequestException(
          "Tidak ada peserta gugur di gelombang itu.",
        );
      }
      // Idempotent + set carry. Update carry juga saat sudah ada (re-populate).
      for (const r of rows) {
        await this.db.query(
          `insert into round_participants
             (round_id, participant_id, status, carry_points)
           values ($1, $2, 'active', $3)
           on conflict (round_id, participant_id)
           do update set carry_points = excluded.carry_points`,
          [id, r.participant_id, Math.floor(r.final_points * 0.5)],
        );
      }
      return { ok: true, added: rows.length };
    }

    const rows: { id: string }[] = await this.db.query(
      `select id from participants where status = 'active'`,
    );
    const participantIds = rows.map((r) => r.id);
    if (participantIds.length === 0) {
      throw new BadRequestException("Tidak ada peserta untuk dimasukkan.");
    }
    // Idempotent: skip peserta yang sudah terdaftar di round ini.
    await this.db.query(
      `insert into round_participants (round_id, participant_id, status)
       select $1, unnest($2::uuid[]), 'active'
       on conflict (round_id, participant_id) do nothing`,
      [id, participantIds],
    );
    return { ok: true, added: participantIds.length };
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
   * Klasemen PESERTA dalam satu round. Skor = carry_points + poin vote yang
   * masuk di round ini. Sekolah/kabupaten ikut dibawa sebagai label asal
   * peserta (untuk filter tampilan), bukan sebagai unit yang dinilai.
   */
  async standings(id: string) {
    const round = await this.rounds.findOneBy({ id });
    // Hanya round AKTIF yang auto-terisi. Draft tetap kosong sampai
    // diaktifkan; closed sudah final.
    if (round && round.status === "active") {
      await this.syncActiveParticipants(id);
    }
    return this.db.query(
      `select rp.participant_id, p.name as participant_name, p.photo_url,
              rp.status,
              p.school_id, coalesce(s.name, 'Tanpa Sekolah') as school_name,
              rg.id as region_id,
              coalesce(rg.name, 'Tanpa Kabupaten') as region_name,
              prov.id as province_id,
              coalesce(prov.name, 'Tanpa Provinsi') as province_name,
              rp.carry_points::int as carry_points,
              coalesce(pt.points, 0)::int as round_points,
              (rp.carry_points + coalesce(pt.points, 0))::int as points,
              coalesce(rv.votes, 0)::int as votes,
              rank() over (
                order by (rp.carry_points + coalesce(pt.points, 0)) desc
              )::int as rank
       from round_participants rp
       join participants p on p.id = rp.participant_id
       left join schools s on s.id = p.school_id
       left join regions rg on rg.id = s.region_id
       left join regions prov on prov.id = rg.parent_id
       ${ROUND_POINTS_LATERAL}
       left join lateral (
         select count(*) as votes
         from daily_votes dv
         where dv.participant_id = rp.participant_id and dv.round_id = $1
       ) rv on true
       where rp.round_id = $1
       order by points desc, p.name`,
      [id],
    );
  }

  /**
   * Seluruh peserta yang LOLOS, lintas gelombang, beserta gelombang tempat
   * mereka lolos. Dipakai halaman admin "Hasil Lolos" (+ekspor) dan halaman
   * publik daftar peserta lolos.
   *
   * Catatan: satu peserta bisa gugur di gelombang awal lalu lolos di
   * gelombang susulan. Yang dihitung hanya baris berstatus 'lolos', jadi tiap
   * peserta muncul sekali per gelombang yang dia lolosi (normalnya satu).
   * Hanya gelombang yang sudah ditutup yang punya hasil final.
   */
  /**
   * Kuota EFEKTIF satu gelombang = kuota dasar (top_n) + akumulasi sisa slot
   * dari SELURUH gelombang sebelumnya yang sudah ditutup.
   *
   * Sisa slot = kuota dasar gelombang itu dikurangi jumlah yang benar-benar
   * lolos. Sesuai ketentuan akumulasi, slot yang tak terisi tidak hangus.
   *
   * Sengaja dihitung ulang tiap kali dibaca, bukan disimpan: panitia bisa
   * menambah/mengurangi peserta lolos kapan pun lewat panel Atur Peserta
   * Lolos, dan kuota gelombang setelahnya harus langsung ikut menyesuaikan.
   */
  async effectiveQuota(roundId: string) {
    const [row]: {
      base: number;
      carried: number;
      effective: number;
      lolos: number;
    }[] = await this.db.query(
      `with target as (
         select id, top_n, sequence from rounds where id = $1
       ),
       -- Sisa slot tiap gelombang sebelum gelombang ini yang sudah ditutup.
       leftovers as (
         select greatest(
                  r.top_n - (
                    select count(*) from round_participants rp
                      join participants p on p.id = rp.participant_id
                     where rp.round_id = r.id and rp.status = 'lolos'
                       and p.golden_buzzer = false
                  ), 0)::int as sisa
         from rounds r, target t
         where r.sequence < t.sequence and r.status = 'closed'
       )
       select t.top_n::int as base,
              coalesce((select sum(sisa) from leftovers), 0)::int as carried,
              (t.top_n + coalesce((select sum(sisa) from leftovers), 0))::int
                as effective,
              (select count(*) from round_participants rp
                 join participants p on p.id = rp.participant_id
                where rp.round_id = t.id and rp.status = 'lolos'
                  and p.golden_buzzer = false)::int as lolos
       from target t`,
      [roundId],
    );
    if (!row) throw new NotFoundException("Gelombang tidak ditemukan.");
    return {
      base: row.base,
      carried: row.carried,
      effective: Math.min(row.effective, TOP_N_CAP),
      lolos: row.lolos,
    };
  }

  /** Gelombang setelah ini (sequence terdekat di atasnya). Null = penutup. */
  private async nextRoundOf(em: EntityManager, sequence: number) {
    const [next]: { id: string; name: string }[] = await em.query(
      `select id, name from rounds
        where sequence > $1
        order by sequence, created_at
        limit 1`,
      [sequence],
    );
    return next ?? null;
  }

  /**
   * Turunkan satu peserta lolos jadi gugur, TANPA pengganti. Dipakai kalau
   * panitia ingin mengurangi jumlah yang lolos (mis. 200 jadi 190), bukan
   * menukar. Peserta masuk gelombang berikutnya dengan carry 50% poin
   * akhirnya, aturan yang sama dengan penutupan normal.
   */
  private async demoteOne(
    em: EntityManager,
    roundId: string,
    participantId: string,
    nextRound: { id: string; name: string } | null,
  ) {
    const [row]: { name: string; points: number }[] = await em.query(
      `select p.name,
              (rp.carry_points + coalesce(pt.points, 0))::int as points
         from round_participants rp
         join participants p on p.id = rp.participant_id
         left join lateral (
           select coalesce(sum(dv.points), 0) as points
           from daily_votes dv
           where dv.participant_id = rp.participant_id
             and dv.round_id = $1
         ) pt on true
        where rp.round_id = $1 and rp.participant_id = $2
          and rp.status = 'lolos'`,
      [roundId, participantId],
    );
    if (!row) {
      throw new BadRequestException(
        "Peserta yang diturunkan tidak berstatus lolos di gelombang ini.",
      );
    }

    await em.query(
      `update round_participants set status = 'gugur'
        where round_id = $1 and participant_id = $2`,
      [roundId, participantId],
    );

    const carry = Math.floor(row.points * 0.5);
    if (nextRound) {
      await em.query(
        `insert into round_participants
           (round_id, participant_id, status, carry_points)
         values ($1, $2, 'active', $3)
         on conflict (round_id, participant_id)
         do update set status = 'active', carry_points = excluded.carry_points`,
        [nextRound.id, participantId, carry],
      );
    }
    return { name: row.name, carry_points: carry };
  }

  /**
   * Naikkan satu peserta jadi lolos, TANPA menurunkan siapa pun. Dipakai
   * kalau panitia ingin menambah jumlah yang lolos.
   */
  private async promoteOne(
    em: EntityManager,
    roundId: string,
    participantId: string,
    nextRound: { id: string; name: string } | null,
  ) {
    const [row]: { name: string; status: string }[] = await em.query(
      `select p.name, rp.status
         from round_participants rp
         join participants p on p.id = rp.participant_id
        where rp.round_id = $1 and rp.participant_id = $2`,
      [roundId, participantId],
    );
    if (!row) {
      throw new BadRequestException(
        "Peserta yang dinaikkan tidak terdaftar di gelombang ini.",
      );
    }
    if (row.status === "lolos") {
      throw new BadRequestException(`${row.name} sudah lolos.`);
    }

    await em.query(
      `update round_participants set status = 'lolos'
        where round_id = $1 and participant_id = $2`,
      [roundId, participantId],
    );
    // Yang lolos berhenti berkompetisi → keluar dari gelombang lanjut.
    if (nextRound) {
      await em.query(
        `delete from round_participants
          where round_id = $1 and participant_id = $2`,
        [nextRound.id, participantId],
      );
    }
    return { name: row.name };
  }

  /**
   * Ubah daftar peserta lolos satu gelombang: naikkan, turunkan, atau
   * dua-duanya sekaligus. Jumlah kedua sisi TIDAK harus sama, jadi panitia
   * bisa sekadar mengurangi yang lolos (mis. 200 jadi 190) atau menambah.
   *
   * Dijalankan berurutan dalam satu transaksi: kalau satu pasang gagal,
   * semuanya dibatalkan, jadi tak ada kondisi setengah tertukar.
   */
  async swapQualifiedBulk(
    roundId: string,
    promoteIds: string[],
    demoteIds: string[],
  ) {
    const promote = [...new Set(promoteIds)];
    const demote = [...new Set(demoteIds)];
    if (promote.length === 0 && demote.length === 0) {
      throw new BadRequestException("Pilih minimal satu peserta.");
    }
    if (promote.some((id) => demote.includes(id))) {
      throw new BadRequestException(
        "Ada peserta yang dipilih di kedua sisi sekaligus.",
      );
    }

    const round = await this.mustExist(roundId);

    return this.db.transaction(async (em) => {
      const next = await this.nextRoundOf(em, round.sequence);

      // Turunkan dulu, baru naikkan. Urutan ini penting kalau nanti ada
      // pembatasan kuota: slot dilepas sebelum diisi.
      const demoted = [];
      for (const id of demote) {
        demoted.push(await this.demoteOne(em, roundId, id, next));
      }
      const promoted = [];
      for (const id of promote) {
        promoted.push(await this.promoteOne(em, roundId, id, next));
      }

      // Jumlah lolos setelah perubahan, biar UI bisa menampilkannya.
      const [count]: { total: number }[] = await em.query(
        `select count(*)::int as total from round_participants
          where round_id = $1 and status = 'lolos'`,
        [roundId],
      );

      return {
        ok: true,
        promoted_count: promoted.length,
        demoted_count: demoted.length,
        lolos_total: count?.total ?? 0,
        next_round: next?.name ?? null,
        promoted,
        demoted,
      };
    });
  }

  /**
   * SATU pintu untuk mengambil peserta yang sudah "aman": Golden Buzzer,
   * peserta lolos gelombang tertentu, atau keduanya sekaligus.
   *
   * source:
   *  - 'all'           (default) Golden Buzzer + semua peserta lolos
   *  - 'golden_buzzer' hanya Golden Buzzer
   *  - 'round'         hanya peserta lolos; pakai `round` untuk memilih
   *                    gelombangnya (nama seperti 'Grup A' atau UUID),
   *                    kosongkan untuk semua gelombang.
   *
   * Tiap baris punya kolom `via` ('golden_buzzer' | 'round') dan `round_name`
   * supaya pemakai API tahu peserta itu lolos lewat jalur mana.
   */
  winners(opts: { source?: string; round?: string } = {}) {
    const source = opts.source ?? "all";
    if (!["all", "golden_buzzer", "round"].includes(source)) {
      throw new BadRequestException(
        "source harus 'all', 'golden_buzzer', atau 'round'.",
      );
    }
    const roundKey = opts.round?.trim() || null;
    // Filter gelombang menerima UUID atau nama (mis. 'Grup A'), biar API
    // enak dipakai tanpa harus tahu id-nya.
    const isUuid =
      !!roundKey &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        roundKey,
      );

    return this.db.query(
      `with golden as (
         select 'golden_buzzer'::text as via,
                p.id as participant_id, p.name as participant_name,
                p.photo_url, p.description,
                p.school_id, coalesce(s.name, 'Tanpa Sekolah') as school_name,
                coalesce(rg.name, 'Tanpa Kabupaten') as region_name,
                coalesce(prov.name, 'Tanpa Provinsi') as province_name,
                null::uuid as round_id, null::text as round_name,
                null::int as sequence,
                p.total_points::int as points,
                p.golden_buzzer_at as decided_at
         from participants p
         left join schools s on s.id = p.school_id
         left join regions rg on rg.id = s.region_id
         left join regions prov on prov.id = rg.parent_id
         where p.golden_buzzer = true and p.status = 'active'
           and $1 in ('all', 'golden_buzzer')
       ),
       lolos as (
         select 'round'::text as via,
                p.id as participant_id, p.name as participant_name,
                p.photo_url, p.description,
                p.school_id, coalesce(s.name, 'Tanpa Sekolah') as school_name,
                coalesce(rg.name, 'Tanpa Kabupaten') as region_name,
                coalesce(prov.name, 'Tanpa Provinsi') as province_name,
                r.id as round_id, r.name as round_name, r.sequence,
                (rp.carry_points + coalesce(pt.points, 0))::int as points,
                r.ends_at as decided_at
         from round_participants rp
         join rounds r on r.id = rp.round_id
         join participants p on p.id = rp.participant_id
         left join schools s on s.id = p.school_id
         left join regions rg on rg.id = s.region_id
         left join regions prov on prov.id = rg.parent_id
         left join lateral (
           select coalesce(sum(dv.points), 0) as points
           from daily_votes dv
           where dv.participant_id = rp.participant_id
             and dv.round_id = rp.round_id
         ) pt on true
         where rp.status = 'lolos'
           -- Golden Buzzer sudah diambil blok di atas; jangan dobel.
           and p.golden_buzzer = false
           and $1 in ('all', 'round')
           and (
             $2::text is null
             or ($3::boolean and r.id::text = $2)
             or (not $3::boolean and lower(r.name) = lower($2))
           )
       )
       select * from golden
       union all
       select * from lolos
       order by sequence nulls first, points desc, participant_name`,
      [source, roundKey, isUuid],
    );
  }

  qualified(roundId?: string) {
    return this.db.query(
      `select rp.participant_id, p.name as participant_name, p.photo_url,
              p.school_id, coalesce(s.name, 'Tanpa Sekolah') as school_name,
              coalesce(rg.name, 'Tanpa Kabupaten') as region_name,
              coalesce(prov.name, 'Tanpa Provinsi') as province_name,
              r.id as round_id, r.name as round_name, r.sequence,
              r.ends_at,
              (rp.carry_points + coalesce(pt.points, 0))::int as points
       from round_participants rp
       join rounds r on r.id = rp.round_id
       join participants p on p.id = rp.participant_id
       left join schools s on s.id = p.school_id
       left join regions rg on rg.id = s.region_id
       left join regions prov on prov.id = rg.parent_id
       left join lateral (
         select coalesce(sum(dv.points), 0) as points
         from daily_votes dv
         where dv.participant_id = rp.participant_id
           and dv.round_id = rp.round_id
       ) pt on true
       where rp.status = 'lolos'
         -- Golden Buzzer punya daftarnya sendiri. Kalau ikut di sini namanya
         -- tampil dobel, jadi dikecualikan walau baris lolosnya masih ada.
         and p.golden_buzzer = false
         and ($1::uuid is null or r.id = $1)
       order by r.sequence, points desc, p.name`,
      [roundId ?? null],
    );
  }

  /**
   * Tutup gelombang + promosi + gulir otomatis ke gelombang berikutnya.
   *
   * 1. Sync keanggotaan (semua peserta aktif ikut dinilai).
   * 2. Top-N PESERTA (global lintas kabupaten, mis. 200 semifinalis) →
   *    'lolos', sisanya 'gugur'.
   * 3. Buat gelombang berikutnya (aktif) berisi peserta GUGUR dengan
   *    carry_points = 50% poin akhirnya. Peserta lolos tidak ikut.
   * 4. Sync peserta baru ke gelombang berikutnya (auto).
   *
   * Mengembalikan id gelombang baru agar UI bisa langsung refresh.
   */
  async close(id: string, topN?: number, selectMode?: "per_region" | "global") {
    const round = await this.mustExist(id);
    if (round.status === "closed") {
      throw new BadRequestException("Gelombang sudah ditutup.");
    }
    const mode = selectMode ?? round.selectMode ?? "global";
    // Kuota efektif = dasar + akumulasi sisa slot gelombang sebelumnya.
    // topN eksplisit dari admin tetap menang kalau dikirim.
    const quota = await this.effectiveQuota(id);
    const n = Math.max(1, Math.min(topN || quota.effective || 1, TOP_N_CAP));

    // Pastikan semua peserta aktif tercatat sebelum dinilai.
    await this.syncActiveParticipants(id);

    let nextRoundId = "";
    await this.db.transaction(async (em) => {
      // Ranking peserta → set lolos/gugur. 'global' = lintas kabupaten
      // (1 partisi, mis. top 200 semifinalis), 'per_region' = per kabupaten
      // asal sekolah peserta.
      const partition =
        mode === "global"
          ? "partition by 1"
          : "partition by coalesce(rg.id::text, 'none')";
      await em.query(
        `with ranked as (
           select rp.id,
                  row_number() over (
                    ${partition}
                    order by (rp.carry_points + coalesce(pt.points, 0)) desc,
                             p.name
                  ) as rnk
           from round_participants rp
           join participants p on p.id = rp.participant_id
           left join schools s on s.id = p.school_id
           left join regions rg on rg.id = s.region_id
           ${ROUND_POINTS_LATERAL}
           where rp.round_id = $1
         )
         update round_participants rp set status =
           case when r.rnk <= $2 then 'lolos' else 'gugur' end
         from ranked r where r.id = rp.id`,
        [id, n],
      );
      await em
        .getRepository(Round)
        .update({ id }, { status: "closed", endsAt: new Date() });

      // Nonaktifkan round aktif lain (harusnya cuma ini).
      await em
        .getRepository(Round)
        .update({ status: "active" }, { status: "draft" });

      // Gelombang penutup: event berakhir di sini. Tak ada gelombang lanjutan,
      // yang gugur tidak digulirkan ke mana pun.
      if (round.isFinal) return;

      // Gelombang berikutnya = draft dengan sequence terdekat > sequence ini.
      // Kalau tak ada, bikin 'Lanjutan' baru (kecuali gelombang penutup di atas).
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
            name: `${round.name}, Lanjutan`,
            topN: round.topN,
            selectMode: round.selectMode,
            sequence: round.sequence + 1,
            status: "active",
            startsAt: new Date(),
          }),
        );
      }
      nextRoundId = next.id;

      // Isi peserta GUGUR + carry 50% dari poin akhir mereka di round ini.
      await em.query(
        `insert into round_participants
           (round_id, participant_id, status, carry_points)
         select $2, rp.participant_id, 'active',
                floor((rp.carry_points + coalesce(pt.points, 0)) * 0.5)::int
         from round_participants rp
         ${ROUND_POINTS_LATERAL}
         where rp.round_id = $1 and rp.status = 'gugur'
         on conflict (round_id, participant_id) do nothing`,
        [id, nextRoundId],
      );

      // Peserta aktif (termasuk pendaftar baru) yang BELUM ikut → auto.
      // Yang sudah lolos DI GELOMBANG MANA PUN atau Golden Buzzer tidak ikut
      // lagi: sudah lolos berarti berhenti berkompetisi.
      await em.query(
        `insert into round_participants (round_id, participant_id, status)
         select $1, p.id, 'active'
         from participants p
         where p.status = 'active'
           and p.golden_buzzer = false
           and not exists (
             select 1 from round_participants rl
             where rl.participant_id = p.id and rl.status = 'lolos'
           )
         on conflict (round_id, participant_id) do nothing`,
        [nextRoundId],
      );
    });
    return { ok: true, next_round_id: nextRoundId };
  }

  /**
   * Boost sintetis: tambah N vote bot ke satu peserta. Tiap vote ditandai
   * is_bot=true dan distempel round ini agar bisa di-rollback.
   * total_points peserta ikut naik.
   */
  async botBoost(roundId: string, participantId: string, votes: number) {
    const round = await this.mustExist(roundId);
    if (round.status === "closed") {
      throw new BadRequestException("Gelombang sudah ditutup.");
    }
    const n = Math.max(1, Math.min(Math.floor(votes), 10000));

    const found: { id: string }[] = await this.db.query(
      `select id from participants where id = $1 and status = 'active'`,
      [participantId],
    );
    if (found.length === 0) {
      throw new BadRequestException("Peserta tidak ditemukan atau tidak aktif.");
    }

    const POINTS = 1; // 1 vote = 1 poin (boost sintetis mengikuti aturan baru)
    await this.db.transaction(async (em) => {
      // Satu baris per vote; fingerprint unik agar tak tabrak unique index.
      for (let k = 0; k < n; k++) {
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
        [participantId, n * POINTS],
      );
      // Peserta yang di-boost otomatis ikut round ini.
      await em.query(
        `insert into round_participants (round_id, participant_id, status)
         values ($1, $2, 'active')
         on conflict (round_id, participant_id) do nothing`,
        [roundId, participantId],
      );
    });
    return { ok: true, votes: n, points: n * POINTS };
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
    await this.roundParticipants.delete({ roundId: id });
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
         where ($1::uuid is null or s.region_id = $1)
           and exists (
             select 1 from participants p
             where p.school_id = s.id and p.status = 'active'
           )
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
         where exists (
           select 1 from participants p
           where p.school_id = s.id and p.status = 'active'
         )
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
   * Agregasi heatmap per kabupaten. HANYA sekolah yang punya peserta yang
   * dihitung (bukan master sekolah). Poin = jumlah total_points peserta aktif;
   * votes = jumlah vote masuk. Kabupaten tanpa peserta tak muncul.
   */
  heatmap() {
    return this.db.query(
      `select rg.id as region_id, rg.name as region_name, rg.code,
              prov.name as province_name, prov.code as province_code,
              count(distinct p.school_id)::int as schools,
              count(distinct p.id)::int as participants,
              coalesce(sum(p.total_points), 0)::int as points,
              coalesce((
                select count(*) from daily_votes dv
                join participants p2 on p2.id = dv.participant_id
                join schools s2 on s2.id = p2.school_id
                where s2.region_id = rg.id
              ), 0)::int as votes
       from regions rg
       left join regions prov on prov.id = rg.parent_id
       join schools s on s.region_id = rg.id
       join participants p on p.school_id = s.id and p.status = 'active'
       where rg.level = 'regency'
       group by rg.id, rg.name, rg.code, prov.name, prov.code
       order by points desc, rg.name`,
    );
  }
}
