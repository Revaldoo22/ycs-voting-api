# API Integrasi — Web Pendaftaran → YCS

Dokumen singkat buat tim web pendaftaran. Semua endpoint server-ke-server.

**Arsitektur:** web pendaftaran = **sumber data (master)**. Sistem YCS ini =
**replika**. Kalian distribusikan data ke sini; kunci sinkronnya **`email`**
peserta. Kirim ulang `email` yang sama = update, bukan dobel — kalian tidak
perlu menyimpan ID apa pun dari sini.

> **Email juga jadi dasar pencocokan voter:** kalau ada voter yang login SSO
> Google dengan email sama seperti peserta, dia otomatis ditandai **"Peserta"**
> dan **tidak bisa vote dirinya sendiri**.

> **Cukup pakai 2 endpoint utama:** (1) Sync Peserta dan (2) Sync Konten —
> keduanya by `email`. Endpoint lain di bagian *Legacy* hanya untuk kompatibilitas.

## Auth (wajib tiap request)

Kirim 2 header ini:

```
X-Api-Key: <API_KEY_YANG_DIBERIKAN>
Content-Type: application/json
```

Base URL: `https://api-idola.stekom.ac.id/api/integrations`

---

## 1. Sync Peserta (by email)

**POST** `/participants/sync`

Kirim data peserta + `email` (kunci). Create kalau baru, update kalau `email`
sudah pernah dikirim. Nomor WA & sekolah ikut disinkron.

Body:

```json
{
  "email": "budi@sekolah.sch.id",
  "name": "Budi Santoso",
  "phone_number": "08123456789",
  "npsn": "20325001",
  "school_name": "SMA Negeri 1 Semarang",
  "region_id": "b3f1a2c0-1234-4a5b-8c9d-abcdef012345",
  "external_id": "PST-000123",
  "description": "opsional",
  "photo_url": "https://cdn-kalian.com/foto/budi.jpg",
  "status": "active"
}
```

| Field | Wajib | Keterangan |
|-------|-------|-----------|
| `email` | ✅ | **kunci sync** + dasar pencocokan voter |
| `name` | ✅ | 2–100 |
| `phone_number` | ✅ | 8–20 digit |
| `npsn` | — | NPSN sekolah dari data master (8 digit angka). Kalau **cocok master**, kabupaten & provinsi **otomatis terisi dari NPSN** dan ini selalu menang — abaikan `region_id`/`region_code`. Kosong/tak cocok → fallback ke `school_name` + `region_id`/`region_code`. Sync **tidak pernah ditolak** karena NPSN. |
| `school_name` | — | dipakai kalau `npsn` kosong/tak cocok master |
| `region_id` | — | **ID kabupaten internal sistem ini** (UUID, ambil dari `GET /regions`). Dipakai **hanya kalau `npsn` kosong/tak cocok** dan sekolah belum punya kabupaten — misal data kalian tidak punya NPSN. Prioritas di atas `region_code`. |
| `region_code` | — | Alternatif `region_id` — kode BPS kabupaten (mis. `"3374"`), dipakai kalau `region_id` tidak dikirim. |
| `external_id` | — | ID kalian (disimpan, opsional) |
| `description` / `photo_url` / `status` | — | opsional |

> **Kalau data kalian punya NPSN** — cukup kirim `npsn`, kabupaten & provinsi
> langsung terisi otomatis, tak perlu `region_id`/`region_code` sama sekali.
>
> **Kalau sebagian data tidak punya NPSN** (atau NPSN-nya tidak ada di master
> 36rb+ sekolah kami) — kirim `region_id` (disarankan) atau `region_code`
> supaya kabupaten peserta tetap terisi, bukan kosong. Ambil daftar UUID
> kabupaten dari **GET `/regions`** (lihat bagian 6) lalu simpan mapping-nya
> di sisi kalian. `region_id`/`region_code` **hanya dipakai sebagai fallback**
> — begitu NPSN valid tersedia di kiriman berikutnya, wilayah dari NPSN yang
> menang.

Respon: `{ "created": true|false, "participant": { ... } }`

Verifikasi + ambil link/statistik/peringkat: **GET** `/participants/by-email/{email}` (lihat bagian 3).

> Ganti nama, nomor WA, sekolah, foto, status — semua cukup lewat endpoint ini
> (kirim ulang dengan `email` sama). Nomor/email dicek unik → `409` bila bentrok.

---

## 2. Sync Konten Peserta (by email)

**PUT** `/participants/by-email/{email}/contents`

Ganti **seluruh** daftar konten peserta (full-replace).

Body:

```json
{
  "contents": [
    { "kind": "engage", "url": "https://instagram.com/p/xxxx", "label": "Reels" },
    { "kind": "sound",  "url": "https://tiktok.com/@x/video/123" }
  ]
}
```

