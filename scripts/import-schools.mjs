// Import wilayah (provinsi/kabupaten/kecamatan) + sekolah dari schools.csv.
// Idempoten: skip yang sudah ada (by code / npsn).
// Jalankan SETELAH tabel dibuat (DB_SYNC=true sekali).
//   node scripts/import-schools.mjs
//
// CSV header: npsn,name,jenjang,provinsi,kabupaten,kecamatan,
//             provinceCode,regencyCode,districtCode
import "dotenv/config";
import pg from "pg";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV = join(__dirname, "..", "schools.csv");

// --- CSV parser sederhana (handle quoted field dengan koma) ---
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      if (field !== "" || row.length) {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      }
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const client = new pg.Client({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USER ?? "postgres",
  password: process.env.DB_PASSWORD ?? "postgres",
  database: process.env.DB_NAME ?? "idola_stekom",
});
await client.connect();

const raw = readFileSync(CSV, "utf8");
const rows = parseCsv(raw);
const header = rows.shift();
const col = Object.fromEntries(header.map((h, i) => [h.trim(), i]));

// --- Kumpulkan wilayah unik per level ---
const provinces = new Map(); // code -> name
const regencies = new Map(); // code -> { name, provinceCode }
const districts = new Map(); // code -> { name, regencyCode }

for (const r of rows) {
  if (r.length < 9) continue;
  const pc = r[col.provinceCode]?.trim();
  const rc = r[col.regencyCode]?.trim();
  const dc = r[col.districtCode]?.trim();
  if (pc && !provinces.has(pc)) provinces.set(pc, r[col.provinsi]?.trim());
  if (rc && !regencies.has(rc))
    regencies.set(rc, { name: r[col.kabupaten]?.trim(), provinceCode: pc });
  if (dc && !districts.has(dc))
    districts.set(dc, { name: r[col.kecamatan]?.trim(), regencyCode: rc });
}

console.log(
  `Wilayah: ${provinces.size} provinsi, ${regencies.size} kab/kota, ${districts.size} kecamatan`,
);

// --- Insert regions bertingkat, kumpulkan code -> id ---
const codeToId = new Map();

async function upsertRegion(code, name, level, parentCode) {
  const parentId = parentCode ? codeToId.get(parentCode) ?? null : null;
  const res = await client.query(
    `insert into regions (name, code, level, parent_id)
     values ($1,$2,$3,$4)
     on conflict (code) do update set name = excluded.name,
       level = excluded.level, parent_id = excluded.parent_id
     returning id`,
    [name || code, code, level, parentId],
  );
  codeToId.set(code, res.rows[0].id);
}

for (const [code, name] of provinces) await upsertRegion(code, name, "province", null);
console.log("Provinsi selesai.");
for (const [code, r] of regencies)
  await upsertRegion(code, r.name, "regency", r.provinceCode);
console.log("Kabupaten selesai.");
for (const [code, d] of districts)
  await upsertRegion(code, d.name, "district", d.regencyCode);
console.log("Kecamatan selesai.");

// --- Insert sekolah (batch). region_id = regency (kabupaten). ---
const BATCH = 500;
let done = 0;
for (let i = 0; i < rows.length; i += BATCH) {
  const chunk = rows.slice(i, i + BATCH).filter((r) => r.length >= 9);
  if (!chunk.length) continue;
  const values = [];
  const params = [];
  chunk.forEach((r, k) => {
    const rc = r[col.regencyCode]?.trim() || null;
    const base = k * 7;
    params.push(
      r[col.npsn]?.trim() || null,
      r[col.name]?.trim() || "(tanpa nama)",
      r[col.jenjang]?.trim() || null,
      rc ? codeToId.get(rc) ?? null : null,
      r[col.provinceCode]?.trim() || null,
      rc,
      r[col.districtCode]?.trim() || null,
    );
    values.push(
      `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7})`,
    );
  });
  await client.query(
    `insert into schools
       (npsn, name, jenjang, region_id, province_code, regency_code, district_code)
     values ${values.join(",")}
     on conflict (npsn) do update set
       name = excluded.name, jenjang = excluded.jenjang,
       region_id = excluded.region_id, province_code = excluded.province_code,
       regency_code = excluded.regency_code, district_code = excluded.district_code`,
    params,
  );
  done += chunk.length;
  if (done % 5000 < BATCH) console.log(`  ${done}/${rows.length} sekolah…`);
}

await client.end();
console.log(`Selesai. ${done} sekolah di-import.`);
