// Bandingkan peringkat gelombang versi LAMA (tanpa filter status) dengan
// versi BENAR (hanya vote approved bukan bot).
//
//   node scripts/cek-dampak-poin.mjs            (semua gelombang)
//   node scripts/cek-dampak-poin.mjs "Grup B"   (satu gelombang)
//
// Latar: tujuh penjumlahan poin gelombang tidak menyaring status, sehingga
// vote yang masih menunggu verifikasi dan vote boost admin ikut dihitung.
// close() memakai angka itu untuk menentukan siapa lolos, jadi gelombang
// yang sudah ditutup perlu diperiksa apakah hasilnya berubah.
//
// Script ini HANYA MEMBACA. Tidak ada yang diubah.
import "dotenv/config";
import pg from "pg";

const namaRound = (process.argv[2] ?? "").trim();

const c = new pg.Client({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USER ?? "postgres",
  password: process.env.DB_PASSWORD ?? "postgres",
  database: process.env.DB_NAME ?? "idola_stekom",
});
await c.connect();

const { rows: rounds } = await c.query(
  `select id, name, sequence, status, top_n
     from rounds
    where ($1 = '' or lower(name) = lower($1))
    order by sequence`,
  [namaRound],
);

if (rounds.length === 0) {
  console.error(namaRound ? `Gelombang "${namaRound}" tidak ada.` : "Belum ada gelombang.");
  await c.end();
  process.exit(1);
}

