// Reset tabel regions lama agar skema baru (level/parent_id NOT NULL) bisa
// di-sync ulang tanpa error "column level contains null".
// Aman: data wilayah lama akan di-import ulang dari CSV (import-schools.mjs).
//
// Urutan pakai:
//   1. node scripts/reset-regions.mjs   (drop regions + kolom sekolah lama)
//   2. restart backend (DB_SYNC=true bikin ulang tabel)
//   3. node scripts/import-schools.mjs  (isi wilayah + sekolah)
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

// FK schools→regions & kolom lama harus dilepas dulu; TypeORM bikin ulang.
await client
  .query("alter table schools drop column if exists region_id cascade")
  .catch((e) => console.log("skip schools.region_id:", e.message));
await client.query("drop table if exists regions cascade");

console.log("regions lama di-drop. Restart backend (DB_SYNC) lalu import-schools.");
await client.end();
