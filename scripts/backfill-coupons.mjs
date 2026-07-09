// Backfill kupon undian: terbitkan 1 kupon untuk SETIAP profil yang sudah
// pernah vote (voter_email cocok email profil) tapi belum punya kupon.
//
// Latar: sebelum peserta boleh vote peserta lain (& skip follow-gate), sebagian
// yang sudah vote tak sempat dapat kupon. Script ini menutup celah itu untuk
// voter maupun peserta — idempoten via unique (profile_id, source).
//
//   node scripts/backfill-coupons.mjs
//
// Aman dijalankan berulang.
import "dotenv/config";
import pg from "pg";
import { randomBytes } from "crypto";

const code = () =>
  "YCS-" +
  Array.from({ length: 2 }, () =>
    randomBytes(3).toString("hex").slice(0, 4).toUpperCase(),
  ).join("-");

const client = new pg.Client({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USER ?? "postgres",
  password: process.env.DB_PASSWORD ?? "postgres",
  database: process.env.DB_NAME ?? "idola_stekom",
});
await client.connect();

try {
  // Profil yang PUNYA vote (match by email) tapi BELUM punya kupon apa pun.
  const targets = await client.query(`
    select distinct pr.id, pr.role
    from profiles pr
    join daily_votes dv on lower(dv.voter_email) = lower(pr.email)
    where not exists (select 1 from coupons c where c.profile_id = pr.id)
  `);
  console.log(`Kandidat backfill: ${targets.rows.length} profil (voter+peserta) yang sudah vote tanpa kupon`);

  let made = 0;
  for (const t of targets.rows) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await client.query(
          `insert into coupons (profile_id, code, source) values ($1, $2, 'follow')
           on conflict (profile_id, source) do nothing`,
          [t.id, code()],
        );
        if (r.rowCount > 0) made++;
        break;
      } catch (e) {
        if (!String(e).includes("duplicate")) throw e; // tabrakan kode → ulang
      }
    }
  }

  const stats = await client.query(`
    select (select count(*) from coupons)::int as total_kupon,
           (select count(distinct profile_id) from coupons)::int as pemilik_kupon`);
  console.log(`Selesai: +${made} kupon baru diterbitkan.`, stats.rows[0]);
} catch (e) {
  console.error("GAGAL:", e);
  process.exitCode = 1;
} finally {
  await client.end();
}