| Field | Wajib | Keterangan |
|-------|-------|-----------|
| `kind` | ✅ | `engage` atau `sound` |
| `url` | ✅ | URL konten |
| `label` | — | maks 150 karakter |

- Maksimal 50 item.
- **Full-replace**: yang tidak dikirim akan terhapus. Kirim daftar lengkap tiap sync.

Respon: `{ "ok": true, "count": 2 }`

---

## 3. Link Voting + Statistik & Peringkat Peserta

Buat **link "lihat halaman voting"** di web kalian, sekalian ambil statistik
akun peserta (jumlah voter, poin, peringkat).

**GET** `/participants/by-email/{email}` ← **disarankan** (email unik, tak ambigu)

**GET** `/participants/by-name/{name}` ← lookup cepat by nama (URL-encode spasi).
Kalau nama terdaftar di lebih dari satu peserta → `409` (pakai by-email).

Respon (dua-duanya struktur sama; by-email menambah `participant` + `contents`):

```json
{
  "id": "03db696e-4c7f-4013-8b89-3a40641142b2",
  "name": "Oka Pratama",
  "view_url": "https://idola.stekom.ac.id/peserta/03db696e-4c7f-4013-8b89-3a40641142b2",
  "school_name": "SMA Negeri 3 Semarang",
  "regency_name": "Kota Semarang",
  "stats": { "total_points": 885, "voters": 99, "votes": 114 },
  "rank": {
    "school":   { "position": 1, "total": 1 },
    "regency":  { "position": 2, "total": 20 },
    "national": { "position": 2, "total": 202 }
  }
}
```

| Field | Keterangan |
|-------|-----------|
| `id` | ID peserta di sistem ini — dipakai untuk link |
| `view_url` | URL siap-pakai halaman voting peserta (`https://idola.stekom.ac.id/peserta/{id}`) |
| `school_name` / `regency_name` | nama sekolah & kabupaten/kota (label) |
| `stats.total_points` | total poin peserta |
| `stats.voters` | jumlah **voter unik** (nomor WA berbeda) yang mendukung |
| `stats.votes` | total vote masuk (semua jenis) |
| `rank.school` / `rank.regency` / `rank.national` | peringkat `position` dari total peserta `total` di lingkup sekolah / kabupaten / nasional. `null` bila peserta belum punya sekolah/kabupaten. |

> Peringkat diurut dari poin tertinggi. Angka semuanya bertipe number.

---

## 4. Leaderboard (papan peringkat)

Untuk ditampilkan di web pendaftaran. Semua menerima query `?limit=` (default
50, maks 200). Respon: `{ "count": N, "leaderboard": [ ... ] }` — sudah terurut,
tiap item punya `position`.

**GET** `/leaderboard/participants` — peringkat peserta by total poin (nasional).

```json
{ "position": 1, "id": "…", "name": "Dimas Rahayu", "total_points": 1345,
  "school_name": "SMA Negeri 1 Semarang", "regency_name": "Kota Semarang", "voters": 147 }
```

**GET** `/leaderboard/schools` — peringkat sekolah by akumulasi poin pesertanya.

```json
{ "position": 1, "id": "…", "school_name": "SMA Negeri 1 Semarang",
  "regency_name": "Kota Semarang", "participants": 12, "total_points": 4820 }
```

**GET** `/leaderboard/voters` — peringkat voter/pendukung by skor (vote + quest).

```json
{ "position": 1, "voter_name": "Zahra Utami", "school_name": "",
  "votes": 23, "quests": 0, "score": 235 }
```

```bash
curl "$BASE/leaderboard/participants?limit=10" -H "X-Api-Key: $KEY"
curl "$BASE/leaderboard/schools?limit=10"      -H "X-Api-Key: $KEY"
curl "$BASE/leaderboard/voters?limit=10"       -H "X-Api-Key: $KEY"
```

---

## 5. Kupon Undian (by email)

**GET** `/coupons/by-email/{email}` — daftar kupon undian (hadiah HP) milik akun.

```json
{
  "email": "budi@sekolah.sch.id",
  "name": "Budi Santoso",
  "count": 1,
  "coupons": [
    { "code": "YCS-1472-9E10", "source": "follow", "prize": null,
      "created_at": "2026-07-03T23:18:35+07", "won": false, "won_at": null }
  ]
}
```

| Field | Keterangan |
|-------|-----------|
| `code` | kode kupon unik |
| `source` | asal kupon (mis. `follow`) |
| `won` | `true` bila kupon ini menang undian |
| `prize` / `won_at` | hadiah & waktu menang (bila `won`) |

Akun (email) tidak ditemukan → `404`.

```bash
curl "$BASE/coupons/by-email/budi@sekolah.sch.id" -H "X-Api-Key: $KEY"
```

---

## 6. Sekolah & Kabupaten (opsional — untuk data tanpa NPSN)

