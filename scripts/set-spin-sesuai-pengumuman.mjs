// Setel roda spin persis seperti pengumuman hadiah ke peserta.
//
//   node scripts/set-spin-sesuai-pengumuman.mjs --dry   (lihat dulu)
//   node scripts/set-spin-sesuai-pengumuman.mjs         (terapkan)
//
// Sasaran, mengikuti "Ringkasan Semua Hadiah":
//
//   Dash        cadangan, tanpa batas
//   1 Kunci     pasti didapat di titik acak spin 1-5, jatah 41 orang
//   Tumbler     1:300 di roda, atau otomatis 100 poin / 10x spin, jatah 8
//   Kaos        1:300 di roda, jatah 6 orang
//   Grand Prize TERKUNCI, tetap tampil di roda tapi peluang 0
//
// Kenapa bobot Dash 298: peluang = bobot dibagi TOTAL bobot. Dengan Tumbler 1
// dan Kaos 1, total 300 membuat masing-masing tepat 1 dari 300. Bobot 598
// yang lama memberi 1 dari 600, dua kali lebih sulit dari yang dijanjikan.
import "dotenv/config";
import pg from "pg";

const DRY = process.argv.includes("--dry");

const GRAND = ["sepeda_listrik", "hp_baru", "vip_bali", "emoney_1jt"];

const client = new pg.Client({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USER ?? "postgres",
  password: process.env.DB_PASSWORD ?? "postgres",
  database: process.env.DB_NAME ?? "idola_stekom",
});
await client.connect();

const { rows: cek } = await client.query(
  `select exists (select 1 from information_schema.columns
                   where table_name = 'spin_prizes' and column_name = 'is_locked')
            as ada_kolom,
          (select count(*)::int from spin_prizes) as jumlah`,
);
if (!cek[0].ada_kolom) {
  console.error("Kolom is_locked belum ada. Deploy backend terbaru dulu.");
  await client.end();
  process.exit(1);
}
if (cek[0].jumlah === 0) {
  console.error("Tabel spin_prizes kosong. Seed hadiah dulu lewat admin.");
  await client.end();
  process.exit(1);
}

const tampilkan = async (judul) => {
  const { rows } = await client.query(
    `select code, label, weight, active, is_locked, winner_quota,
            max_per_account, auto_at_points, auto_at_spins
       from spin_prizes order by sort_order`,
  );
  const total = rows
    .filter((r) => !r.is_locked && r.active && r.weight > 0)
    .reduce((s, r) => s + r.weight, 0);
  console.log(judul);
  console.table(
    rows.map((r) => ({
      hadiah: r.label,
      bobot: r.weight,
      peluang:
        !r.is_locked && r.active && r.weight > 0
          ? `1:${Math.round(total / r.weight)}`
          : "0",
      terkunci: r.is_locked,
      jatah: r.winner_quota ?? "tanpa batas",
      otomatis:
        r.auto_at_points || r.auto_at_spins
          ? `${r.auto_at_points ?? "-"} poin / ${r.auto_at_spins ?? "-"}x spin`
          : "-",
    })),
  );
  return total;
};

await tampilkan("SEBELUM:");

if (DRY) {
  console.log("\nYang akan diubah:");
  console.log("  - 4 grand prize dikunci (tetap tampil di roda, peluang 0)");
  console.log("  - Dash bobot 298, supaya Tumbler & Kaos tepat 1:300");
  console.log("  - Tumbler bobot 1, jatah 8, maks 1/akun, auto 100 poin / 10x");
  console.log("  - Kaos bobot 1, jatah 6, maks 1/akun");
  console.log("  - Kunci jatah 41, maks 1/akun, titik jaminan spin 1-5");
  console.log("\n--dry: tidak ada yang ditulis. Jalankan tanpa --dry.");
  await client.end();
  process.exit(0);
}

await client.query("begin");
try {
  // Grand prize: dikunci, tetap tampil di roda dengan peluang 0.
  await client.query(
    `update spin_prizes set is_locked = true, weight = 0 where code = any($1)`,
    [GRAND],
  );

  // Kunci: jaminan di titik acak spin 1-5, jatah 41 orang.
  await client.query(
    `update spin_prizes
        set weight = 0, is_guaranteed = true, guarantee_min_spin = 1,
            guarantee_max_spin = 5, winner_quota = 41, max_per_account = 1,
            key_grant = 1, active = true, is_locked = false
      where code = 'kunci_1'`,
  );

  // Tumbler: 1:300 di roda + otomatis 100 poin / 10x spin, jatah 8 orang.
  await client.query(
    `update spin_prizes
        set weight = 1, winner_quota = 8, max_per_account = 1,
            auto_at_points = 100, auto_at_spins = 10,
            active = true, is_locked = false
      where code = 'tumbler'`,
  );

  // Kaos: 1:300 di roda, jatah 6 orang.
  await client.query(
    `update spin_prizes
        set weight = 1, winner_quota = 6, max_per_account = 1,
            auto_at_points = null, auto_at_spins = null,
            active = true, is_locked = false
      where code = 'kaos_eksklusif'`,
  );

  // Dash: penyeimbang. 298 + 1 + 1 = 300, jadi Tumbler & Kaos tepat 1:300.
  await client.query(
    `update spin_prizes
        set weight = 298, winner_quota = null, max_per_account = null,
            stock = null, active = true, is_locked = false
      where is_empty = true`,
  );

  await client.query("commit");
} catch (e) {
  await client.query("rollback");
  throw e;
}

console.log("");
const total = await tampilkan("SESUDAH:");
console.log(`Total bobot yang diundi: ${total} (Tumbler & Kaos tepat 1:${total})`);
await client.end();
