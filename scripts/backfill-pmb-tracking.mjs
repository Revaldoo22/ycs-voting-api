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
// Resume otomatis: setiap ID yang SUKSES dicatat ke file progress
// (scripts/.pmb-backfill-done.log) di folder yang sama dengan script ini.
// Kalau proses berhenti di tengah (Ctrl+C, stuck, crash) dan dijalankan
// lagi, ID yang sudah ada di file itu otomatis dilewati -> tidak dobel
// kirim ke PMB.
import "dotenv/config";
import pg from "pg";
import { readFileSync, appendFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROGRESS_FILE = join(__dirname, ".pmb-backfill-done.log");

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

function loadDoneIds() {
  if (!existsSync(PROGRESS_FILE)) return new Set();
  return new Set(
    readFileSync(PROGRESS_FILE, "utf8").split("\n").map((l) => l.trim()).filter(Boolean),
  );
}

function markDone(id) {
  appendFileSync(PROGRESS_FILE, id + "\n");
}

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
  const { rows: allRows } = await client.query(`
    select id, name, email, phone_number
    from profiles
    where onboarded = true
      and role in ('voter', 'participant')
      and stekom_awareness = 'sudah_minat'
    order by created_at asc
  `);

  const doneIds = loadDoneIds();
  const rows = allRows.filter((r) => !doneIds.has(r.id));
  console.log(
    `Kandidat total (sudah_minat): ${allRows.length}. ` +
      `Sudah terkirim sebelumnya: ${doneIds.size}. Sisa dikirim sekarang: ${rows.length}`,
  );

  let ok = 0;
  let fail = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      await sendTracking(row);
      markDone(row.id);
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

  console.log(`Selesai: ${ok} terkirim, ${fail} gagal dari ${rows.length} sisa diproses.`);
} catch (e) {
  console.error("GAGAL:", e);
  process.exitCode = 1;
} finally {
  await client.end();
}
