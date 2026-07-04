// Data dummy: 20 kabupaten × 10 sekolah = 200 sekolah, 200 peserta
// (1/sekolah) + akun login, plus ribuan vote acak 14 hari terakhir supaya
// heatmap/ranking/chart hidup.
//   node scripts/seed-dummy.mjs
import "dotenv/config";
import pg from "pg";
import { randomBytes, scryptSync } from "crypto";

function hashPassword(plain) {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(plain, salt, 64).toString("hex")}`;
}
const rand = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rand(arr.length)];

// 20 kabupaten/kota Jawa Tengah + kode BPS (buat join GeoJSON nanti).
const REGIONS = [
  ["Kab. Semarang", "3322"], ["Kota Semarang", "3374"], ["Kab. Kendal", "3324"],
  ["Kab. Demak", "3321"], ["Kab. Grobogan", "3315"], ["Kab. Boyolali", "3309"],
  ["Kab. Klaten", "3310"], ["Kab. Sukoharjo", "3311"], ["Kota Surakarta", "3372"],
  ["Kab. Karanganyar", "3313"], ["Kab. Sragen", "3314"], ["Kab. Blora", "3316"],
  ["Kab. Rembang", "3317"], ["Kab. Pati", "3318"], ["Kab. Kudus", "3319"],
  ["Kab. Jepara", "3320"], ["Kab. Temanggung", "3323"], ["Kab. Batang", "3325"],
  ["Kab. Pekalongan", "3326"], ["Kota Pekalongan", "3375"],
];

const FIRST = ["Adit","Bagas","Citra","Dewi","Eko","Fajar","Gita","Hana","Indra","Joko",
  "Kirana","Lutfi","Maya","Nanda","Oka","Putri","Raka","Sari","Tegar","Umi",
  "Vino","Wulan","Yoga","Zahra","Bima","Nadia","Rizky","Salsa","Dimas","Laras"];
const LAST = ["Pratama","Santoso","Wijaya","Saputra","Lestari","Ramadhan","Utami",
  "Nugroho","Maulana","Puspita","Hidayat","Anggraini","Setiawan","Rahayu","Kurniawan"];
const name = () => `${pick(FIRST)} ${pick(LAST)}`;

const client = new pg.Client({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USER ?? "postgres",
  password: process.env.DB_PASSWORD ?? "postgres",
  database: process.env.DB_NAME ?? "idola_stekom",
});
await client.connect();

// Guard: jangan dobel.
const existing = await client.query("select count(*)::int as c from regions");
if (existing.rows[0].c >= 20) {
  console.log("Regions sudah >= 20 — dummy tampaknya sudah pernah di-seed. Batal.");
  process.exit(0);
}

console.log("Seeding 20 kabupaten…");
const regionIds = [];
for (const [nm, code] of REGIONS) {
  const r = await client.query(
    `insert into regions (name, code, province) values ($1,$2,'Jawa Tengah')
     on conflict (code) do update set name = excluded.name
     returning id`,
    [nm, code],
  );
  regionIds.push(r.rows[0].id);
}

console.log("Seeding 200 sekolah + 200 peserta…");
const pesertaPwHash = hashPassword("peserta123");
const participantIds = [];
let phoneSeq = 82200000001;

for (let ri = 0; ri < REGIONS.length; ri++) {
  const [regionName] = REGIONS[ri];
  const short = regionName.replace(/^Kab\. |^Kota /, "");
  for (let si = 1; si <= 10; si++) {
    const jenis = si % 2 === 0 ? "SMK" : "SMA";
    const schoolName = `${jenis} Negeri ${si} ${short}`;
    const s = await client.query(
      `insert into schools (name, region_id) values ($1,$2) returning id`,
      [schoolName, regionIds[ri]],
    );
    const schoolId = s.rows[0].id;

    const pname = name();
    const phone = `0${phoneSeq++}`;
    const prof = await client.query(
      `insert into profiles (name, phone_number, password_hash, role, school_id)
       values ($1,$2,$3,'participant',$4) returning id`,
      [pname, phone, pesertaPwHash, schoolId],
    );
    const p = await client.query(
      `insert into participants (profile_id, name, school_id, status, description)
       values ($1,$2,$3,'active',$4) returning id`,
      [prof.rows[0].id, pname, schoolId,
       `Halo! Aku ${pname.split(" ")[0]} dari ${schoolName}. Dukung aku ya!`],
    );
    participantIds.push(p.rows[0].id);
  }
}

console.log("Seeding voter pool + vote acak 14 hari…");
// 400 voter anonim.
const voters = [];
for (let i = 0; i < 400; i++) {
  const nm = name();
  voters.push({
    name: nm,
    phone: `08${13000000000 + i}`,
    email: `${nm.toLowerCase().replace(/\s+/g, ".")}.${i}@mail.com`,
    status: pick(["teman_sekolah", "guru", "keluarga", "teman_luar"]),
  });
}

// Bangun kombinasi unik (participant, phone, date, kind) — hormati constraint.
const seen = new Set();
const rows = [];
const today = new Date();
const TARGET = 6000;
let guardLoop = 0;
while (rows.length < TARGET && guardLoop < TARGET * 10) {
  guardLoop++;
  const v = pick(voters);
  // bias: sebagian kabupaten lebih "panas" — pakai kuadrat biar timpang.
  const pi = Math.floor(Math.pow(Math.random(), 1.6) * participantIds.length);
  const participantId = participantIds[pi];
  const daysAgo = rand(14);
  const d = new Date(today);
  d.setDate(d.getDate() - daysAgo);
  const date = d.toISOString().slice(0, 10);
  const kind = Math.random() < 0.15 ? "fav20" : "daily5";
  const key = `${participantId}|${v.phone}|${date}|${kind}`;
  if (seen.has(key)) continue;
  seen.add(key);
  rows.push([
    participantId, date, kind, kind === "fav20" ? 20 : 5,
    `fp-${v.phone}`, v.name, v.phone, v.email, v.status,
    d.toISOString(),
  ]);
}

// Insert batch.
const BATCH = 500;
for (let i = 0; i < rows.length; i += BATCH) {
  const chunk = rows.slice(i, i + BATCH);
  const values = [];
  const params = [];
  chunk.forEach((r, j) => {
    const o = j * 10;
    values.push(
      `($${o+1},$${o+2},$${o+3},$${o+4},$${o+5},$${o+6},$${o+7},$${o+8},$${o+9},$${o+10})`,
    );
    params.push(...r);
  });
  await client.query(
    `insert into daily_votes
       (participant_id, vote_date, vote_kind, points, device_fingerprint,
        voter_name, voter_phone, voter_email, voter_status, created_at)
     values ${values.join(",")}
     on conflict do nothing`,
    params,
  );
}

console.log("Sinkron total_points dari votes…");
await client.query(`
  update participants p set total_points = coalesce(v.pts, 0)
  from (select participant_id, sum(points) as pts
        from daily_votes group by participant_id) v
  where v.participant_id = p.id`);

const stats = await client.query(`
  select (select count(*) from regions)::int as regions,
         (select count(*) from schools)::int as schools,
         (select count(*) from participants)::int as participants,
         (select count(*) from daily_votes)::int as votes`);
console.log("Selesai:", stats.rows[0]);
console.log("Login peserta dummy: nomor 082200000001 dst / password peserta123");
await client.end();
