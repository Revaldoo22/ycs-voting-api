// Periksa seluruh jejak satu email: sebagai peserta maupun sebagai voter.
//
//   node scripts/cek-email.mjs aikojacindaf@gmail.com
//
// Menjawab empat hal:
//   1. Berapa vote yang masuk, dipisah per status dan per gelombang
//   2. Poin yang dipakai peringkat tiap gelombang (carry + vote gelombang itu)
//   3. Apakah ada yang berkurang: vote ditolak, penyesuaian poin negatif,
//      atau selisih antara total_points tersimpan dan hasil hitung ulang
//   4. Kapan terakhir divote dan terakhir memberi vote
import "dotenv/config";
import pg from "pg";

const email = (process.argv[2] ?? "").trim().toLowerCase();
if (!email) {
  console.error("Pakai: node scripts/cek-email.mjs <email>");
  process.exit(1);
}

const c = new pg.Client({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USER ?? "postgres",
  password: process.env.DB_PASSWORD ?? "postgres",
  database: process.env.DB_NAME ?? "idola_stekom",
});
await c.connect();

const judul = (t) => console.log("\n" + t + "\n" + "-".repeat(t.length));

// ---------- 1. Identitas ----------
judul("IDENTITAS");
const { rows: pes } = await c.query(
  // Nomor WA ada di tabel profil, bukan di peserta.
  `select p.id, p.name, p.email, p.status,
          p.total_points, p.golden_buzzer, s.name as sekolah
     from participants p
     left join schools s on s.id = p.school_id
    where lower(p.email) = $1`,
  [email],
);
if (pes.length === 0) {
  console.log("Bukan peserta.");
} else {
  console.table(
    pes.map((r) => ({
      nama: r.name,
      sekolah: (r.sekolah ?? "-").slice(0, 28),
      status: r.status,
      golden_buzzer: r.golden_buzzer,
      total_points: r.total_points,
    })),
  );
}

const { rows: prof } = await c.query(
  `select id, name, email, phone_number, role, onboarded
     from profiles where lower(email) = $1`,
  [email],
);
console.log("Akun login:");
console.table(
  prof.map((r) => ({
    nama: r.name,
    peran: r.role,
    onboarding: r.onboarded,
    wa: r.phone_number ?? "-",
  })),
);

const pid = pes[0]?.id ?? null;

// ---------- 2. Vote yang MASUK (sebagai peserta) ----------
if (pid) {
  judul("VOTE MASUK KE PESERTA INI, per status");
  const { rows } = await c.query(
    `select status, is_bot,
            count(*)::int as jumlah,
            coalesce(sum(points), 0)::int as poin
       from daily_votes
      where participant_id = $1
      group by status, is_bot
      order by status, is_bot`,
    [pid],
  );
  console.table(rows);

  judul("VOTE MASUK, per gelombang");
  const { rows: perRound } = await c.query(
    `select coalesce(r.name, '(tanpa gelombang)') as gelombang,
            r.sequence, r.status as status_gelombang,
            count(*) filter (where dv.status = 'approved' and dv.is_bot = false)::int as approved,
            count(*) filter (where dv.status = 'pending' and dv.is_bot = false)::int as pending,
            count(*) filter (where dv.is_bot)::int as boost_admin,
            coalesce(sum(dv.points) filter (
              where dv.status = 'approved' and dv.is_bot = false), 0)::int as poin_approved
       from daily_votes dv
       left join rounds r on r.id = dv.round_id
      where dv.participant_id = $1
      group by r.name, r.sequence, r.status
      order by r.sequence nulls first`,
    [pid],
  );
  console.table(perRound);

  // ---------- 3. Poin per gelombang: dasar peringkat ----------
  judul("POIN PERINGKAT TIAP GELOMBANG (carry + vote gelombang itu)");
  const { rows: rp } = await c.query(
    `select r.name as gelombang, r.sequence, r.status as status_gelombang,
            r.top_n as kuota_dasar,
            rp.status as status_peserta,
            rp.carry_points::int as poin_bawaan,
            coalesce(pt.poin, 0)::int as poin_vote_gelombang,
            (rp.carry_points + coalesce(pt.poin, 0))::int as poin_peringkat
       from round_participants rp
       join rounds r on r.id = rp.round_id
       left join lateral (
         select coalesce(sum(dv.points), 0) as poin
           from daily_votes dv
          where dv.participant_id = rp.participant_id
            and dv.round_id = rp.round_id
            and dv.status = 'approved' and dv.is_bot = false
       ) pt on true
      where rp.participant_id = $1
      order by r.sequence`,
    [pid],
  );
  if (rp.length === 0) console.log("Belum terdaftar di gelombang mana pun.");
  else console.table(rp);

  // ---------- 4. Crosscheck: apakah ada yang berkurang ----------
  judul("CROSSCHECK, apakah ada yang berkurang");

  const { rows: hitung } = await c.query(
    `select p.total_points::int as tersimpan,
            (select count(*)::int from daily_votes dv
              where dv.participant_id = p.id
                and dv.status = 'approved' and dv.is_bot = false) as vote_approved,
            (select coalesce(sum(dv.points), 0)::int from daily_votes dv
              where dv.participant_id = p.id
                and dv.status = 'approved' and dv.is_bot = false) as jumlah_poin_vote
       from participants p where p.id = $1`,
    [pid],
  );
  const h = hitung[0];
  console.log(
    `total_points tersimpan : ${h.tersimpan}\n` +
      `vote approved (baris)  : ${h.vote_approved}\n` +
      `jumlah poin vote       : ${h.jumlah_poin_vote}\n` +
      `selisih tersimpan vs hitung ulang: ${h.tersimpan - h.jumlah_poin_vote}` +
      (h.tersimpan === h.jumlah_poin_vote
        ? "  (cocok)"
        : "  <-- TIDAK COCOK, perlu diperiksa"),
  );

  const { rows: tolak } = await c.query(
    `select count(*)::int as jumlah, min(created_at) as pertama,
            max(created_at) as terakhir
       from rejections
      where kind = 'vote' and participant_id = $1`,
    [pid],
  );
  console.log(`\nVote ditolak untuk peserta ini: ${tolak[0].jumlah}`);
  if (tolak[0].jumlah > 0) {
    const { rows: dTolak } = await c.query(
      `select voter_name, voter_phone, reason, created_at
         from rejections
        where kind = 'vote' and participant_id = $1
        order by created_at desc limit 20`,
      [pid],
    );
    console.table(
      dTolak.map((r) => ({
        waktu: new Date(r.created_at).toISOString().slice(0, 16).replace("T", " "),
        voter: r.voter_name ?? "-",
        wa: r.voter_phone ?? "-",
        alasan: (r.reason ?? "-").slice(0, 40),
      })),
    );
  }
}

