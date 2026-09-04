// Kunci hadiah besar di roda spin, dan atur mode hadiah paksa.
//
//   node scripts/lock-grand-prizes.mjs --dry              (lihat dulu)
//   node scripts/lock-grand-prizes.mjs                    (kunci grand prize)
//   node scripts/lock-grand-prizes.mjs --paksa=tumbler --min=10
//   node scripts/lock-grand-prizes.mjs --paksa=off        (kembali acak)
//
// Kunci berbeda dari active=false: jalur otomatis dan jaminan tidak melihat
// active, jadi hadiah utama yang sekadar dinonaktifkan masih bisa lolos bila
// ambangnya keisi. Hadiah terkunci tidak pernah keluar lewat jalur mana pun,
// tapi tetap tampil di roda web kedua sebagai pemikat.
import "dotenv/config";
import pg from "pg";

const DRY = process.argv.includes("--dry");
const arg = (n) =>
  process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1] ?? null;

// Hadiah besar yang dikunci. Tumbler & Kaos TIDAK termasuk: itu hadiah yang
// memang dibagikan.
const GRAND = ["sepeda_listrik", "hp_baru", "vip_bali", "emoney_1jt"];

const paksa = arg("paksa");
const min = arg("min");

const client = new pg.Client({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USER ?? "postgres",
  password: process.env.DB_PASSWORD ?? "postgres",
  database: process.env.DB_NAME ?? "idola_stekom",
});
await client.connect();

const { rows: kolom } = await client.query(
  `select
     to_regclass('public.spin_prizes') is not null as ada_tabel,
     exists (select 1 from information_schema.columns
              where table_name = 'spin_prizes' and column_name = 'is_locked')
       as ada_kolom`,
);
if (!kolom[0].ada_tabel || !kolom[0].ada_kolom) {
  console.error("Kolom is_locked belum ada. Deploy backend terbaru dulu.");
  await client.end();
  process.exit(1);
}

console.log("Kondisi hadiah spin sekarang:");
const { rows: sebelum } = await client.query(
  `select code, label, weight, active, is_locked, winner_quota,
          auto_at_spins, auto_at_points
     from spin_prizes order by sort_order`,
);
console.table(sebelum);

if (DRY) {
  console.log("\nYang akan dikunci:", GRAND.join(", "));
  if (paksa) console.log("Mode paksa akan diset:", paksa, "min spin:", min ?? 0);
  console.log("\n--dry: tidak ada yang ditulis. Jalankan tanpa --dry.");
  await client.end();
  process.exit(0);
}

const { rowCount: terkunci } = await client.query(
  `update spin_prizes set is_locked = true, active = false, weight = 0
    where code = any($1) and is_locked = false`,
  [GRAND],
);
console.log(`\n${terkunci} hadiah besar dikunci.`);

if (paksa) {
  if (paksa === "off") {
    await client.query(
      `update app_settings
          set spin_forced_prize_code = null, spin_forced_min_spins = null`,
    );
    console.log("Mode paksa dimatikan, roda kembali acak.");
  } else {
    const { rows: target } = await client.query(
      `select code, label, is_locked from spin_prizes where code = $1`,
      [paksa],
    );
    if (target.length === 0) {
      console.error(`Hadiah "${paksa}" tidak ada. Batal.`);
      await client.end();
      process.exit(1);
    }
    if (target[0].is_locked) {
      console.error(
        `"${target[0].label}" terkunci, tidak bisa jadi hadiah paksa. Batal.`,
      );
      await client.end();
      process.exit(1);
    }
    await client.query(
      `update app_settings
          set spin_forced_prize_code = $1, spin_forced_min_spins = $2`,
      [paksa, min ? Number(min) : 0],
    );
    console.log(
      `Mode paksa: setiap spin dapat "${target[0].label}"` +
        (min ? `, mulai spin ke-${min}. Sebelum itu Dash.` : ", dari spin pertama."),
    );
  }
}

const { rows: sesudah } = await client.query(
  `select spin_enabled, spin_forced_prize_code, spin_forced_min_spins
     from app_settings`,
);
console.table(sesudah);
const { rows: akhir } = await client.query(
  `select code, label, weight, active, is_locked
     from spin_prizes order by sort_order`,
);
console.table(akhir);
await client.end();
