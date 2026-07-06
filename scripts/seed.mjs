// Seed minimal produksi: settings row (event open) + satu akun admin.
// Jalankan SETELAH API start sekali dengan DB_SYNC=true (tabel sudah ada).
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

// Settings row (event terbuka).
await client.query(
  `insert into app_settings (id, event_open, closed_message, ip_daily_limit)
   values (true, true, '', 5) on conflict (id) do nothing`,
);

// Akun admin. Login pakai identifier "Admin".
const adminPw = "ycs@2026";
await client.query(
  `insert into profiles (name, phone_number, password_hash, role)
   values ($1,$2,$3,'admin')
   on conflict (phone_number) do update set password_hash = excluded.password_hash`,
  ["Admin", "0800000000", hashPassword(adminPw)],
);

await client.end();
console.log(`Seeded. Admin login → identifier: Admin | password: ${adminPw}`);
