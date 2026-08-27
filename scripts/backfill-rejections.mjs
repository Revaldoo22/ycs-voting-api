// Tarik riwayat penolakan LAMA dari tabel notifications ke tabel rejections.
//
//   node scripts/backfill-rejections.mjs --dry     (lihat dulu, tak menulis)
//   node scripts/backfill-rejections.mjs           (jalankan)
//
// Latar: vote/klaim yang ditolak dihapus dari database supaya voter bisa
// mengajukan ulang. Sebelum tabel rejections ada, satu-satunya jejak adalah
// notifikasi ke voter. Script ini merekonstruksi riwayatnya dari situ.
//
// Yang BISA diselamatkan: identitas voter (dari profiles), nama peserta &
// alasan penolakan (diurai dari isi notifikasi), dan waktu penolakan.
// Yang TIDAK ADA: bukti follow (URL-nya ikut terhapus bersama baris vote).
//
// Aman diulang: baris yang sudah pernah ditarik tidak diduplikasi (dikenali
// dari kombinasi voter + waktu notifikasi).
import "dotenv/config";
import pg from "pg";

const DRY = process.argv.includes("--dry");

const client = new pg.Client({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USER ?? "postgres",
  password: process.env.DB_PASSWORD ?? "postgres",
  database: process.env.DB_NAME ?? "idola_stekom",
});
await client.connect();

const { rows: check } = await client.query(
  `select to_regclass('public.rejections') is not null as ok`,
);
if (!check[0].ok) {
  console.error("Tabel rejections belum ada. Deploy backend terbaru dulu.");
  await client.end();
  process.exit(1);
}

// Notifikasi penolakan + identitas voter dari profiles.
const { rows: notifs } = await client.query(
  `select n.id, n.type, n.body, n.created_at,
          p.name as voter_name, p.email as voter_email,
          p.phone_number as voter_phone
   from notifications n
   join profiles p on p.id = n.profile_id
   where n.type in ('vote_rejected', 'coupon_claim_rejected')
   order by n.created_at`,
);

if (notifs.length === 0) {
  console.log("Tidak ada notifikasi penolakan. Tak ada yang bisa ditarik.");
  await client.end();
  process.exit(0);
}

/**
 * Urai isi notifikasi. Formatnya dibentuk votes-admin/coupon-claims-admin:
 *   vote:  "Vote kamu untuk NAMA belum bisa kami terima. Alasan: X. Kamu ..."
 *   klaim: "Klaim kupon undian handphone kamu belum bisa kami terima. Alasan: X. ..."
 * Kalau admin tak mengisi alasan, isinya "Bukti follow tidak sesuai."
 */
function parse(body) {
  const target = body.match(/Vote kamu untuk (.+?) belum bisa kami terima/);
  const withReason = body.match(/Alasan:\s*(.+?)\.\s*Kamu bisa/);
  const noReason = /Bukti follow tidak sesuai\./.test(body);
  return {
    participantName: target ? target[1].trim() : null,
    reason: withReason
      ? withReason[1].trim()
      : noReason
        ? "Bukti follow tidak sesuai."
        : null,
  };
}

const prepared = notifs.map((n) => {
  const { participantName, reason } = parse(n.body);
  return {
    kind: n.type === "vote_rejected" ? "vote" : "coupon_claim",
    reason,
    voterName: n.voter_name,
    voterEmail: n.voter_email,
    voterPhone: n.voter_phone,
    participantName,
    createdAt: n.created_at,
  };
});

console.log(`Ditemukan ${prepared.length} notifikasi penolakan:`);
console.table(
  prepared.slice(0, 10).map((r) => ({
    kind: r.kind,
    voter: r.voterName ?? r.voterEmail ?? "-",
    peserta: r.participantName ?? "-",
    alasan: (r.reason ?? "-").slice(0, 40),
    waktu: new Date(r.createdAt).toISOString().slice(0, 16),
  })),
);
if (prepared.length > 10) console.log(`... dan ${prepared.length - 10} lagi.`);

if (DRY) {
  console.log("\n--dry: tidak ada yang ditulis. Jalankan tanpa --dry untuk menarik.");
  await client.end();
  process.exit(0);
}

let inserted = 0;
let skipped = 0;
await client.query("begin");
try {
  for (const r of prepared) {
    // Idempotent: kenali duplikat dari voter + waktu + jenis.
    const { rows: dup } = await client.query(
      `select 1 from rejections
        where kind = $1 and created_at = $2
          and coalesce(voter_email, '') = coalesce($3, '')
          and coalesce(voter_phone, '') = coalesce($4, '')
        limit 1`,
      [r.kind, r.createdAt, r.voterEmail, r.voterPhone],
    );
    if (dup.length > 0) {
      skipped++;
      continue;
    }
    await client.query(
      `insert into rejections
         (kind, reason, voter_name, voter_email, voter_phone,
          participant_name, proofs, submitted_at, created_at)
       values ($1, $2, $3, $4, $5, $6, null, null, $7)`,
      [
        r.kind,
        r.reason,
        r.voterName,
        r.voterEmail,
        r.voterPhone,
        r.participantName,
        r.createdAt,
      ],
    );
    inserted++;
  }
  await client.query("commit");
} catch (e) {
  await client.query("rollback");
  throw e;
}

const { rows: summary } = await client.query(
  `select kind, count(*)::int as total,
          count(*) filter (where proofs is null)::int as tanpa_bukti
     from rejections group by kind order by kind`,
);
console.log(`\nDitarik: ${inserted}, dilewati (sudah ada): ${skipped}`);
console.table(summary);
console.log(
  "Catatan: baris hasil tarikan tak punya bukti follow, URL-nya sudah",
);
console.log("terhapus bersama baris vote/klaim aslinya.");
await client.end();
