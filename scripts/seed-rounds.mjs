// Seed gelombang: Grup A/B/C (global top-200, auto-close terjadwal).
// RESET: hapus semua rounds + round_schools lama dulu, lalu buat fresh.
//   node scripts/seed-rounds.mjs
//
// - Grup A: active,  sequence 1, auto-tutup 31 Agu 2026 23:59 WIB
// - Grup B: draft,   sequence 2, auto-tutup 30 Sep 2026 23:59 WIB
// - Grup C: draft,   sequence 3, auto-tutup 31 Okt 2026 23:59 WIB
// Semua: select_mode 'global', top_n 200.
import "dotenv/config";
import pg from "pg";

const client = new pg.Client({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USER ?? "postgres",
  password: process.env.DB_PASSWORD ?? "postgres",
  database: process.env.DB_NAME ?? "idola_stekom",
});
await client.connect();

// 23:59 WIB (UTC+7) = 16:59 UTC.
const rounds = [
  { name: "Grup A", seq: 1, status: "active", close: "2026-08-31T16:59:59Z" },
  { name: "Grup B", seq: 2, status: "draft", close: "2026-09-30T16:59:59Z" },
  { name: "Grup C", seq: 3, status: "draft", close: "2026-10-31T16:59:59Z" },
];

await client.query("begin");
try {
  // RESET — hapus keanggotaan sekolah lalu gelombang.
  await client.query("delete from round_schools");
  await client.query("delete from rounds");

  for (const r of rounds) {
    await client.query(
      `insert into rounds
         (name, status, top_n, select_mode, sequence, starts_at, scheduled_close_at)
       values ($1, $2, 200, 'global', $3, $4, $5)`,
      [
        r.name,
        r.status,
        r.seq,
        r.status === "active" ? new Date().toISOString() : null,
        r.close,
      ],
    );
  }
  await client.query("commit");
} catch (e) {
  await client.query("rollback");
  throw e;
}

console.log("Seeded 3 gelombang: Grup A (active), Grup B, Grup C (draft).");
console.log("Global top-200, auto-tutup 31 Agu / 30 Sep / 31 Okt 2026 (23:59 WIB).");
await client.end();
