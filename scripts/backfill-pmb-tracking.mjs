// Backfill tracking pendaftaran voter ke web PMB untuk voter yang SUDAH
// selesai onboarding SEBELUM integrasi tracking dipasang.
//
// Kirim POST ke pmb.stekom.ac.id/api/tracking/submit-direct per voter,
// dibatch + delay antar batch supaya tidak membanjiri API tujuan.
//
//   node scripts/backfill-pmb-tracking.mjs
//
// Aman dijalankan berulang (tracking itu sendiri tak divalidasi idempoten
// di sisi PMB, jadi jangan dijalankan berkali-kali tanpa perlu).
import "dotenv/config";
import pg from "pg";

const BATCH_SIZE = 20;
const DELAY_MS = 2000;
const TRACKING_URL = "https://pmb.stekom.ac.id/api/tracking/submit-direct";

const client = new pg.Client({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USER ?? "postgres",
  password: process.env.DB_PASSWORD ?? "postgres",
  database: process.env.DB_NAME ?? "idola_stekom",
});
await client.connect();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sendTracking(row) {
  const res = await fetch(TRACKING_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source_page: "Idola Lainnya",
      nama: row.name ?? "",
      email: row.email ?? "",
      phone: row.phone_number ?? "",
      data: "onboarding_voter_backfill",
    }),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  }
}

try {
  const { rows } = await client.query(`
    select id, name, email, phone_number
    from profiles
    where onboarded = true
      and role in ('voter', 'participant')
    order by created_at asc
  `);
  console.log(`Kandidat backfill: ${rows.length} voter sudah onboarding`);

  let ok = 0;
  let fail = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(sendTracking));
    for (const r of results) {
      if (r.status === "fulfilled") ok++;
      else fail++;
    }
    console.log(
      `Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(rows.length / BATCH_SIZE)}: ` +
        `${ok} sukses, ${fail} gagal (sejauh ini)`,
    );
    if (i + BATCH_SIZE < rows.length) await sleep(DELAY_MS);
  }

  console.log(`Selesai: ${ok} terkirim, ${fail} gagal dari ${rows.length} total.`);
} catch (e) {
  console.error("GAGAL:", e);
  process.exitCode = 1;
} finally {
  await client.end();
}
