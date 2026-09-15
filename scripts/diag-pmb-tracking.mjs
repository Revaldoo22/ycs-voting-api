// Diagnostik: kirim beberapa sample ke tracking PMB dan cetak detail respons
// (status + body) supaya kita tahu KENAPA banyak gagal saat backfill.
//
//   node scripts/diag-pmb-tracking.mjs
import "dotenv/config";
import pg from "pg";

const TRACKING_URL = "https://pmb.stekom.ac.id/api/tracking/submit-direct";

const client = new pg.Client({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USER ?? "postgres",
  password: process.env.DB_PASSWORD ?? "postgres",
  database: process.env.DB_NAME ?? "idola_stekom",
});
await client.connect();

try {
  const { rows } = await client.query(`
    select id, name, email, phone_number
    from profiles
    where onboarded = true
      and role in ('voter', 'participant')
    order by created_at asc
    limit 5
  `);

  for (const row of rows) {
    const payload = {
      source_page: "Idola Voter",
      nama: row.name ?? "",
      email: row.email ?? "",
      phone: row.phone_number ?? "",
      data: "onboarding_voter_backfill",
    };
    console.log("\n=== Payload ===");
    console.log(JSON.stringify(payload));
    try {
      const res = await fetch(TRACKING_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const text = await res.text().catch(() => "");
      console.log(`Status: ${res.status}`);
      console.log(`Body: ${text.slice(0, 500)}`);
    } catch (e) {
      console.log(`Fetch error: ${e}`);
    }
  }
} catch (e) {
  console.error("GAGAL:", e);
  process.exitCode = 1;
} finally {
  await client.end();
}
