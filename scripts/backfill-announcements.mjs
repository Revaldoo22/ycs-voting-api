// Rekonstruksi riwayat pengiriman pengumuman yang terjadi SEBELUM tabel
// announcements ada.
//
//   node scripts/backfill-announcements.mjs --dry   (lihat dulu)
//   node scripts/backfill-announcements.mjs         (jalankan)
//
// Latar: pengumuman yang dikirim sebelum fitur riwayat aktif tetap masuk ke
// lonceng voter, tapi announcement_id-nya null sehingga tak muncul di daftar
// riwayat. Akibatnya pengiriman besar (mis. 14.678 akun) seolah hilang dan
// yang tampil hanya sisa-sisa kecilnya.
//
// Script ini mengelompokkan notifikasi tak tertaut berdasarkan judul, isi,
// dan MENIT pengirimannya, lalu membuat satu baris riwayat per kelompok dan
// menautkan notifikasinya. Pengelompokan per menit dipakai karena satu
// broadcast menulis semua barisnya dalam satu query, jadi waktunya berdekatan.
//
// Aman diulang: notifikasi yang sudah tertaut tidak disentuh.
import "dotenv/config";
import pg from "pg";

const DRY = process.argv.includes("--dry");

const client = new pg.Client({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USER ?? "postgres",
  password: process.env.DB_PASSWORD ?? "postgres",
  database: process.env.DB_NAME ?? "idola_stekom",
});
await client.connect();

const { rows: check } = await client.query(
  `select to_regclass('public.announcements') is not null as ok`,
);
if (!check[0].ok) {
  console.error("Tabel announcements belum ada. Deploy backend terbaru dulu.");
  await client.end();
  process.exit(1);
}

// Kelompok notifikasi pengumuman yang belum punya baris riwayat.
const { rows: groups } = await client.query(
  `select title, body,
          date_trunc('minute', created_at) as menit,
          count(*)::int as jumlah,
          count(*) filter (where read_at is not null)::int as dibuka,
          min(created_at) as waktu
     from notifications
    where type = 'announcement' and announcement_id is null
    group by title, body, date_trunc('minute', created_at)
    order by min(created_at)`,
);

if (groups.length === 0) {
  console.log("Bersih: semua notifikasi pengumuman sudah punya riwayat.");
  await client.end();
  process.exit(0);
}

console.log(`Ditemukan ${groups.length} pengiriman tanpa riwayat:`);
console.table(
  groups.map((g) => ({
    waktu: new Date(g.waktu).toISOString().slice(0, 16).replace("T", " "),
    judul: g.title.slice(0, 40),
    terkirim: g.jumlah,
    dibuka: g.dibuka,
  })),
);

if (DRY) {
  console.log("\n--dry: tidak ada yang ditulis. Jalankan tanpa --dry.");
  await client.end();
  process.exit(0);
}

let created = 0;
let linked = 0;
await client.query("begin");
try {
  for (const g of groups) {
    const { rows: ins } = await client.query(
      `insert into announcements
         (title, body, sent_count, only_non_participants, sent_by, created_at)
       values ($1, $2, $3, true, $4, $5)
       returning id`,
      [g.title, g.body, g.jumlah, "Admin (riwayat lama)", g.waktu],
    );
    const annId = ins[0].id;
    created++;

    const { rowCount } = await client.query(
      `update notifications
          set announcement_id = $1
        where type = 'announcement'
          and announcement_id is null
          and title = $2 and body = $3
          and date_trunc('minute', created_at) = $4`,
      [annId, g.title, g.body, g.menit],
    );
    linked += rowCount;
  }
  await client.query("commit");
} catch (e) {
  await client.query("rollback");
  throw e;
}

console.log(`\n${created} baris riwayat dibuat, ${linked} notifikasi ditautkan.`);

const { rows: summary } = await client.query(
  `select a.title, a.sent_count, a.created_at,
          (select count(*) from notifications n
            where n.announcement_id = a.id and n.read_at is not null)::int
            as dibuka
     from announcements a
    order by a.created_at desc
    limit 10`,
);
console.table(
  summary.map((r) => ({
    waktu: new Date(r.created_at).toISOString().slice(0, 16).replace("T", " "),
    judul: r.title.slice(0, 40),
    terkirim: r.sent_count,
    dibuka: r.dibuka,
  })),
);
console.log(
  "Catatan: klik tautan pengiriman lama tak bisa dipulihkan karena belum",
);
console.log("dicatat saat itu, jadi angkanya mulai dari 0.");
await client.end();
