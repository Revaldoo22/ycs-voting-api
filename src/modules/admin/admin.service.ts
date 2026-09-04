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

export interface VoteHistoryFilters {
  participantId?: string;
  from?: string;
  to?: string;
  search?: string;
  status?: string;
  voterStatus?: string;
  school?: string;
  includeBot?: boolean;
  /**
   * `public` = `search` tak menyentuh nomor WA/email voter. Wajib untuk
   * pemanggil non-admin (web app kedua) supaya kontak voter tak bisa
   * ditebak lewat pencarian. Default `full` untuk dashboard admin.
   */
  searchScope?: "full" | "public";
  limit?: number;
  offset?: number;
  sort?: "recent" | "oldest";
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
 * Admin aggregates, SQL ported from the old Supabase RPCs
 * (admin_stats, daily_vote_series, voter_growth_series, admin_voters 0025,
 * admin_activity_log 0024, voter_distribution, participant_point_log 0022,
 * participant_supporters_detail). All rows snake_case (old API shape).
 */
@Injectable()
export class AdminService {
  constructor(private readonly db: DataSource) {}

  async stats() {
    // Angka dashboard sengaja dipilah, bukan satu total kasar, supaya panitia
    // tahu mana yang sudah sah dan mana yang masih antre. Beberapa jebakan
    // yang dihindari di sini:
    //  - vote bot (boost admin) bukan vote asli, jadi selalu dikecualikan
    //  - vote 'pending' belum menyumbang poin, jadi dipisah dari 'approved'
    //  - vote yang ditolak DIHAPUS dari daily_votes (agar voter bisa ulang),
    //    jejaknya hanya ada di tabel arsip rejections
    //  - peserta 'inactive' tidak ikut kompetisi, jadi dihitung terpisah
    //
    // total_voters SAMA definisinya dengan halaman Daftar Voter: gabungan
    // (pernah vote) ∪ (pernah quest approved) ∪ (voter onboarded walau belum
    // vote), supaya angka dashboard & daftar tidak beda.
    const rows = await this.db.query(`
      select
        (select count(distinct school_id) from participants
          where school_id is not null)::int                          as total_schools,

        -- Peserta
        (select count(*) from participants)::int                     as total_participants,
        (select count(*) from participants where status = 'active')::int
                                                                     as active_participants,
        (select count(*) from participants where status <> 'active')::int
                                                                     as inactive_participants,
        (select count(*) from participants where golden_buzzer = true
           and status = 'active')::int                               as golden_buzzers,
        (select count(*) from round_participants rp
           join participants p on p.id = rp.participant_id
          where rp.status = 'lolos' and p.golden_buzzer = false)::int as qualified_participants,
        (select count(*) from participants
          where status = 'active' and total_points > 0)::int         as participants_with_points,

        -- Voter (identitas unik, bukan jumlah vote)
        (select count(*) from (
           select voter_phone as phone from daily_votes
             where voter_phone is not null and is_bot = false
           union
           select voter_phone from submissions
             where status = 'approved' and voter_phone is not null
           union
           select phone_number from profiles
             where role = 'voter' and onboarded = true
               and phone_number is not null
        ) u)::int                                                    as total_voters,
        (select count(*) from profiles
          where role = 'voter' and onboarded = true)::int            as onboarded_voters,

        -- Vote (baris vote, bot tidak pernah ikut)
        (select count(*) from daily_votes where is_bot = false)::int as total_votes,
        (select count(*) from daily_votes
          where is_bot = false and status = 'approved')::int         as approved_votes,
        (select count(*) from daily_votes
          where is_bot = false and status = 'pending')::int          as pending_votes,
        -- Ditolak diambil dari arsip: barisnya sudah dihapus dari daily_votes
        -- supaya voter bisa mengajukan ulang.
        (select count(*) from rejections where kind = 'vote')::int   as rejected_votes,
        -- Voter unik yang pernah ditolak, lalu mengajukan ulang dan akhirnya
        -- disetujui. Menjawab "berapa yang tak menyerah setelah ditolak":
        -- angka ditolak saja tak bisa dibedakan antara benar-benar hilang
        -- atau sekadar mengulang. Dicocokkan lewat nomor WA karena baris
        -- vote aslinya sudah dihapus saat ditolak.
        (select count(distinct r.voter_phone) from rejections r
          where r.kind = 'vote' and r.voter_phone is not null
            and exists (
              select 1 from daily_votes dv
              where dv.voter_phone = r.voter_phone
                and dv.status = 'approved' and dv.is_bot = false
                and dv.created_at > r.created_at
            ))::int                                                  as recovered_voters,
        -- Voter unik yang ditolak dan TIDAK pernah kembali. Ini kehilangan
        -- yang sesungguhnya.
        (select count(distinct r.voter_phone) from rejections r
          where r.kind = 'vote' and r.voter_phone is not null
            and not exists (
              select 1 from daily_votes dv
              where dv.voter_phone = r.voter_phone
                and dv.status = 'approved' and dv.is_bot = false
                and dv.created_at > r.created_at
            ))::int                                                  as lost_voters,
        (select count(*) from daily_votes where is_bot = true)::int  as bot_votes,

        -- Klaim kupon
        (select count(*) from coupon_claims where status = 'pending')::int
                                                                     as pending_claims,
        (select count(*) from coupon_claims where status = 'approved')::int
                                                                     as approved_claims,
        (select count(*) from rejections where kind = 'coupon_claim')::int
                                                                     as rejected_claims,

        -- CORONG VOTER MURNI: akun yang bukan peserta, yaitu tidak ber-role
        -- 'participant' dan tidak punya record peserta yang cocok (lewat
        -- profile_id maupun email). Peserta sengaja dikeluarkan supaya corong
        -- ini benar-benar menggambarkan pendukung dari luar, bukan campuran.
        --
        -- Tiap tahap HIMPUNAN BAGIAN dari tahap sebelumnya, jadi tidak boleh
        -- dijumlahkan mentah-mentah:
        --   punya akun > onboarding selesai > pernah vote
        (select count(*) from profiles pr
          where pr.role = 'voter'
            and not exists (
              select 1 from participants p
              where p.profile_id = pr.id
                 or (pr.email is not null
                     and lower(p.email) = lower(pr.email))
            ))::int                                                  as accounts_total,
        (select count(*) from profiles pr
          where pr.role = 'voter' and pr.onboarded = true
            and not exists (
              select 1 from participants p
              where p.profile_id = pr.id
                 or (pr.email is not null
                     and lower(p.email) = lower(pr.email))
            ))::int                                                  as accounts_onboarded,
        (select count(*) from profiles pr
          where pr.role = 'voter' and pr.onboarded = false
            and not exists (
              select 1 from participants p
              where p.profile_id = pr.id
                 or (pr.email is not null
                     and lower(p.email) = lower(pr.email))
            ))::int                                                  as accounts_not_onboarded,
        -- Pernah vote dicocokkan lewat nomor WA maupun email, karena vote
        -- menyimpan identitas voter apa adanya, bukan referensi ke profil.
        (select count(*) from profiles pr
          where pr.role = 'voter'
            and not exists (
              select 1 from participants p
              where p.profile_id = pr.id
                 or (pr.email is not null
                     and lower(p.email) = lower(pr.email))
            )
            and exists (
              select 1 from daily_votes dv
              where dv.is_bot = false
                and ((pr.phone_number is not null
                      and dv.voter_phone = pr.phone_number)
                  or (pr.email is not null
                      and lower(dv.voter_email) = lower(pr.email)))
            ))::int                                                  as accounts_voted,
        (select count(*) from profiles pr
          where pr.role = 'voter' and pr.onboarded = true
            and not exists (
              select 1 from participants p
              where p.profile_id = pr.id
                 or (pr.email is not null
                     and lower(p.email) = lower(pr.email))
            )
            and not exists (
              select 1 from daily_votes dv2
              where dv2.is_bot = false
                and ((pr.phone_number is not null
                      and dv2.voter_phone = pr.phone_number)
                  or (pr.email is not null
                      and lower(dv2.voter_email) = lower(pr.email)))
            ))::int                                                  as accounts_onboarded_no_vote,

        -- AKUN PESERTA, dihitung terpisah dari corong. Peserta boleh vote
        -- ke peserta lain, jadi kontribusinya perlu terlihat tapi tidak
        -- boleh mencampuri gambaran pendukung dari luar.
        (select count(*) from profiles where role = 'participant')::int
                                                                     as participant_accounts,
        (select count(*) from profiles pr
          where pr.role = 'participant'
            and exists (
              select 1 from daily_votes dv3
              where dv3.is_bot = false
                and ((pr.phone_number is not null
                      and dv3.voter_phone = pr.phone_number)
                  or (pr.email is not null
                      and lower(dv3.voter_email) = lower(pr.email)))
            ))::int                                                  as participant_accounts_voted,

        -- Voter yang vote tanpa akun terdaftar (mis. data lama), supaya
        -- selisih antara total_voters dan corong akun bisa dijelaskan.
        (select count(distinct dv.voter_phone) from daily_votes dv
          where dv.is_bot = false and dv.voter_phone is not null
            and not exists (
              select 1 from profiles pr
              where pr.role <> 'admin'
                and (pr.phone_number = dv.voter_phone
                  or (pr.email is not null
                      and lower(pr.email) = lower(dv.voter_email)))
            ))::int                                                  as voters_without_account,

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
                        where dv.vote_date = d::date
                          -- Boost admin bukan vote asli: kalau ikut, grafik
                          -- melonjak palsu di hari boost dilakukan.
                          and dv.is_bot = false), 0)::int as votes
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
              -- Akun voter yang DIBUAT hari itu. Peserta hasil sync punya
              -- role 'participant', jadi dikecualikan supaya angkanya benar
              -- menggambarkan pertumbuhan voter.
              (select count(*) from profiles pr
                where pr.role = 'voter'
                  and pr.created_at::date = d::date)::int as accounts,
              -- Orang yang benar-benar vote hari itu, dihitung per nomor WA
              -- unik. Bot bukan orang, jadi tak ikut dihitung.
              (select count(distinct voter_phone) from daily_votes
                where voter_phone is not null
                  and is_bot = false
                  and created_at::date = d::date)::int as voters,
              -- Akumulasi voter unik, dipertahankan untuk pembanding tren.
              (select count(distinct voter_phone) from daily_votes
                where voter_phone is not null
                  and is_bot = false
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
        -- Vote bot (boost admin) bukan orang, jadi tak boleh muncul sebagai
        -- voter. Dashboard memakai definisi yang sama supaya angkanya cocok.
        and is_bot = false
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
    -- Voter yang sudah daftar (onboarded), ikut walau belum vote/quest.
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
              'Vote (+' || dv.points || ')' as source,
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

  /**
   * Histori vote mentah: SATU BARIS PER VOTE (bukan agregasi per nomor HP
   * seperti `voters`, dan tanpa campuran quest/undian seperti `activityLog`).
   * Dipakai halaman detail peserta untuk melihat siapa saja yang vote, jam
   * berapa, dari sekolah mana.
   *
   * Beda dengan `AdminVotesController.list`: di sini vote TANPA follow_proofs
   * juga ikut, karena tujuannya histori lengkap, bukan antrean review.
   */
  private voteHistoryCte = `
    with rows_all as (
      select dv.id, dv.created_at, dv.vote_date, dv.vote_kind, dv.points,
             dv.status, dv.is_bot,
             dv.follow_proofs is not null as has_proofs,
             coalesce(dv.voter_name, dv.voter_phone, 'Voter tanpa nama')
               as voter_name,
             dv.voter_phone, dv.voter_email, dv.voter_status,
             -- Sekolah voter: pakai teks yang tersimpan saat vote, kalau
             -- kosong ambil dari master sekolah lewat profil voter.
             coalesce(nullif(dv.voter_school, ''), vsch.name) as voter_school,
             dv.voter_class,
             dv.participant_id, p.name as participant_name,
             psch.name as participant_school, reg.name as voter_region
      from daily_votes dv
      join participants p on p.id = dv.participant_id
      left join schools psch on psch.id = p.school_id
      -- lateral + limit 1: cocokkan profil voter lewat email DULU (identitas
      -- SSO, paling tepat), baru nomor WA. Tanpa limit 1, satu vote yang
      -- email & nomornya milik dua profil berbeda akan tampil dobel dan
      -- menggelembungkan hitungan total.
      left join lateral (
        select pr.school_id, pr.region_id
        from profiles pr
        where (dv.voter_email is not null
               and lower(pr.email) = lower(dv.voter_email))
           or (dv.voter_phone is not null
               and pr.phone_number = dv.voter_phone)
        order by (lower(pr.email) = lower(dv.voter_email)) desc nulls last
        limit 1
      ) pr on true
      left join schools vsch on vsch.id = pr.school_id
      left join regions reg on reg.id = pr.region_id
    ),
    filtered as (
      select * from rows_all
      where ($1::uuid is null or participant_id = $1)
        and ($2::date is null or created_at::date >= $2)
        and ($3::date is null or created_at::date <= $3)
        -- $9 = 'public': pencarian TIDAK menyentuh kontak voter. Tanpa ini,
        -- pemanggil bisa menebak nomor WA lewat search lalu membaca total
        -- untuk memastikan nomor itu vote, walau responnya sudah disamarkan.
        and ($4::text is null
              or voter_name ilike '%' || $4 || '%'
              or voter_school ilike '%' || $4 || '%'
              or participant_name ilike '%' || $4 || '%'
              or ($9::text = 'full' and (
                   voter_phone ilike '%' || $4 || '%'
                or voter_email ilike '%' || $4 || '%')))
        and ($5::text is null or status = $5)
        and ($6::text is null or voter_status = $6)
        and ($7::text is null or voter_school ilike '%' || $7 || '%')
        -- Vote boost buatan admin disembunyikan kecuali diminta eksplisit.
        and ($8::boolean or is_bot = false)
    )`;

  private voteHistoryArgs(f: VoteHistoryFilters) {
    return [
      f.participantId || null,
      f.from || null,
      f.to || null,
      f.search || null,
      f.status || null,
      f.voterStatus || null,
      f.school || null,
      f.includeBot === true,
      f.searchScope === "public" ? "public" : "full",
    ];
  }

  voteHistory(f: VoteHistoryFilters) {
    const order = f.sort === "oldest" ? "created_at asc" : "created_at desc";
    return this.db.query(
      `${this.voteHistoryCte}
       select id, created_at, vote_date, vote_kind, points, status, is_bot,
              has_proofs, voter_name, voter_phone, voter_email, voter_status,
              voter_school, voter_class, voter_region,
              participant_id, participant_name, participant_school
       from filtered order by ${order}
       limit $10 offset $11`,
      [
        ...this.voteHistoryArgs(f),
        Math.min(f.limit ?? 50, 1000),
        f.offset ?? 0,
      ],
    );
  }

  async voteHistoryCount(f: VoteHistoryFilters) {
    const rows = await this.db.query(
      `${this.voteHistoryCte} select count(*)::int as c from filtered`,
      this.voteHistoryArgs(f),
    );
    return Number(rows[0]?.c ?? 0);
  }

  /** Unified activity feed: votes + quest submissions. */
  private activityCte = `
    with acts as (
      select dv.vote_kind as kind,
             'Vote (+' || dv.points || ')' as source,
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
      union all
      -- Undian: pemilik kupon jadi "voter", kode kupon + hadiah mengisi
      -- kolom peserta. Poin tak berlaku, jadi 0.
      --
      -- Untuk baris 'won' hadiah dibaca dari coupons, BUKAN dari raffle_events.
      -- Mode roda mencatat log sebelum roda berhenti, jadi prize di log bisa
      -- berupa tebakan awal dari kolom admin. coupons adalah sumber kebenaran
      -- hadiah, dan itu yang dilihat voter di Kupon Saya.
      select 'raffle'::text,
             re.coupon_code ||
               coalesce(
                 ' - ' || case
                   when re.event_type = 'won' and c.won_at is not null
                     then coalesce(c.prize, re.prize)
                   else re.prize
                 end, '') as source,
             coalesce(pr.name, 'Voter terhapus'), pr.phone_number,
             re.coupon_code, null::uuid, 0, re.event_type, re.created_at
      from raffle_events re
      left join profiles pr on pr.id = re.profile_id
      left join coupons c on c.code = re.coupon_code
    ),
    filtered as (
      select * from acts
      where ($1::text = 'all' or kind = $1)
        -- Undian tak terikat peserta, jadi ikut tersaring keluar saat admin
        -- memfilter satu peserta tertentu.
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
