// RESET semua aktivitas voting → seperti akun baru semua.
// Hapus: daily_votes, submissions (+proofs), coupons.
// Reset: participants.total_points = 0, profiles.followed_at/proof = null.
// TIDAK menghapus akun, peserta, sekolah, wilayah, gelombang.
//   node scripts/reset-votes.mjs
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

await client.query("begin");
try {
  await client.query("delete from submission_proofs");
  await client.query("delete from submissions");
  await client.query("delete from coupons");
  await client.query("delete from daily_votes");
  await client.query("update participants set total_points = 0");
  await client.query(
    "update profiles set followed_at = null, follow_proof_url = null",
  );
  await client.query("commit");
} catch (e) {
  await client.query("rollback");
  throw e;
}

console.log(
  "RESET OK: vote, submission, kupon, poin, & status follow dibersihkan. Semua akun seperti baru.",
);
await client.end();
