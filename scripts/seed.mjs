// Dev seed: settings row, sample schools/participants/quests + one admin.
// Run AFTER the API has started once with DB_SYNC=true (tables exist).
//   node scripts/seed.mjs
import "dotenv/config";
import pg from "pg";
import { randomBytes, scryptSync } from "crypto";

function hashPassword(plain) {
  const salt = randomBytes(16);
  const hash = scryptSync(plain, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

const client = new pg.Client({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USER ?? "postgres",
  password: process.env.DB_PASSWORD ?? "postgres",
  database: process.env.DB_NAME ?? "idola_stekom",
});

await client.connect();

// Settings row (event open).
await client.query(
  `insert into app_settings (id, event_open, closed_message, ip_daily_limit)
   values (true, true, '', 5) on conflict (id) do nothing`,
);

// Admin account.
const adminPw = "admin123";
await client.query(
  `insert into profiles (name, phone_number, password_hash, role)
   values ($1,$2,$3,'admin')
   on conflict (phone_number) do update set password_hash = excluded.password_hash`,
  ["Admin", "0800000000", hashPassword(adminPw)],
);

// Sample school + participants (skip when any participant already exists).
const existing = await client.query(`select count(*)::int as c from participants`);
if (existing.rows[0].c === 0) {
  const school = await client.query(
    `insert into schools (name) values ($1) returning id`,
    ["SMA Contoh 1"],
  );
  const schoolId = school.rows[0].id;

  // Participant with a login account (phone 0812xxx / password below).
  const pesertaPw = "peserta123";
  const prof = await client.query(
    `insert into profiles (name, phone_number, password_hash, role, school_id)
     values ($1,$2,$3,'participant',$4) returning id`,
    ["Peserta A", "0812000001", hashPassword(pesertaPw), schoolId],
  );
  await client.query(
    `insert into participants (profile_id, name, school_id, total_points, status)
     values ($1,$2,$3,$4,'active')`,
    [prof.rows[0].id, "Peserta A", schoolId, 120],
  );
  await client.query(
    `insert into participants (name, school_id, total_points, status)
     values ($1,$2,$3,'active')`,
    ["Peserta B", schoolId, 85],
  );

  // Sample quests.
  await client.query(
    `insert into quests (name, description, point, status, proof_type, frequency)
     values
       ('Follow Instagram STEKOM', 'Follow akun IG resmi', 10, 'active', 'file', 'global'),
       ('Share Poster Event', 'Bagikan poster ke story', 15, 'active', 'file', 'daily')`,
  );
  console.log(`Peserta login → 0812000001 / ${pesertaPw}`);
}

await client.end();
console.log(`Seeded. Admin login → identifier: Admin | password: ${adminPw}`);
