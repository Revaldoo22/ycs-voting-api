// Dummy kupon undian: pastikan SEMUA profil voter punya kupon, plus
// generate voter dummy (default 300) supaya kolam undian ramai.
//   node scripts/seed-coupons.mjs [jumlah_dummy]
import "dotenv/config";
import pg from "pg";
import { randomBytes } from "crypto";

const EXTRA = Number(process.argv[2] ?? 300);
const code = () =>
  "YCS-" +
  Array.from({ length: 2 }, () =>
    randomBytes(3).toString("hex").slice(0, 4).toUpperCase(),
  ).join("-");

const FIRST = ["Adit","Bagas","Citra","Dewi","Eko","Fajar","Gita","Hana","Indra","Joko",
  "Kirana","Lutfi","Maya","Nanda","Oka","Putri","Raka","Sari","Tegar","Umi",
  "Vino","Wulan","Yoga","Zahra","Bima","Nadia","Rizky","Salsa","Dimas","Laras"];
const LAST = ["Pratama","Santoso","Wijaya","Saputra","Lestari","Ramadhan","Utami",
  "Nugroho","Maulana","Puspita","Hidayat","Anggraini","Setiawan","Rahayu","Kurniawan"];
const rand = (a) => a[Math.floor(Math.random() * a.length)];

const client = new pg.Client({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USER ?? "postgres",
  password: process.env.DB_PASSWORD ?? "postgres",
  database: process.env.DB_NAME ?? "idola_stekom",
});
await client.connect();

// 1. Voter dummy baru (onboarded + followed) — idempoten by phone.
console.log(`Membuat ${EXTRA} voter dummy...`);
for (let i = 0; i < EXTRA; i++) {
  const name = `${rand(FIRST)} ${rand(LAST)}`;
  const phone = `08${15500000000 + i}`;
  await client.query(
    `insert into profiles (name, phone_number, email, role, onboarded, followed_at)
     values ($1, $2, $3, 'voter', true, now())
     on conflict (phone_number) do nothing`,
    [name, phone, `dummy.voter.${i}@mail.com`],
  );
}

// 2. Kupon untuk SEMUA voter yang belum punya (1 per voter, race-safe).
console.log("Menerbitkan kupon untuk semua voter tanpa kupon...");
const voters = await client.query(`
  select pr.id from profiles pr
  where pr.role = 'voter'
    and not exists (select 1 from coupons c where c.profile_id = pr.id)`);
let made = 0;
for (const v of voters.rows) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await client.query(
        `insert into coupons (profile_id, code, source) values ($1, $2, 'follow')
         on conflict (profile_id, source) do nothing`,
        [v.id, code()],
      );
      made++;
      break;
    } catch (e) {
      if (!String(e).includes("duplicate")) throw e; // tabrakan kode → ulang
    }
  }
}

const stats = await client.query(`
  select (select count(*) from profiles where role='voter')::int as voters,
         (select count(*) from coupons)::int as coupons,
         (select count(*) from coupons where won_at is null)::int as pool`);
console.log("Selesai:", stats.rows[0], `(+${made} kupon baru)`);
await client.end();