Biasanya **tak perlu** — cukup kirim `npsn` di sync peserta, kabupaten &
provinsi otomatis terisi. Pakai bagian ini kalau **sebagian data kalian tidak
punya NPSN** (atau NPSN-nya tidak ada di master kami), supaya kabupatennya
tetap terisi lewat `region_id` alih-alih kosong.

**GET** `/regions` — daftar kabupaten (`id` UUID, `name`, `code` BPS). Ambil
`id`-nya, simpan mapping di sisi kalian (mis. nama kabupaten → `region_id`),
lalu kirim `region_id` itu di `participants/sync` atau `POST /schools`.

```json
[
  { "id": "b3f1a2c0-1234-4a5b-8c9d-abcdef012345", "name": "Kota Semarang", "code": "3374", "level": "regency" }
]
```

**POST** `/schools` — upsert sekolah by nama (case-insensitive), set kabupaten
via `region_id` (disarankan) atau `region_code`:

```json
{ "name": "SMA Negeri 1 Semarang", "region_id": "b3f1a2c0-1234-4a5b-8c9d-abcdef012345" }
```

Respon: `{ "ok": true, "school": { ... } }`

> Peserta yang di-sync dengan `npsn` valid sudah otomatis punya kabupaten &
> provinsi — `region_id`/`region_code` diabaikan untuk peserta itu. Data
> wilayah ikut di respon peserta (`participant.school` → `kabupaten`, `provinsi`).
> `region_id`/`region_code` hanya dipakai sebagai fallback untuk sekolah yang
> **belum** punya kabupaten (baru dibuat, atau NPSN kosong/tak cocok) — sekali
> kabupaten terisi, kiriman berikutnya tidak akan menimpanya kecuali lewat NPSN valid.

---

## Contoh cepat (curl)

```bash
KEY=<API_KEY>
BASE=https://api-idola.stekom.ac.id/api/integrations

# 1. Sync peserta (create/update) by email — cukup NPSN, wilayah otomatis
curl -X POST $BASE/participants/sync \
  -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"email":"budi@sekolah.sch.id","name":"Budi","phone_number":"08123456789","npsn":"20325001"}'

# 1b. Sync peserta TANPA NPSN — kirim region_id (UUID kabupaten, dari GET /regions)
curl -X POST $BASE/participants/sync \
  -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"email":"dewi@sekolah.sch.id","name":"Dewi","phone_number":"08123456780","school_name":"SMK Negeri 2 Semarang","region_id":"b3f1a2c0-1234-4a5b-8c9d-abcdef012345"}'

# 2. Sync konten by email
curl -X PUT $BASE/participants/by-email/budi@sekolah.sch.id/contents \
  -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"contents":[{"kind":"engage","url":"https://instagram.com/p/x","label":"Reels"}]}'

# Verifikasi peserta + ambil link/statistik/peringkat
curl $BASE/participants/by-email/budi@sekolah.sch.id -H "X-Api-Key: $KEY"

# Lookup cepat by nama (spasi di-encode %20)
curl "$BASE/participants/by-name/Budi%20Santoso" -H "X-Api-Key: $KEY"

# Daftar kabupaten — ambil "id" (UUID) untuk dipakai sebagai region_id
curl $BASE/regions -H "X-Api-Key: $KEY"

# Upsert sekolah, set kabupaten via region_id
curl -X POST $BASE/schools \
  -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"name":"SMA Negeri 1 Semarang","region_id":"b3f1a2c0-1234-4a5b-8c9d-abcdef012345"}'
```

---

## Catatan penting

- **Kunci sync = `email`** peserta. Kirim ulang `email` sama = update. Kalian
  tak perlu simpan ID apa pun dari sini. Email juga menandai voter yang sama
  sebagai "Peserta" (tak bisa vote diri sendiri).
- Ganti apa saja (nama, nomor WA, sekolah, foto, status) cukup lewat
  **POST `/participants/sync`** — kirim ulang data lengkap dengan `email` sama.
- **Foto**: endpoint ini tidak menerima file. Upload foto ke storage kalian dulu, lalu kirim `photo_url`-nya.
- Sekolah auto-dibuat kalau belum ada; akun login peserta dibuat otomatis (login pakai nomor WA).
- Nomor WA & email harus unik antar peserta → `409` bila bentrok.
- API key salah/kurang → `401`. Data tidak valid → `400` (detail di field `message`).

---

## Legacy (opsional — kompatibilitas)

Endpoint lama yang masih jalan. **Tak perlu dipakai** kalau sudah pakai sync by email di atas.

- **POST** `/participants` — daftar/update by nomor WA.
- **PATCH** `/participants/id/{id}` — update by ID sistem ini (semua field opsional).
- **PATCH** `/participants/{phone}/phone` — ganti nomor WA saja (`{ "new_phone": "..." }`).
- **PUT** `/participants/{phone}/contents` — sync konten by nomor WA.
- **GET** `/participants/{phone}` — cek data by nomor WA.
