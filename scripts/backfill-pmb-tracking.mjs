// Backfill tracking pendaftaran voter ke web PMB untuk voter yang SUDAH
// selesai onboarding SEBELUM integrasi tracking dipasang.
//
// Hanya voter yang di wizard onboarding menyatakan sudah tertarik ke
// Universitas STEKOM (stekom_awareness = 'sudah_minat').
//
// Kirim POST ke pmb.stekom.ac.id/api/tracking/submit-direct SATU PER SATU
// (berurutan, bukan paralel) dengan jeda antar request supaya tidak
// membanjiri API tujuan (burst paralel sebelumnya menyebabkan banyak gagal).
//
//   node scripts/backfill-pmb-tracking.mjs
//
// Aman dijalankan berulang secara teknis, tapi hindari kirim dobel ke PMB
// tanpa perlu.
import "dotenv/config";
import pg from "pg";

const DELAY_MS = 250;
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
    // Cegah request menggantung tanpa batas kalau server PMB tidak
    // merespons (kejadian sebelumnya: proses stuck tanpa progress).
    signal: AbortSignal.timeout(10_000),
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
      and stekom_awareness = 'sudah_minat'
    order by created_at asc
  `);
  console.log(`Kandidat backfill (sudah_minat): ${rows.length} voter`);

  let ok = 0;
  let fail = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      await sendTracking(row);
      ok++;
    } catch (e) {
      fail++;
      console.log(`Gagal [${row.id}]: ${e}`);
    }
    if ((i + 1) % 50 === 0 || i === rows.length - 1) {
      console.log(`${i + 1}/${rows.length}: ${ok} sukses, ${fail} gagal (sejauh ini)`);
    }
    if (i < rows.length - 1) await sleep(DELAY_MS);
  }

  console.log(`Selesai: ${ok} terkirim, ${fail} gagal dari ${rows.length} total.`);
} catch (e) {
  console.error("GAGAL:", e);
  process.exitCode = 1;
} finally {
  await client.end();
}
