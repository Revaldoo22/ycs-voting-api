// Cleanup migrasi aturan vote baru:
//   1. HAPUS semua vote favorit (vote_kind='fav20', +20 poin).
//   2. Normalkan poin daily5 lama (+5) menjadi +1 (1 akun = 1 suara).
//   3. Recalculate participants.total_points dari sisa vote + quest approved.
//   4. Buang unique index lama (per peserta+tanggal+kind) & pasang index
//      GLOBAL per identitas (email/WA/device) → 1 akun = 1 vote seumur event.
//
// Jalankan SEKALI setelah deploy kode baru:
//   node scripts/cleanup-fav20.mjs
//
// Idempoten: aman dijalankan ulang.
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

try {
  await client.query("begin");

  // 1. Hapus semua vote favorit (+20).
  const del = await client.query(`delete from daily_votes where vote_kind = 'fav20'`);
  console.log(`Hapus vote fav20: ${del.rowCount} baris`);

  // 2. Poin tiap vote yang tersisa = 1 (dulu daily5 = 5).
  const upd = await client.query(`update daily_votes set points = 1 where points <> 1`);
  console.log(`Normalkan poin vote menjadi +1: ${upd.rowCount} baris`);

  // 3. Recalculate total_points peserta = SUM(vote points) + SUM(quest point approved).
  await client.query(`
    update participants p set total_points = coalesce(v.pts, 0) + coalesce(q.pts, 0)
    from (
      select p2.id,
             (select coalesce(sum(dv.points), 0) from daily_votes dv where dv.participant_id = p2.id) as pts
      from participants p2
    ) v
    left join (
      select s.participant_id, coalesce(sum(qt.point), 0) as pts
      from submissions s join quests qt on qt.id = s.quest_id
      where s.status = 'approved'
      group by s.participant_id
    ) q on q.participant_id = v.id
    where p.id = v.id
  `);
  console.log("Recalculate total_points peserta: selesai");

  // 4. DEDUP data lama: aturan baru = 1 akun 1 vote, tapi di sistem lama satu
  //    identitas bisa vote banyak peserta. Simpan vote PALING AWAL per identitas
  //    (email → phone → device), buang sisanya, lalu recalc ulang total_points.
  //    Dijalankan berulang sampai tak ada lagi baris terhapus (identitas bisa
  //    tumpang tindih antar-kolom).
  let totalDedup = 0;
  for (const col of ["voter_email", "voter_phone", "device_fingerprint"]) {
    const r = await client.query(`
      delete from daily_votes dv using (
        select id,
               row_number() over (
                 partition by ${col} order by created_at asc, id asc
               ) as rn
        from daily_votes
        where ${col} is not null
      ) d
      where dv.id = d.id and d.rn > 1`);
    totalDedup += r.rowCount;
    console.log(`Dedup by ${col}: hapus ${r.rowCount} vote berlebih`);
  }
  console.log(`Total vote duplikat dibuang: ${totalDedup}`);

  // Recalc ulang total_points setelah dedup.
  await client.query(`
    update participants p set total_points = coalesce(v.pts, 0) + coalesce(q.pts, 0)
    from (
      select p2.id,
             (select coalesce(sum(dv.points), 0) from daily_votes dv where dv.participant_id = p2.id) as pts
      from participants p2
    ) v
    left join (
      select s.participant_id, coalesce(sum(qt.point), 0) as pts
      from submissions s join quests qt on qt.id = s.quest_id
      where s.status = 'approved'
      group by s.participant_id
    ) q on q.participant_id = v.id
    where p.id = v.id
  `);

  // 5. Index: drop lama (per peserta+tanggal+kind), pasang GLOBAL per identitas.
  //    NULL tidak dianggap duplikat di Postgres → device/phone/email kosong aman.
  await client.query(`drop index if exists dv_uniq_device`);
  await client.query(`drop index if exists dv_uniq_phone`);
  await client.query(`drop index if exists dv_uniq_email`);
  await client.query(
    `create unique index if not exists dv_uniq_device on daily_votes (device_fingerprint)`,
  );
  await client.query(
    `create unique index if not exists dv_uniq_phone on daily_votes (voter_phone)`,
  );
  await client.query(
    `create unique index if not exists dv_uniq_email on daily_votes (voter_email)`,
  );
  console.log("Index unik global (device/phone/email) terpasang");

  await client.query("commit");

  const stats = await client.query(`
    select (select count(*) from daily_votes)::int as votes,
           (select count(distinct voter_email) from daily_votes)::int as emails,
           (select coalesce(sum(total_points), 0) from participants)::int as total_points`);
  console.log("Selesai:", stats.rows[0]);
} catch (e) {
  await client.query("rollback");
  console.error("GAGAL, rollback:", e);
  process.exitCode = 1;
} finally {
  await client.end();
}
