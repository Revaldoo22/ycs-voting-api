// Bersihkan keanggotaan gelombang milik peserta Golden Buzzer.
//
//   node scripts/fix-golden-buzzer-rounds.mjs --dry   (lihat dulu)
//   node scripts/fix-golden-buzzer-rounds.mjs         (jalankan)
//
// Latar: Golden Buzzer adalah jalur lolos tersendiri, jadi peserta yang
// ditandai harus keluar dari gelombang mana pun. Penandaan lewat admin kini
// sudah otomatis melakukannya, tapi peserta yang ditandai SEBELUM perbaikan
// itu masih menyimpan baris di round_participants, sehingga namanya muncul
// dobel di halaman Peserta Lolos.
//
// Aman diulang: kalau tak ada sisa data, script berhenti tanpa mengubah apa pun.
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

const { rows: affected } = await client.query(
  `select p.id, p.name, r.name as round_name, rp.status
     from round_participants rp
     join participants p on p.id = rp.participant_id
     join rounds r on r.id = rp.round_id
    where p.golden_buzzer = true
    order by p.name, r.sequence`,
);

if (affected.length === 0) {
  console.log("Bersih: tak ada Golden Buzzer yang masih terdaftar di gelombang.");
  await client.end();
  process.exit(0);
}

console.log(`Ditemukan ${affected.length} baris yang perlu dihapus:`);
console.table(
  affected.map((r) => ({
    peserta: r.name,
    gelombang: r.round_name,
    status: r.status,
  })),
);

if (DRY) {
  console.log("\n--dry: tidak ada yang diubah. Jalankan tanpa --dry untuk membersihkan.");
  await client.end();
  process.exit(0);
}

const { rowCount } = await client.query(
  `delete from round_participants rp
    using participants p
    where p.id = rp.participant_id and p.golden_buzzer = true`,
);
console.log(`\n${rowCount} baris dihapus.`);

const { rows: check } = await client.query(
  `select count(*)::int as sisa
     from round_participants rp
     join participants p on p.id = rp.participant_id
    where p.golden_buzzer = true`,
);
console.log(`Sisa: ${check[0].sisa} (harus 0).`);
console.log(
  "Catatan: peserta ini tidak lagi punya status lolos gelombang. Kalau",
);
console.log(
  "tandanya dilepas, kembalikan lewat panel Atur Peserta Lolos di admin.",
);
await client.end();
