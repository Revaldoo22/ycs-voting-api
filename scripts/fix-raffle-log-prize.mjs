// Selaraskan hadiah di raffle_events dengan hadiah sebenarnya di coupons.
//
//   node scripts/fix-raffle-log-prize.mjs --dry   (lihat dulu)
//   node scripts/fix-raffle-log-prize.mjs         (jalankan)
//
// Latar: mode roda memanggil /draw SEBELUM roda berhenti, jadi log terisi
// hadiah tebakan dari kolom admin (dulu default "Handphone"). Setelah roda
// berhenti hanya coupons yang dikoreksi, sehingga Log Aktivitas menampilkan
// hadiah utama untuk pemenang yang sebenarnya dapat Tumbler.
//
// coupons adalah sumber kebenaran: itu yang dipakai halaman Pemenang dan yang
// dilihat voter di Kupon Saya.
//
// Aman diulang. Hanya baris 'won' yang kuponnya masih menang yang disentuh.
import "dotenv/config";
import pg from "pg";

const DRY = process.argv.includes("--dry");

const client = new pg.Client({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USER ?? "postgres",
  password: process.env.DB_PASSWORD ?? "postgres",
  database: process.env.DB_NAME ?? "idola_stekom",
});
await client.connect();

const { rows: beda } = await client.query(
  `select re.id, re.coupon_code, re.prize as di_log, c.prize as sebenarnya,
          re.created_at, pr.name
     from raffle_events re
     join coupons c on c.code = re.coupon_code
     left join profiles pr on pr.id = re.profile_id
    where re.event_type = 'won'
      and c.won_at is not null
      and coalesce(re.prize, '') <> coalesce(c.prize, '')
    order by re.created_at desc`,
);

if (beda.length === 0) {
  console.log("Bersih: hadiah di log sudah sama dengan hadiah sebenarnya.");
  await client.end();
  process.exit(0);
}

console.log(`${beda.length} baris log hadiahnya salah:`);
console.table(
  beda.map((r) => ({
    waktu: new Date(r.created_at).toISOString().slice(0, 16).replace("T", " "),
    kupon: r.coupon_code,
    nama: (r.name ?? "-").slice(0, 24),
    di_log: r.di_log,
    sebenarnya: r.sebenarnya,
  })),
);

if (DRY) {
  console.log("\n--dry: tidak ada yang ditulis. Jalankan tanpa --dry.");
  await client.end();
  process.exit(0);
}

const { rowCount } = await client.query(
  `update raffle_events re
      set prize = c.prize
     from coupons c
    where c.code = re.coupon_code
      and re.event_type = 'won'
      and c.won_at is not null
      and coalesce(re.prize, '') <> coalesce(c.prize, '')`,
);

console.log(`\n${rowCount} baris log diperbaiki.`);

const { rows: sisa } = await client.query(
  `select prize, count(*)::int as baris
     from raffle_events where event_type = 'won'
    group by prize order by 2 desc`,
);
console.table(sisa);
await client.end();
