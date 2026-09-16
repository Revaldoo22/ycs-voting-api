// Periksa vote milik peserta yang saldo poinnya tak cocok riwayat, untuk
// menentukan apakah vote itu data uji coba yang boleh dibuang.
//
//   node scripts/cek-vote-atmin.mjs "Atmin testing"
import "dotenv/config";
import pg from "pg";

const nama = process.argv[2] ?? "Atmin testing";
const client = new pg.Client({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USER ?? "postgres",
  password: process.env.DB_PASSWORD ?? "postgres",
  database: process.env.DB_NAME ?? "idola_stekom",
});
await client.connect();
const all = async (sql, p) => (await client.query(sql, p)).rows;

try {
  const [p] = await all(
    `select id, name, status, total_points, golden_buzzer, created_at
       from participants where name = $1`,
    [nama],
  );
  if (!p) {
    console.log(`Peserta "${nama}" tidak ditemukan.`);
    process.exit(0);
  }
  console.log("== Peserta ==");
  console.log(JSON.stringify(p, null, 2));

  console.log("\n== Vote per status & jenis ==");
  console.table(
    await all(
      `select status, vote_kind, is_bot, count(*)::int n,
              min(created_at) pertama, max(created_at) terakhir
         from daily_votes where participant_id = $1
        group by status, vote_kind, is_bot order by n desc`,
      [p.id],
    ),
  );

  console.log("\n== Sebaran per hari (10 hari teratas) ==");
  console.table(
    await all(
      `select date(created_at) tgl, count(*)::int n
         from daily_votes where participant_id = $1
        group by 1 order by n desc limit 10`,
      [p.id],
    ),
  );

  console.log("\n== Nomor WA voter (10 terbanyak) ==");
  console.table(
    await all(
      `select coalesce(voter_phone, '(kosong)') wa,
              coalesce(voter_name, '(kosong)') nama, count(*)::int n
         from daily_votes where participant_id = $1
        group by 1, 2 order by n desc limit 10`,
      [p.id],
    ),
  );

  console.log("\n== Berapa voter unik ==");
  console.table(
    await all(
      `select count(distinct voter_phone)::int wa_unik,
              count(distinct voter_email)::int email_unik,
              count(*)::int total_vote,
              count(*) filter (where follow_proofs is not null)::int ada_bukti
         from daily_votes where participant_id = $1`,
      [p.id],
    ),
  );

  console.log("\n== 5 vote terbaru (contoh isi) ==");
  console.table(
    await all(
      `select created_at, status, vote_kind, points, is_bot,
              voter_name, voter_phone,
              (follow_proofs is not null) as ada_bukti
         from daily_votes where participant_id = $1
        order by created_at desc limit 5`,
      [p.id],
    ),
  );
} finally {
  await client.end();
}
