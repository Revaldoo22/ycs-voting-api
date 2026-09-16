// Tandai vote uji coba milik "Atmin testing" sebagai bot supaya tidak ikut
// terhitung di kartu "Vote Sah" dashboard (query dashboard menyaring
// is_bot = false). Baris vote tetap tersimpan, jadi bisa dibalik.
//
// Ciri vote uji coba yang disasar: peserta "Atmin testing", voter_name
// "Test Poin", tanpa bukti follow. Semua syarat harus terpenuhi.
//
//   node scripts/tandai-vote-tes-sebagai-bot.mjs          # pratinjau saja
//   node scripts/tandai-vote-tes-sebagai-bot.mjs --tulis  # benar-benar ubah
//   node scripts/tandai-vote-tes-sebagai-bot.mjs --batal  # kembalikan
import "dotenv/config";
import pg from "pg";

const tulis = process.argv.includes("--tulis");
const batal = process.argv.includes("--batal");
const NAMA_PESERTA = "Atmin testing";
const NAMA_VOTER = "Test Poin";

const client = new pg.Client({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USER ?? "postgres",
  password: process.env.DB_PASSWORD ?? "postgres",
  database: process.env.DB_NAME ?? "idola_stekom",
});
await client.connect();
const one = async (sql, p) => (await client.query(sql, p)).rows[0];
const n = (v) => Number(v ?? 0).toLocaleString("id-ID");

// Syarat vote yang disasar. is_bot dibedakan sesuai arah operasi supaya
// menjalankan skrip dua kali tidak menggandakan efek.
const SYARAT = `
  p.name = $1
  and dv.voter_name = $2
  and dv.follow_proofs is null
  and dv.status = 'approved'
  and dv.is_bot = $3`;

try {
  const sebelum = await one(
    `select count(*)::int votes from daily_votes
      where is_bot = false and status = 'approved'`,
  );
  const sasaran = await one(
    `select count(*)::int n from daily_votes dv
       join participants p on p.id = dv.participant_id
      where ${SYARAT}`,
    [NAMA_PESERTA, NAMA_VOTER, batal],
  );

  console.log(`Mode      : ${batal ? "BATAL (bot -> vote biasa)" : "TANDAI (vote biasa -> bot)"}`);
  console.log(`Vote Sah sekarang : ${n(sebelum.votes)}`);
  console.log(`Vote yang disasar : ${n(sasaran.n)}`);
  console.log(
    `Vote Sah setelah  : ${n(sebelum.votes + (batal ? sasaran.n : -sasaran.n))}`,
  );

  if (sasaran.n === 0) {
    console.log("\nTidak ada yang perlu diubah.");
    process.exit(0);
  }
  if (!tulis && !batal) {
    console.log("\nIni baru pratinjau. Tambahkan --tulis untuk benar-benar mengubah.");
    process.exit(0);
  }

  const hasil = await one(
    `with sasaran as (
       select dv.id from daily_votes dv
         join participants p on p.id = dv.participant_id
        where ${SYARAT}
     )
     update daily_votes set is_bot = $4
       where id in (select id from sasaran)
     returning 1`,
    [NAMA_PESERTA, NAMA_VOTER, batal, !batal],
  );

  const sesudah = await one(
    `select count(*)::int votes from daily_votes
      where is_bot = false and status = 'approved'`,
  );
  const poin = await one(
    `select coalesce(sum(total_points), 0)::int poin from participants`,
  );

  console.log(`\nSelesai. Vote Sah kini ${n(sesudah.votes)}, Total Poin ${n(poin.poin)}.`);
  console.log(`Selisih ${n(sesudah.votes - poin.poin)}.`);
  if (!batal) console.log("Untuk membalik: node scripts/tandai-vote-tes-sebagai-bot.mjs --batal");
} finally {
  await client.end();
}
