// Tandai gelombang PENUTUP: setelah ditutup, tak ada gelombang lanjutan yang
// dibuat/diaktifkan otomatis, jadi kompetisi benar-benar berakhir.
//
//   node scripts/set-final-round.mjs "Grup C"
//   node scripts/set-final-round.mjs            (default: sequence terbesar)
//
// Aman diulang. Hanya satu gelombang yang boleh jadi penutup, jadi flag di
// gelombang lain otomatis dilepas.
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

const targetName = process.argv[2]?.trim();

const { rows: found } = await client.query(
  targetName
    ? `select id, name, sequence from rounds where lower(name) = lower($1)`
    : `select id, name, sequence from rounds
       order by sequence desc, created_at desc limit 1`,
  targetName ? [targetName] : [],
);

if (found.length === 0) {
  console.error(
    targetName
      ? `Gelombang "${targetName}" tidak ditemukan.`
      : "Belum ada gelombang di database.",
  );
  await client.end();
  process.exit(1);
}
if (found.length > 1) {
  console.error(`Ada ${found.length} gelombang bernama "${targetName}".`);
  console.error("Rapikan namanya dulu supaya tidak salah tandai.");
  await client.end();
  process.exit(1);
}

const target = found[0];
await client.query("begin");
try {
  // Hanya boleh ada satu penutup.
  await client.query(`update rounds set is_final = false where is_final = true`);
  await client.query(`update rounds set is_final = true where id = $1`, [
    target.id,
  ]);
  await client.query("commit");
} catch (e) {
  await client.query("rollback");
  throw e;
}

const { rows: all } = await client.query(
  `select name, status, sequence, top_n, is_final
     from rounds order by sequence, created_at`,
);
console.table(all);
console.log(
  `"${target.name}" ditandai sebagai gelombang penutup. Setelah ditutup,`,
);
console.log("tidak ada gelombang lanjutan yang dibuat otomatis.");
await client.end();
