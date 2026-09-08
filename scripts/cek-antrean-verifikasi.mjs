// Periksa antrean verifikasi vote di gelombang aktif.
//
//   node scripts/cek-antrean-verifikasi.mjs            (gelombang aktif)
//   node scripts/cek-antrean-verifikasi.mjs "Grup B"   (gelombang tertentu)
//
// Latar: vote yang perlu bukti follow masuk sebagai pending dan poinnya
// ditahan sampai disetujui. Kalau antreannya menumpuk saat gelombang
// ditutup, keputusan lolos didasarkan pada vote yang belum diperiksa, bukan
// pada dukungan yang sebenarnya.
//
// Script ini HANYA MEMBACA. Tidak ada yang diubah.
import "dotenv/config";
import pg from "pg";

const namaRound = (process.argv[2] ?? "").trim();

const c = new pg.Client({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USER ?? "postgres",
  password: process.env.DB_PASSWORD ?? "postgres",
  database: process.env.DB_NAME ?? "idola_stekom",
});
await c.connect();

const { rows: rr } = await c.query(
  namaRound
    ? `select id, name, status, top_n from rounds where lower(name) = lower($1)`
    : `select id, name, status, top_n from rounds where status = 'active' order by sequence limit 1`,
  namaRound ? [namaRound] : [],
);
if (rr.length === 0) {
  console.error(
    namaRound ? `Gelombang "${namaRound}" tidak ada.` : "Tidak ada gelombang aktif.",
  );
  await c.end();
  process.exit(1);
}
const r = rr[0];
const judul = (t) => console.log("\n" + t + "\n" + "-".repeat(t.length));

console.log(`Gelombang: ${r.name} (status ${r.status}, kuota dasar ${r.top_n})`);

// ---------- 1. Ringkasan antrean ----------
judul("RINGKASAN ANTREAN");
const [ring] = (
  await c.query(
    `select
       count(*) filter (where status = 'pending' and is_bot = false)::int as pending,
       count(*) filter (where status = 'approved' and is_bot = false)::int as approved,
       count(*) filter (where is_bot)::int as boost_admin,
       count(distinct participant_id) filter (
         where status = 'pending' and is_bot = false)::int as peserta_terdampak,
       min(created_at) filter (where status = 'pending' and is_bot = false) as pending_tertua
     from daily_votes where round_id = $1`,
    [r.id],
  )
).rows;

const umurJam = ring.pending_tertua
  ? Math.round((Date.now() - new Date(ring.pending_tertua).getTime()) / 36e5)
  : 0;

console.table([
  {
    pending: ring.pending,
    approved: ring.approved,
    boost_admin: ring.boost_admin,
    peserta_terdampak: ring.peserta_terdampak,
    pending_tertua: ring.pending_tertua
      ? `${umurJam} jam lalu`
      : "tidak ada",
  },
]);

if (ring.pending === 0) {
  console.log("\nAntrean bersih. Gelombang aman ditutup dari sisi verifikasi.");
  await c.end();
  process.exit(0);
}

// ---------- 2. Sebaran umur antrean ----------
judul("UMUR ANTREAN PENDING");
console.table(
  (
    await c.query(
      `select
         case
           when created_at > now() - interval '6 hours'  then '1. di bawah 6 jam'
           when created_at > now() - interval '24 hours' then '2. 6 sampai 24 jam'
           when created_at > now() - interval '3 days'   then '3. 1 sampai 3 hari'
           else '4. lebih dari 3 hari'
         end as umur,
         count(*)::int as jumlah
       from daily_votes
      where round_id = $1 and status = 'pending' and is_bot = false
      group by 1 order by 1`,
      [r.id],
    )
  ).rows,
);