for (const r of rounds) {
  console.log("");
  console.log("=".repeat(66));
  console.log(`${r.name}  (urutan ${r.sequence}, status ${r.status}, kuota dasar ${r.top_n})`);
  console.log("=".repeat(66));

  // Kuota efektif: dasar + sisa slot gelombang sebelumnya yang sudah ditutup.
  const { rows: kuotaRow } = await c.query(
    `with leftovers as (
       select greatest(rr.top_n - (
         select count(*) from round_participants rp
           join participants p on p.id = rp.participant_id
          where rp.round_id = rr.id and rp.status = 'lolos'
            and p.golden_buzzer = false), 0)::int as sisa
       from rounds rr
      where rr.sequence < $2 and rr.status = 'closed'
     )
     select ($1::int + coalesce((select sum(sisa) from leftovers), 0))::int as kuota`,
    [r.top_n, r.sequence],
  );
  const kuota = kuotaRow[0].kuota;
  console.log(`Kuota efektif: ${kuota}`);

  const { rows } = await c.query(
    `select p.id, p.name, p.golden_buzzer, rp.status as status_peserta,
            rp.carry_points::int as carry,
            (rp.carry_points + coalesce((
               select sum(dv.points) from daily_votes dv
                where dv.participant_id = rp.participant_id
                  and dv.round_id = rp.round_id
             ), 0))::int as poin_lama,
            (rp.carry_points + coalesce((
               select sum(dv.points) from daily_votes dv
                where dv.participant_id = rp.participant_id
                  and dv.round_id = rp.round_id
                  and dv.status = 'approved' and dv.is_bot = false
             ), 0))::int as poin_baru
       from round_participants rp
       join participants p on p.id = rp.participant_id
      where rp.round_id = $1 and p.golden_buzzer = false`,
    [r.id],
  );

  if (rows.length === 0) {
    console.log("Belum ada peserta di gelombang ini.");
    continue;
  }

  const berubah = rows.filter((x) => x.poin_lama !== x.poin_baru);
  console.log(
    `Peserta: ${rows.length}, yang poinnya berubah setelah perbaikan: ${berubah.length}`,
  );

  if (berubah.length === 0) {
    console.log("Tidak ada yang terpengaruh, hasil gelombang ini aman.");
    continue;
  }

  console.log("\nPoin yang berubah (10 terbesar):");
  console.table(
    [...berubah]
      .sort((a, b) => b.poin_lama - b.poin_baru - (a.poin_lama - a.poin_baru))
      .slice(0, 10)
      .map((x) => ({
        nama: x.name.slice(0, 26),
        carry: x.carry,
        poin_lama: x.poin_lama,
        poin_baru: x.poin_baru,
        kelebihan: x.poin_lama - x.poin_baru,
      })),
  );

  // Peringkat: urut poin menurun, ambil sebanyak kuota efektif.
  const urut = (kunci) =>
    [...rows].sort((a, b) => b[kunci] - a[kunci] || a.name.localeCompare(b.name));
  const lolosLama = new Set(urut("poin_lama").slice(0, kuota).map((x) => x.id));
  const lolosBaru = new Set(urut("poin_baru").slice(0, kuota).map((x) => x.id));

  const namaOf = new Map(rows.map((x) => [x.id, x.name]));
  const keluar = [...lolosLama].filter((id) => !lolosBaru.has(id));
  const masuk = [...lolosBaru].filter((id) => !lolosLama.has(id));

  const poinOf = new Map(rows.map((x) => [x.id, x.poin_baru]));

  // Ambang poin terendah yang masih lolos di versi benar. Peserta berpoin
  // sama dengan ambang ini hanya bersaing lewat tie-break nama, jadi
  // pergeserannya bukan akibat bug poinnya.
  const lolosBaruUrut = urut("poin_baru").slice(0, kuota);
  const ambang = lolosBaruUrut.length
    ? lolosBaruUrut[lolosBaruUrut.length - 1].poin_baru
    : 0;

  const nyata = (id) => poinOf.get(id) !== ambang;
  const keluarNyata = keluar.filter(nyata);
  const masukNyata = masuk.filter(nyata);

  console.log("\nPERBEDAAN DAFTAR LOLOS:");
  console.log(`  Ambang poin lolos versi benar: ${ambang}`);
  if (keluar.length === 0 && masuk.length === 0) {
    console.log("  Tidak ada. Meski poinnya berubah, siapa yang lolos tetap sama.");
  } else {
    console.log(
      `  ${keluar.length} keluar, ${masuk.length} masuk ` +
        `(${keluarNyata.length} keluar & ${masukNyata.length} masuk BUKAN karena tie-break)`,
    );

    if (keluarNyata.length || masukNyata.length) {
      console.log("\n  BENAR-BENAR TERPENGARUH BUG POIN:");
      keluarNyata.forEach((id) =>
        console.log(
          `  KELUAR : ${namaOf.get(id)}  (poin benar ${poinOf.get(id)}, di bawah ambang)`,
        ),
      );
      masukNyata.forEach((id) =>
        console.log(
          `  MASUK  : ${namaOf.get(id)}  (poin benar ${poinOf.get(id)}, di atas ambang)`,
        ),
      );
    }

    const tieK = keluar.length - keluarNyata.length;
    const tieM = masuk.length - masukNyata.length;
    if (tieK || tieM) {
      console.log(
        `\n  ${tieK + tieM} sisanya berpoin tepat ${ambang}, sama dengan ambang.\n` +
          "  Mereka bergeser hanya karena urutan nama saat poinnya seri, bukan\n" +
          "  karena bug. Siapa pun yang masuk di antara mereka sama sahnya.",
      );
    }
  }

  // Yang sudah ditandai lolos di database, dibanding versi benar.
  const ditandai = rows.filter((x) => x.status_peserta === "lolos");
  if (ditandai.length > 0) {
    const salah = ditandai.filter((x) => !lolosBaru.has(x.id));
    console.log(
      `\nSudah ditandai lolos di database: ${ditandai.length}` +
        (salah.length
          ? `, ${salah.length} di antaranya TIDAK masuk versi benar:`
          : ", semuanya cocok dengan versi benar."),
    );
    salah.forEach((x) =>
      console.log(`  ${x.name}  (poin benar ${x.poin_baru}, versi lama ${x.poin_lama})`),
    );
  }
}

console.log("");
console.log("Script ini hanya membaca. Tidak ada data yang diubah.");
await c.end();
