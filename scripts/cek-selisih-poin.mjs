// Cari tahu kenapa "Vote Sah" dan "Total Poin" di dashboard admin berbeda.
//
// Vote Sah  = count(*) baris daily_votes approved (non-bot)
// Total Poin = sum(total_points) seluruh peserta
//
// Keduanya baru cocok kalau tiap vote approved bernilai tepat 1 poin dan
// tak ada poin yang hilang di jalan. Skrip ini memecah selisihnya.
//
//   node scripts/cek-selisih-poin.mjs
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

const one = async (sql, params) => (await client.query(sql, params)).rows[0];
const all = async (sql, params) => (await client.query(sql, params)).rows;
const n = (v) => Number(v ?? 0).toLocaleString("id-ID");

try {
  // ---- Dua angka yang tampil di dashboard -------------------------------
  const { votes } = await one(
    `select count(*)::int votes from daily_votes
      where is_bot = false and status = 'approved'`,
  );
  const { poin } = await one(
    `select coalesce(sum(total_points), 0)::int poin from participants`,
  );

  console.log("== Angka di dashboard ==");
  console.log("Vote Sah   :", n(votes));
  console.log("Total Poin :", n(poin));
  console.log("Selisih    :", n(votes - poin));

  // ---- 1. Vote approved yang nilainya bukan 1 poin ----------------------
  // Dashboard hitung baris, bukan poin. Vote bernilai 0 langsung bikin beda.
  const sebaran = await all(
    `select points, count(*)::int n from daily_votes
      where is_bot = false and status = 'approved'
      group by points order by points`,
  );
  console.log("\n== 1. Sebaran nilai poin per vote approved ==");
  for (const r of sebaran) {
    const dampak = (1 - r.points) * r.n;
    console.log(
      `  points=${r.points} : ${n(r.n)} vote` +
        (dampak !== 0 ? `  -> selisih ${n(dampak)}` : ""),
    );
  }

  // ---- 2. Poin dari quest (menambah poin tanpa menambah vote) ----------
  const quest = await one(
    `select coalesce(sum(qu.point), 0)::int pts, count(*)::int n
       from submissions s join quests qu on qu.id = s.quest_id
      where s.status = 'approved'`,
  );
  console.log("\n== 2. Poin dari quest ==");
  console.log(`  ${n(quest.n)} submission -> +${n(quest.pts)} poin`);

  // ---- 3. Vote bot / boost ---------------------------------------------
  const bot = await one(
    `select count(*)::int n, coalesce(sum(points), 0)::int pts
       from daily_votes where is_bot = true`,
  );
  console.log("\n== 3. Vote boost (bot) ==");
  console.log(`  ${n(bot.n)} vote -> +${n(bot.pts)} poin (tak masuk Vote Sah)`);

  // ---- 4. Vote approved milik peserta yang sudah tak ada ---------------
  const yatim = await one(
    `select count(*)::int n from daily_votes dv
      where dv.is_bot = false and dv.status = 'approved'
        and not exists (select 1 from participants p where p.id = dv.participant_id)`,
  );
  console.log("\n== 4. Vote approved tanpa peserta ==");
  console.log(`  ${n(yatim.n)} vote (poinnya tak ikut terjumlah)`);

  // ---- 5. Peserta yang saldonya tak cocok dengan riwayatnya ------------
  // Menangkap poin yang hilang di jalan: rollback boost yang kepotong
  // greatest(0, ...), atau edit manual di database.
  const beda = await all(
    `select p.id, p.name, p.status, p.total_points,
            (coalesce(v.pts, 0) + coalesce(q.pts, 0))::int as seharusnya,
            (p.total_points - coalesce(v.pts, 0) - coalesce(q.pts, 0))::int as selisih
       from participants p
       left join (select participant_id, coalesce(sum(points), 0)::int pts
                    from daily_votes where status = 'approved'
                   group by participant_id) v on v.participant_id = p.id
       left join (select s.participant_id, coalesce(sum(qu.point), 0)::int pts
                    from submissions s join quests qu on qu.id = s.quest_id
                   where s.status = 'approved'
                   group by s.participant_id) q on q.participant_id = p.id
      where p.total_points <> coalesce(v.pts, 0) + coalesce(q.pts, 0)
      order by abs(p.total_points - coalesce(v.pts, 0) - coalesce(q.pts, 0)) desc
      limit 20`,
  );
  const totalBeda = await one(
    `select count(*)::int n,
            coalesce(sum(p.total_points - coalesce(v.pts, 0) - coalesce(q.pts, 0)), 0)::int total
       from participants p
       left join (select participant_id, coalesce(sum(points), 0)::int pts
                    from daily_votes where status = 'approved'
                   group by participant_id) v on v.participant_id = p.id
       left join (select s.participant_id, coalesce(sum(qu.point), 0)::int pts
                    from submissions s join quests qu on qu.id = s.quest_id
                   where s.status = 'approved'
                   group by s.participant_id) q on q.participant_id = p.id
      where p.total_points <> coalesce(v.pts, 0) + coalesce(q.pts, 0)`,
  );
  console.log("\n== 5. Peserta yang saldonya tak cocok riwayat ==");
  console.log(
    `  ${n(totalBeda.n)} peserta, total selisih ${n(totalBeda.total)}`,
  );
  for (const r of beda) {
    console.log(
      `  ${r.name} [${r.status}] saldo=${r.total_points} ` +
        `seharusnya=${r.seharusnya} selisih=${r.selisih}`,
    );
  }

  // ---- 6. Selisih halaman /admin/votes vs dashboard --------------------
  // Halaman votes menyaring follow_proofs is not null, dashboard tidak.
  const tanpaBukti = await one(
    `select count(*)::int n from daily_votes
      where is_bot = false and status = 'approved' and follow_proofs is null`,
  );
  console.log("\n== 6. Kenapa /admin/votes beda dengan dashboard ==");
  console.log(
    `  ${n(tanpaBukti.n)} vote approved tanpa bukti follow ` +
      `(dihitung dashboard, disembunyikan halaman votes)`,
  );
} finally {
  await client.end();
}