// ---------- 3. Peserta yang paling terpengaruh ----------
judul("PESERTA DENGAN PENDING TERBANYAK");
console.table(
  (
    await c.query(
      `select p.name,
              count(*)::int as pending,
              (select count(*)::int from daily_votes d2
                where d2.participant_id = p.id and d2.round_id = $1
                  and d2.status = 'approved' and d2.is_bot = false) as sudah_sah,
              rp.status as status_peserta
         from daily_votes dv
         join participants p on p.id = dv.participant_id
         join round_participants rp
           on rp.participant_id = p.id and rp.round_id = $1
        where dv.round_id = $1 and dv.status = 'pending' and dv.is_bot = false
        group by p.id, p.name, rp.status
        order by 2 desc limit 15`,
      [r.id],
    )
  ).rows.map((x) => ({
    nama: x.name.slice(0, 28),
    pending: x.pending,
    sudah_sah: x.sudah_sah,
    // Angka inilah yang dipakai peringkat kalau semua pending disetujui.
    kalau_disetujui: x.pending + x.sudah_sah,
    status: x.status_peserta,
  })),
);

// ---------- 4. Pengaruh ke ambang lolos ----------
judul("PENGARUH KE DAFTAR LOLOS");
const { rows: kuotaRow } = await c.query(
  `with leftovers as (
     select greatest(rr.top_n - (
       select count(*) from round_participants rp
         join participants p on p.id = rp.participant_id
        where rp.round_id = rr.id and rp.status = 'lolos'
          and p.golden_buzzer = false), 0)::int as sisa
     from rounds rr, rounds t
    where t.id = $1 and rr.sequence < t.sequence and rr.status = 'closed'
   )
   select (t.top_n + coalesce((select sum(sisa) from leftovers), 0))::int as kuota
     from rounds t where t.id = $1`,
  [r.id],
);
const kuota = kuotaRow[0].kuota;

const { rows: peserta } = await c.query(
  `select p.id, p.name,
          (rp.carry_points + coalesce((
             select sum(dv.points) from daily_votes dv
              where dv.participant_id = rp.participant_id and dv.round_id = rp.round_id
                and dv.status = 'approved' and dv.is_bot = false), 0))::int as poin_sekarang,
          (rp.carry_points + coalesce((
             select sum(dv.points) from daily_votes dv
              where dv.participant_id = rp.participant_id and dv.round_id = rp.round_id
                and dv.status in ('approved','pending') and dv.is_bot = false), 0))::int
            as poin_bila_disetujui
     from round_participants rp
     join participants p on p.id = rp.participant_id
    where rp.round_id = $1 and p.golden_buzzer = false`,
  [r.id],
);

const urut = (k) =>
  [...peserta].sort((a, b) => b[k] - a[k] || a.name.localeCompare(b.name));
const setSekarang = new Set(urut("poin_sekarang").slice(0, kuota).map((x) => x.id));
const setSesudah = new Set(urut("poin_bila_disetujui").slice(0, kuota).map((x) => x.id));
const nama = new Map(peserta.map((x) => [x.id, x.name]));

const keluar = [...setSekarang].filter((id) => !setSesudah.has(id));
const masuk = [...setSesudah].filter((id) => !setSekarang.has(id));

console.log(`Kuota efektif: ${kuota}`);
console.log(
  `Kalau seluruh ${ring.pending} pending disetujui: ${keluar.length} keluar, ${masuk.length} masuk`,
);
if (masuk.length) {
  console.log("\nYang baru masuk kalau antrean dibereskan (maks 20):");
  masuk.slice(0, 20).forEach((id) => {
    const x = peserta.find((y) => y.id === id);
    console.log(
      `  ${nama.get(id)}  (sekarang ${x.poin_sekarang}, bila disetujui ${x.poin_bila_disetujui})`,
    );
  });
}

console.log("");
console.log(
  keluar.length || masuk.length
    ? "Antrean ini MENGUBAH siapa yang lolos. Bereskan verifikasi sebelum menutup gelombang."
    : "Antrean tidak mengubah daftar lolos, tapi tetap perlu dibereskan supaya poin peserta benar.",
);
console.log("Script ini hanya membaca. Tidak ada data yang diubah.");
await c.end();