// ---------- 5. Penyesuaian poin manual ----------
judul("PENYESUAIAN POIN MANUAL (saldo spin, bukan poin lomba)");
const { rows: adj } = await c.query(
  `select points, reason, created_by, created_at
     from point_adjustments where lower(email) = $1
    order by created_at desc`,
  [email],
);
if (adj.length === 0) console.log("Tidak ada.");
else {
  console.table(
    adj.map((r) => ({
      waktu: new Date(r.created_at).toISOString().slice(0, 16).replace("T", " "),
      poin: r.points,
      alasan: (r.reason ?? "").slice(0, 34),
      oleh: r.created_by ?? "-",
    })),
  );
  const total = adj.reduce((s, r) => s + r.points, 0);
  console.log(`Jumlah penyesuaian: ${total > 0 ? "+" : ""}${total}`);
}

// ---------- 6. Kapan terakhir divote ----------
if (pid) {
  judul("20 VOTE TERAKHIR YANG MASUK");
  const { rows: akhir } = await c.query(
    `select dv.created_at, dv.status, dv.is_bot, dv.points,
            dv.voter_name, dv.voter_phone,
            coalesce(r.name, '-') as gelombang
       from daily_votes dv
       left join rounds r on r.id = dv.round_id
      where dv.participant_id = $1
      order by dv.created_at desc limit 20`,
    [pid],
  );
  console.table(
    akhir.map((r) => ({
      waktu: new Date(r.created_at).toISOString().slice(0, 16).replace("T", " "),
      gelombang: r.gelombang,
      status: r.is_bot ? "boost" : r.status,
      poin: r.points,
      voter: (r.voter_name ?? "-").slice(0, 20),
    })),
  );
}

// ---------- 7. Sebagai VOTER: vote yang dia berikan ----------
judul("SEBAGAI VOTER, vote yang dia BERIKAN");
const { rows: beri } = await c.query(
  `select dv.created_at, dv.status, dv.points,
          p.name as ke_peserta, coalesce(r.name, '-') as gelombang
     from daily_votes dv
     left join participants p on p.id = dv.participant_id
     left join rounds r on r.id = dv.round_id
    where lower(dv.voter_email) = $1
    order by dv.created_at desc limit 20`,
  [email],
);
if (beri.length === 0) console.log("Belum pernah memberi vote dengan email ini.");
else
  console.table(
    beri.map((r) => ({
      waktu: new Date(r.created_at).toISOString().slice(0, 16).replace("T", " "),
      ke: (r.ke_peserta ?? "-").slice(0, 24),
      gelombang: r.gelombang,
      status: r.status,
      poin: r.points,
    })),
  );

await c.end();
