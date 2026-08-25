// Migrasi gelombang: unit yang lolos/gugur pindah dari SEKOLAH ke PESERTA.
//   node scripts/migrate-rounds-to-participants.mjs
//
// Yang dilakukan:
//   1. Buat tabel round_participants kalau belum ada (kalau API sudah pernah
//      jalan dengan synchronize, tabelnya sudah dibuat TypeORM).
//   2. Turunkan tiap baris round_schools jadi baris per peserta aktif sekolah
//      itu: status sekolah (lolos/gugur/active) diwariskan ke pesertanya.
//   3. carry_points sekolah dibagi rata ke peserta sekolah tsb (sisa pembagian
//      diberikan ke peserta paling atas urut nama, biar total tetap sama).
//   4. select_mode gelombang lama 'per_region' dibiarkan apa adanya; yang
//      sudah 'global' (mis. top 200) tetap global.
//
// Aman diulang (idempotent): baris yang sudah ada di round_participants tidak
// ditimpa. Tabel round_schools TIDAK dihapus, biar bisa dicek/rollback manual.
// Hapus sendiri setelah yakin: drop table round_schools;
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

const { rows: hasOld } = await client.query(
  `select to_regclass('public.round_schools') is not null as ok`,
);
if (!hasOld[0].ok) {
  console.log("Tabel round_schools tidak ada. Tidak ada yang perlu dimigrasi.");
  await client.end();
  process.exit(0);
}

await client.query("begin");
try {
  // 1. Tabel baru + index unik (kalau API belum pernah membuatnya).
  await client.query(`
    create table if not exists round_participants (
      id uuid primary key default gen_random_uuid(),
      round_id uuid not null,
      participant_id uuid not null,
      status text not null default 'active',
      carry_points int not null default 0,
      created_at timestamptz not null default now()
    )`);
  await client.query(
    `create unique index if not exists rp_uniq
       on round_participants (round_id, participant_id)`,
  );

  // 2 + 3. Turunkan keanggotaan sekolah ke pesertanya. carry_points dibagi
  // rata; sisa modulo jatuh ke peserta urutan awal (rn <= sisa).
  const { rowCount } = await client.query(`
    insert into round_participants
      (round_id, participant_id, status, carry_points)
    select rs.round_id,
           p.id,
           rs.status,
           (rs.carry_points / cnt.n)
             + case when p.rn <= (rs.carry_points % cnt.n) then 1 else 0 end
    from round_schools rs
    join lateral (
      select count(*)::int as n
      from participants x
      where x.school_id = rs.school_id and x.status = 'active'
    ) cnt on cnt.n > 0
    join lateral (
      select x.id,
             row_number() over (order by x.name, x.id)::int as rn
      from participants x
      where x.school_id = rs.school_id and x.status = 'active'
    ) p on true
    on conflict (round_id, participant_id) do nothing`);

  await client.query("commit");
  console.log(`Migrasi selesai. ${rowCount} baris peserta-gelombang dibuat.`);
} catch (e) {
  await client.query("rollback");
  throw e;
}

// Ringkasan hasil per gelombang, untuk dicek mata.
const { rows: summary } = await client.query(`
  select r.name, r.status, r.select_mode, r.top_n,
         count(*)::int as peserta,
         count(*) filter (where rp.status = 'lolos')::int as lolos,
         count(*) filter (where rp.status = 'gugur')::int as gugur
  from rounds r
  join round_participants rp on rp.round_id = r.id
  group by r.id, r.name, r.status, r.select_mode, r.top_n, r.created_at
  order by r.created_at`);
console.table(summary);

console.log(
  "Catatan: status lolos/gugur diwariskan dari sekolah. Kalau gelombang lama",
);
console.log(
  "mau dinilai ulang murni per peserta, tutup ulang lewat admin (top 200).",
);
console.log("round_schools sengaja tidak dihapus. Hapus manual kalau sudah yakin.");
await client.end();
