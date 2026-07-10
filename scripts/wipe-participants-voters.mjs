// HAPUS TOTAL data peserta & voter — untuk mengosongkan database production.
//
// Dihapus:
//   - daily_votes, submissions (+ proofs), coupons  (aktivitas voting)
//   - participant_contents, participants            (semua peserta)
//   - round_schools                                 (keanggotaan gelombang — turunan peserta)
//   - profiles dengan role 'voter' / 'participant'  (semua akun voter & akun peserta,
//     termasuk data leads PMB yang menempel di profil voter!)
//
// TIDAK dihapus: akun admin, sekolah master, wilayah, quest, rounds, settings.
//
// Jalankan dengan env DB production (atau .env production di server):
//   node scripts/wipe-participants-voters.mjs --yes
// Tanpa --yes script hanya menampilkan jumlah baris yang AKAN terhapus (dry-run).
import "dotenv/config";
import pg from "pg";

const confirmed = process.argv.includes("--yes");

const client = new pg.Client({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USER ?? "postgres",
  password: process.env.DB_PASSWORD ?? "postgres",
  database: process.env.DB_NAME ?? "idola_stekom",
});
await client.connect();

const counts = {};
for (const [label, sql] of [
  ["daily_votes", "select count(*)::int c from daily_votes"],
  ["submissions", "select count(*)::int c from submissions"],
  ["coupons", "select count(*)::int c from coupons"],
  ["participant_contents", "select count(*)::int c from participant_contents"],
  ["participants", "select count(*)::int c from participants"],
  ["round_schools", "select count(*)::int c from round_schools"],
  [
    "profiles voter/peserta",
    "select count(*)::int c from profiles where role in ('voter','participant')",
  ],
]) {
  counts[label] = (await client.query(sql)).rows[0].c;
}

console.log(`Target: ${client.host}:${client.port}/${client.database}`);
console.table(counts);

if (!confirmed) {
  console.log(
    "DRY-RUN — tidak ada yang dihapus. Jalankan ulang dengan --yes untuk eksekusi.",
  );
  await client.end();
  process.exit(0);
}

await client.query("begin");
try {
  await client.query("delete from submission_proofs");
  await client.query("delete from submissions");
  await client.query("delete from coupons");
  await client.query("delete from daily_votes");
  await client.query("delete from participant_contents");
  await client.query("delete from round_schools");
  await client.query("delete from participants");
  await client.query(
    "delete from profiles where role in ('voter','participant')",
  );
  await client.query("commit");
} catch (e) {
  await client.query("rollback");
  throw e;
}

console.log(
  "WIPE OK: semua peserta, voter, vote, submission, kupon, & keanggotaan gelombang terhapus. Admin, sekolah, wilayah, quest, dan rounds tetap ada.",
);
await client.end();
