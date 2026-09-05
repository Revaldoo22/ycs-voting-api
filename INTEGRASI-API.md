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
> keduanya by `email`. Untuk web app kedua: tambah (7) Data Voter per Peserta
> dan (8) Tukar Poin & Spin Hadiah. Butuh daftar peserta yang sudah lolos atau
> Golden Buzzer: (9) Peserta yang Sudah Lolos. Endpoint di bagian *Legacy*
> hanya untuk kompatibilitas.

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

## 7. Data Voter per Peserta (untuk web app kedua)

**GET** `/participants/by-email/{email}/voters`

Daftar voter satu peserta buat ditampilkan di web app kedua: siapa saja yang
vote, jam berapa, dari sekolah mana. Satu baris per vote, terbaru dulu.

Pakai `X-Api-Key` yang sama seperti endpoint lain di dokumen ini.

> **Terkunci ke satu peserta.** Yang ditampilkan selalu voter milik peserta
> pemilik `{email}` di URL. Tidak ada cara meminta voter peserta lain lewat
> query, jadi aman dipakai halaman "voter saya" per peserta.
>
> **Kontak voter disamarkan.** Nomor WA & email voter sengaja tidak dikirim
> utuh (`0812*****89`, `za***@gmail.com`) karena halaman ini dilihat peserta,
> bukan panitia. Vote boost admin tidak pernah ikut.
>
> Karena itu `search` **tidak** mencari ke nomor WA/email. Kalau ikut dicari,
> penyamaran jadi sia-sia: kirim `search=081234567` lalu lihat `total`
> berubah, nomor utuh bisa ditebak satu per satu. Cari voter pakai nama.

| Query | Keterangan |
|-------|-----------|
| `from` / `to` | rentang tanggal `YYYY-MM-DD`, inklusif |
| `search` | cari nama voter atau sekolah voter. **Tidak** mencari nomor WA/email — lihat catatan di bawah. |
| `school` | filter sekolah voter, pencocokan sebagian |
| `sort` | `recent` (default) atau `oldest` |
| `limit` / `offset` | paging. Default 50, maksimal 200. |

Respon:

```json
{
  "participant": { "id": "03db696e-…", "name": "Oka Pratama" },
  "total": 114,
  "count": 2,
  "voters": [
    {
      "voted_at": "2026-07-03T23:18:35.000Z",
      "voter_name": "Zahra Utami",
      "voter_phone": "0812*****89",
      "voter_email": "za***@gmail.com",
      "voter_status": "siswa",
      "voter_school": "SMA Negeri 1 Semarang",
      "voter_class": "XII IPA 2",
      "voter_region": "Kota Semarang",
      "points": 1,
      "status": "approved"
    }
  ]
}
```

| Field | Keterangan |
|-------|-----------|
| `participant.id` / `participant.name` | peserta pemilik daftar ini (dari `{email}`) |
| `total` | total voter peserta ini sesuai filter, untuk paging |
| `count` | jumlah baris di respon ini |
| `voted_at` | waktu vote masuk (jam), ISO 8601 |
| `voter_phone` / `voter_email` | **disamarkan**, bukan nilai asli. Jangan dipakai untuk menghubungi atau mencocokkan data. |
| `voter_status` | status voter (mis. `siswa`, `umum`). Bisa `null`. |
| `voter_class` | kelas voter, bisa `null` |
| `points` | poin dari vote ini |
| `voter_school` | dari data saat vote; kalau kosong diambil dari profil voter |
| `voter_region` | kabupaten/kota voter |
| `status` | `pending` = bukti follow belum direview admin, poin belum masuk |

Peserta (email) tidak ditemukan → `404`.

```bash
# Halaman pertama
curl "$BASE/participants/by-email/budi@sekolah.sch.id/voters?limit=20" -H "X-Api-Key: $KEY"

# Halaman berikutnya: offset += limit, berhenti kalau offset >= total
curl "$BASE/participants/by-email/budi@sekolah.sch.id/voters?limit=20&offset=20" -H "X-Api-Key: $KEY"

# Voter bulan Juli saja, urut terlama
curl "$BASE/participants/by-email/budi@sekolah.sch.id/voters?from=2026-07-01&to=2026-07-31&sort=oldest" -H "X-Api-Key: $KEY"
```

> Satu baris = satu vote. Untuk halaman "voter saya", pakai `total` sebagai
> jumlah pendukung sesuai filter, bukan `count` (itu jumlah baris di halaman ini).

---

## 8. Tukar Poin & Spin Hadiah (untuk web app kedua)

UI penukaran dan roda spin dibangun di web app kedua. Bagian ini hanya
menyediakan datanya: katalog, hadiah, saldo, dan aturan mainnya.

Semua endpoint di bawah berawalan `/rewards` dan pakai `X-Api-Key` yang sama.

### Cara poin dihitung (baca ini dulu)

**1 vote masuk = 1 poin.** Poin peserta dihitung dari jumlah vote yang
`approved` (vote bot tidak dihitung).

> **Menukar poin TIDAK mengurangi jumlah vote.** Vote adalah dasar peringkat
> lomba, jadi tidak pernah disentuh. Yang dicatat adalah "poin terpakai",
> lalu saldo yang bisa dibelanjakan = poin dari vote - poin terpakai.
> Peringkat peserta di bagian 3 & 4 tidak akan berubah walau dia menukar
> semua poinnya.

**Kunci** adalah syarat **terpisah** dari poin. "2.000 poin (18 kunci)"
berarti butuh dua-duanya. Kunci hanya didapat dari spin.

### 8.1 Aturan main spin (WAJIB dibaca sebelum bikin UI)

Roda ini **bukan undian acak biasa**. Ada tiga jalur hadiah yang berbeda, dan
UI harus mengikuti hasil dari server, bukan mengarang sendiri.

**a. Harga spin bertingkat.** Spin pertama tiap akun lebih murah (3 poin),
setelah itu harga normal (10 poin). Diskon berlaku sekali seumur akun. Karena
harganya berbeda per akun, **tanyakan dulu ke `/rewards/spin-price/{email}`**
sebelum menampilkan harga.

**b. Kunci pasti didapat, tapi entah di spin ke berapa.** Tiap akun ditentukan
satu titik acak antara spin ke-1 sampai ke-5. Begitu sampai di titik itu, dia
dapat Kunci tanpa perlu beruntung. Titik ini ditentukan sekali saat akun
pertama kali spin lalu tidak pernah berubah.

> Jangan tampilkan titik ini di UI, dan jangan pula minta lewat API. Kalau
> peserta tahu "nanti dapat Kunci di spin ke-3", polanya bisa dibocorkan ke
> peserta lain dan kejutannya hilang.

Kunci dibatasi **41 orang** dan **1 per akun**. Kalau seorang peserta sampai
di titiknya tapi jatah 41 orang sudah habis, dia **tidak** dapat Kunci dan
hasilnya jadi 💨 biasa.

**c. Sebagian hadiah punya ambang, dan ambang itu MENAHAN.** Tumbler diberikan
begitu akun mencapai **100 poin ATAU sudah spin 10 kali**, mana yang lebih
dulu. Sebelum ambang itu tercapai, Tumbler **tidak ikut diundi sama sekali**,
jadi peserta tidak bisa mendapatkannya lebih awal walau beruntung.

Karena itu `chance` Tumbler hanya berlaku setelah ambangnya lewat. Jangan
menampilkan peluangnya sebagai sesuatu yang berlaku sejak spin pertama.

**Satu akun hanya boleh menerima SATU BARANG seumur hidup.** Peserta yang
sudah dapat Tumbler tidak bisa dapat Kaos juga, bukan sekadar tidak bisa
Tumbler lagi. Begitu sudah punya satu barang, hasil spin berikutnya selalu
💨 kecuali Kunci.

Dua pengecualian: **💨** karena bukan barang, dan **Kunci** karena itu alat
tukar untuk menebus hadiah, bukan barang yang dikirim ke peserta.

> Ini penting untuk kalimat di UI. Jangan menulis "kumpulkan semua hadiah",
> karena satu peserta memang hanya bisa membawa pulang satu barang.

**d. Grand Prize terkunci.** E-Money, Handphone, dan Sepeda Listrik bukan
berpeluang kecil, tapi **dikunci**: selama `is_locked: true`, tidak ada satu
pun peserta yang bisa mendapatkannya lewat jalur apa pun, termasuk jalur
otomatis, jaminan, dan mode hadiah pasti. Tetap boleh digambar di roda sebagai
pemanis, tapi jangan menjanjikannya ke peserta.

> Kunci berbeda dari `active: false`. Nonaktif hanya mengeluarkan hadiah dari
> undian acak, sedangkan jalur otomatis dan jaminan tidak melihat `active`.
> Kunci menutup semuanya, jadi itulah penanda yang harus dipercaya.


> Data hadiah masih memuat **VIP Ticket Bali** dari konfigurasi lama, juga
> terkunci. Kalau tidak lagi dipakai, minta panitia menghapusnya lewat admin
> supaya isi `GET /rewards/prizes?all=1` sama dengan pengumuman ke peserta.

**e. 💨 adalah hasil cadangan.** Muncul kalau peserta tidak dapat apa-apa,
baik karena belum beruntung maupun karena jatah hadiahnya sudah habis.
Jumlahnya tidak terbatas.

### Ringkasan semua hadiah

| Hadiah | Sifat | Cara didapat | Jatah |
|--------|-------|--------------|-------|
| 💨 **Dash** | default / cadangan | muncul kalau tidak dapat hadiah lain | tidak terbatas |
| 🔑 **Kunci** | pasti didapat | titik acak antara spin 1-5, per akun | 41 orang, maks 1/akun |
| 🥤 **Tumbler Eksklusif** | acak / otomatis | 1:300 di roda, atau otomatis saat 100 poin / 10x spin | 8 orang, maks 1/akun |
| 👕 **Kaos Eksklusif Toploker** | acak | 1:300 di roda | 6 orang, maks 1/akun |
| 🏆 **Grand Prize** | mati secara default | hanya aktif kalau admin menyalakannya manual | diatur admin |

**Isi Grand Prize:** E-Money, Handphone, Sepeda Listrik.

> Angka di tabel ini adalah **nilai bawaan**, bukan janji permanen. Admin bisa
> mengubah jatah, ambang otomatis, dan status aktif kapan saja, jadi baca
> `GET /rewards/prizes` untuk nilai yang sedang berlaku. Tabel ini untuk
> memahami cara mainnya, bukan untuk di-hardcode.

### 8.2 Katalog penukaran

**GET** `/rewards/catalog` - daftar item yang bisa ditukar (hanya yang aktif).

```json
[
  { "id": "...", "code": "hp_baru", "name": "HP Baru", "description": null,
    "point_cost": 2000, "key_cost": 18, "kind": "item", "spin_grant": 0,
    "stock": null, "active": true, "sort_order": 1 }
]
```

| Field | Keterangan |
|-------|-----------|
| `code` | kode stabil, dipakai saat `POST /rewards/redeem` |
| `point_cost` / `key_cost` | biaya poin dan kunci. Dua-duanya harus terpenuhi. |
| `kind` | `item` = barang fisik, `spin` = menambah jatah spin gratis |
| `spin_grant` | jumlah spin gratis yang diberikan (hanya untuk `kind: "spin"`) |
| `stock` | sisa stok, `null` = tidak dibatasi |

Isi bawaan event: HP Baru (2.000 poin + 18 kunci), E-Money 500rb (750 + 10),
Tumbler Stainless (100 + 3), dan 1x Spin Gratis (10 poin, tanpa kunci).
Nilainya bisa diubah admin sewaktu-waktu, jadi **jangan di-hardcode** di web
kalian - baca dari endpoint ini.

### 8.3 Saldo akun

**GET** `/rewards/balance/{email}`

```json
{
  "email": "budi@sekolah.sch.id", "name": "Budi Santoso",
  "points_earned": 2500, "points_spent": 60, "points_available": 2440,
  "keys_earned": 1, "keys_spent": 0, "keys_available": 1,
  "spins_available": 0
}
```

| Field | Keterangan |
|-------|-----------|
| `points_earned` | poin dari vote (= jumlah vote approved). Tidak pernah turun. |
| `points_spent` | poin yang sudah dipakai menukar / membeli spin |
| `points_available` | **sisa yang bisa dibelanjakan** - pakai angka ini di UI |
| `keys_available` | sisa kunci |
| `spins_available` | jatah spin gratis yang belum dipakai |

Email yang tidak dikenal tidak error, tapi mengembalikan saldo `0` semua.

### 8.4 Tukar poin

**POST** `/rewards/redeem`

```json
{ "email": "budi@sekolah.sch.id", "code": "tumbler_stainless", "note": "opsional" }
```

Respon berisi catatan penukaran + **saldo terbaru** (tak perlu panggil
`/balance` lagi):

```json
{
  "ok": true,
  "redemption": { "id": "...", "reward_code": "tumbler_stainless",
    "reward_name": "Tumbler Stainless", "point_cost": 100, "key_cost": 3,
    "spin_grant": 0, "status": "pending", "created_at": "2026-08-22T09:10:27+07" },
  "balance": { "points_available": 2340, "keys_available": 0, "...": "..." }
}
```

`status` penukaran: `pending` (menunggu diserahkan panitia) lalu `done`.
Panitia bisa membatalkan (`canceled`); poin & kunci otomatis kembali.

Kalau gagal:

| Kondisi | Kode | Pesan |
|---------|------|-------|
| Poin kurang | `400` | `Poin tidak cukup. Butuh 2000, tersedia 1500.` |
| Kunci kurang | `400` | `Kunci tidak cukup. Butuh 18, tersedia 3.` |
| Stok habis | `409` | `Stok hadiah sudah habis.` |
| Item nonaktif | `400` | `Item ini sedang tidak tersedia.` |
| Kode tak dikenal | `404` | `Item katalog tidak ditemukan.` |

**GET** `/rewards/redemptions/{email}` - riwayat penukaran, terbaru dulu.

### 8.5 Hadiah spin

**GET** `/rewards/prizes` - hadiah yang aktif, untuk digambar di roda.

**GET** `/rewards/prizes?all=1` - **seluruh** hadiah termasuk yang nonaktif.
Pakai ini kalau kalian mau menampilkan daftar lengkap hadiah (termasuk Grand
Prize yang terkunci) sebagai informasi, bukan sebagai isi roda. Bedakan lewat
field `is_locked`: yang `true` **tidak akan pernah keluar** lewat jalur apa
pun, jadi jangan dijanjikan bisa didapat.

> **Hadiah terkunci ikut di `GET /rewards/prizes` biasa** (tanpa `?all=1`),
> walau `active`-nya `false`. Itu memang disengaja: hadiah utama tetap
> tergambar di roda sebagai pemikat, sementara `chance`-nya `0` dan tidak
> ada yang bisa mendapatkannya. Jadi **jangan menyaring roda pakai `active`**,
> nanti hadiah terkunci hilang dari gambar. Kalau kalian mau menyembunyikan
> sebuah hadiah dari roda, minta panitia menonaktifkannya TANPA mengunci.

```json
[
  { "code": "kunci_1", "label": "1 Kunci", "weight": 0, "chance": 0,
    "is_empty": false, "key_grant": 1, "stock": null,
    "winner_quota": 41, "max_per_account": 1,
    "is_guaranteed": true, "guarantee_min_spin": 1, "guarantee_max_spin": 5,
    "auto_at_points": null, "auto_at_spins": null,
    "color": null, "active": true, "is_locked": false, "sort_order": 5 },
  { "code": "tumbler", "label": "Tumbler", "weight": 1, "chance": 0.17,
    "is_empty": false, "key_grant": 0, "stock": null,
    "winner_quota": 8, "max_per_account": 1,
    "is_guaranteed": false, "guarantee_min_spin": 1, "guarantee_max_spin": 5,
    "auto_at_points": 100, "auto_at_spins": 10,
    "color": null, "active": true, "is_locked": false, "sort_order": 6 }
]
```

| Field | Keterangan |
|-------|-----------|
| `chance` | peluang **di undian acak saja**, dalam persen. Lihat catatan di bawah. |
| `is_guaranteed` | `true` = hadiah pasti (Kunci), tidak lewat undian |
| `winner_quota` | batas jumlah **orang** yang boleh menang, bukan jumlah barang |
| `max_per_account` | maksimal berapa kali satu akun boleh dapat hadiah ini |
| `auto_at_points` / `auto_at_spins` | ambang. Sebelum tercapai hadiah **tidak ikut diundi**; begitu tercapai, langsung diberikan. `null` = tidak ada ambang. |
| `is_empty` | `true` untuk 💨 - tampilkan "belum beruntung" |
| `key_grant` | kunci yang didapat kalau mendarat di sini |
| `stock` | sisa barang; yang habis otomatis tidak keluar lagi |
| `is_locked` | `true` = **dijamin tidak bisa didapat** siapa pun, lewat jalur apa pun |

> **`chance` tidak berjumlah 100.** Angka ini hanya menggambarkan undian acak.
> Hadiah berjaminan (`is_guaranteed: true`), hadiah terkunci, dan hadiah
> nonaktif bernilai `0`
> karena tidak ikut diundi, padahal Kunci justru **pasti** didapat. Jadi
> jangan menampilkan `chance` Kunci sebagai "peluang 0%" ke peserta, itu
> menyesatkan.

> Pemenang **ditentukan server**, bukan animasi di web kalian. Panggil
> `POST /rewards/spin` dulu, baru putar animasi roda supaya berhenti di
> hadiah yang dikembalikan. Jangan mengundi sendiri di sisi klien.

### 8.6 Harga spin per akun

**GET** `/rewards/spin-price/{email}`

Karena spin pertama tiap akun didiskon, harga berbeda antar akun. Panggil ini
sebelum menampilkan tombol spin.

```json
{
  "email": "budi@sekolah.sch.id",
  "next_spin_cost": 3,
  "is_first_spin": true,
  "first_spin_cost": 3,
  "normal_cost": 10
}
```

| Field | Keterangan |
|-------|-----------|
| `next_spin_cost` | **harga yang harus ditampilkan** untuk spin berikutnya |
| `is_first_spin` | `true` = akun ini belum pernah spin, jadi masih dapat diskon |

### 8.7 Pilihan spin

**GET** `/rewards/spin-options`

```json
{
  "spin_enabled": true,
  "spin_point_cost": 10,
  "spin_first_cost": 3,
  "options": [
    { "code": "single", "label": "1x Spin", "spins": 1, "bonus": 0, "point_cost": 10 },
    { "code": "bundle", "label": "5x Spin + 1 Bonus", "spins": 5, "bonus": 1, "point_cost": 50 }
  ]
}
```

Jumlah spin, bonus, dan harganya diatur admin - **baca dari endpoint ini**,
jangan di-hardcode. Kalau paket dimatikan admin, `options` hanya berisi
`single`.

> **`spin_enabled: false` wajib dihormati:** sembunyikan rodanya dan tampilkan
> pesan spin sedang ditutup. Kalau tetap dipanggil, `POST /rewards/spin`
> menolak dengan pesan "Roda spin sedang ditutup panitia." Panitia memakai ini
> saat hadiah belum siap.

> `point_cost` pada paket **belum memperhitungkan diskon spin pertama**: paket
> selalu dihitung dengan harga normal. Diskon hanya berlaku untuk spin satuan.
> Untuk harga sebenarnya yang akan ditagih, lihat `points_charged` di respon
> spin.

### 8.8 Putar roda

**POST** `/rewards/spin`

```json
{ "email": "budi@sekolah.sch.id", "option": "bundle" }
```

`option`: `single` (default) atau `bundle`.

```json
{
  "ok": true, "batch_id": "...", "option": "bundle",
  "spins_paid": 5, "spins_bonus": 1,
  "free_spins_used": 0, "points_charged": 50,
  "first_spin_discount": false,
  "results": [
    { "prize_code": "kunci_1", "prize_label": "1 Kunci", "is_empty": false,
      "key_grant": 1, "is_bonus": false, "source": "guaranteed" },
    { "prize_code": "tumbler", "prize_label": "Tumbler", "is_empty": false,
      "key_grant": 0, "is_bonus": false, "source": "auto" },
    { "prize_code": "zonk", "prize_label": "💨", "is_empty": true,
      "key_grant": 0, "is_bonus": true, "source": "random" }
  ],
  "balance": { "points_available": 2440, "keys_available": 1, "...": "..." }
}
```

| Field | Keterangan |
|-------|-----------|
| `results` | satu baris per putaran, **urut**. Paket 5x+1 menghasilkan 6 baris. |
| `source` | asal hadiah: `targeted` (ditetapkan panitia untuk akun itu), `guaranteed` (titik Kunci), `auto` (ambang tercapai), `random` (menang undian) |
| `is_bonus` | `true` untuk putaran bonus (gratis, tidak menagih poin) |
| `free_spins_used` | jatah gratis yang terpakai; **dipakai lebih dulu** sebelum poin |
| `points_charged` | poin yang benar-benar ditagih, sudah termasuk diskon |
| `first_spin_discount` | `true` kalau diskon spin pertama terpakai di panggilan ini |
| `batch_id` | penanda satu sesi; semua baris dari satu panggilan punya nilai sama |

> `source` berguna untuk memilih kalimat di UI. `targeted`, `guaranteed`, dan
> `auto` bukan hasil keberuntungan, jadi lebih pas ditulis "Kamu dapat Kunci!"
> daripada "Selamat, kamu beruntung!".

**f. Panitia bisa menetapkan hadiah untuk akun tertentu.** Dipakai saat
pemenang sudah ditentukan di luar sistem, mis. hadiah panggung. Hasilnya
datang lewat `POST /rewards/spin` seperti biasa dengan `source: "targeted"`,
jadi web kedua tidak perlu menyiapkan apa pun. Hadiah terkunci tetap tidak
bisa ditetapkan.

> **Setiap panggilan tercatat di sisi kami** beserta poin yang ditagih dan
> hadiah yang keluar, dan bisa dilihat panitia di menu Log Spin. Jadi kalau
> ada peserta protes "sudah bayar poin tapi tidak dapat apa-apa", panitia
> bisa menelusurinya sendiri tanpa meminta log dari kalian. Kirim `email`
> yang benar supaya baris lognya bisa ditautkan ke orangnya.

Poin kurang menghasilkan `400` dengan pesan jumlah yang dibutuhkan. Belum ada
hadiah aktif juga `400`.

**GET** `/rewards/spins/{email}?limit=50` - riwayat spin, terbaru dulu
(maks 200).

```bash
# Katalog, hadiah, dan pilihan spin (untuk menggambar UI)
curl $BASE/rewards/catalog      -H "X-Api-Key: $KEY"
curl $BASE/rewards/prizes       -H "X-Api-Key: $KEY"
curl "$BASE/rewards/prizes?all=1" -H "X-Api-Key: $KEY"   # + hadiah nonaktif
curl $BASE/rewards/spin-options -H "X-Api-Key: $KEY"

# Saldo + harga spin akun ini
curl $BASE/rewards/balance/budi@sekolah.sch.id    -H "X-Api-Key: $KEY"
curl $BASE/rewards/spin-price/budi@sekolah.sch.id -H "X-Api-Key: $KEY"

# Tukar poin
curl -X POST $BASE/rewards/redeem \
  -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"email":"budi@sekolah.sch.id","code":"tumbler_stainless"}'

# Putar roda 5x + 1 bonus
curl -X POST $BASE/rewards/spin \
  -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"email":"budi@sekolah.sch.id","option":"bundle"}'
```

---

## 9. Peserta yang Sudah Lolos / Golden Buzzer

**GET** `/winners`

Satu pintu untuk mengambil peserta yang sudah **aman** — tidak lagi ikut adu
voting. Ada dua jalur ke sana:

- **Golden Buzzer** — dipilih langsung panitia, tanpa menunggu hasil gelombang.
- **Lolos gelombang** — masuk peringkat teratas saat gelombang ditutup.

Keduanya berhenti menerima vote, jadi kalau kalian menampilkan tombol dukung
di web pendaftaran, matikan untuk peserta yang muncul di sini.

| Query | Keterangan |
|-------|-----------|
| `source` | `all` (default) = Golden Buzzer + semua yang lolos, `golden_buzzer` = hanya Golden Buzzer, `round` = hanya yang lolos gelombang |
| `round` | Filter satu gelombang. Terima **nama** (`Grup A`, tidak peka huruf besar-kecil) atau UUID. Kosong = semua gelombang. |

```json
{
  "count": 2,
  "winners": [
    {
      "via": "golden_buzzer",
      "participant_id": "03db696e-4c7f-4013-8b89-3a40641142b2",
      "participant_name": "Oka Pratama",
      "photo_url": "https://cdn/foto.jpg",
      "description": null,
      "school_id": "…", "school_name": "SMA Negeri 3 Semarang",
      "region_name": "Kota Semarang", "province_name": "Jawa Tengah",
      "round_id": null, "round_name": null, "sequence": null,
      "points": 885,
      "decided_at": "2026-08-27T10:15:00.000Z"
    },
    {
      "via": "round",
      "participant_id": "a1b2c3d4-…",
      "participant_name": "Falsa Syabana",
      "photo_url": null,
      "description": null,
      "school_id": "…", "school_name": "SMAN 2 Purworejo",
      "region_name": "Kab. Purworejo", "province_name": "Jawa Tengah",
      "round_id": "…", "round_name": "Grup A", "sequence": 1,
      "points": 92,
      "decided_at": "2026-08-31T16:59:59.000Z"
    }
  ]
}
```

| Field | Keterangan |
|-------|-----------|
| `via` | `golden_buzzer` atau `round` — **jalur** peserta itu jadi aman |
| `round_id` / `round_name` / `sequence` | gelombang tempat dia lolos. **`null` untuk Golden Buzzer** karena dia lepas dari gelombang. |
| `points` | poin akhir. Untuk `round` = poin bawaan + vote di gelombang itu; untuk `golden_buzzer` = total poin peserta. |
| `decided_at` | kapan status itu ditetapkan: waktu ditandai Golden Buzzer, atau waktu gelombang ditutup. Bisa `null` kalau gelombangnya belum ditutup. |

> **Satu peserta hanya bisa lolos sekali.** Yang sudah lolos tidak ikut
> gelombang berikutnya, jadi tidak akan muncul dua kali di respon ini.

> Urutannya: Golden Buzzer dulu (karena `sequence` null), lalu peserta lolos
> diurutkan per gelombang, di dalam gelombang diurut poin tertinggi.

```bash
# Semua yang sudah aman
curl "$BASE/winners" -H "X-Api-Key: $KEY"

# Hanya Golden Buzzer
curl "$BASE/winners?source=golden_buzzer" -H "X-Api-Key: $KEY"

# Hanya yang lolos gelombang (semua gelombang)
curl "$BASE/winners?source=round" -H "X-Api-Key: $KEY"

# Yang lolos Grup A saja (spasi di-encode %20)
curl "$BASE/winners?round=Grup%20A" -H "X-Api-Key: $KEY"
curl "$BASE/winners?round=Grup%20B" -H "X-Api-Key: $KEY"
curl "$BASE/winners?round=Grup%20C" -H "X-Api-Key: $KEY"
```

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

# Daftar voter satu peserta (untuk web app kedua)
curl "$BASE/participants/by-email/budi@sekolah.sch.id/voters?limit=20" -H "X-Api-Key: $KEY"

# Peserta yang sudah aman (Golden Buzzer + lolos gelombang)
curl "$BASE/winners" -H "X-Api-Key: $KEY"
curl "$BASE/winners?source=golden_buzzer" -H "X-Api-Key: $KEY"
curl "$BASE/winners?round=Grup%20A" -H "X-Api-Key: $KEY"

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
- **Data voter** (bagian 7) selalu terkunci ke peserta pemilik `{email}` dan
  kontaknya disamarkan. Kalau web app kedua butuh kontak voter utuh (mis. untuk
  panitia, bukan peserta), minta endpoint terpisah — jangan pakai yang ini.
- **Tukar poin & spin** (bagian 8): poin = jumlah vote approved (1 vote =
  1 poin), dan **menukar poin tidak mengurangi vote** — peringkat peserta
  aman. Harga, hadiah, dan pilihan spin diatur admin, jadi baca dari endpoint
  (`/rewards/catalog`, `/rewards/prizes`, `/rewards/spin-options`), jangan
  di-hardcode. Pemenang spin ditentukan server, animasi roda hanya mengikuti.
- **Spin bukan undian acak biasa** (bagian 8.1): Kunci pasti didapat di titik
  acak spin ke-1..5 dan dibatasi 41 orang, Tumbler bisa diberikan otomatis saat
  100 poin / 10x spin, dan Grand Prize mati sampai admin menyalakannya. Harga
  spin pertama tiap akun juga lebih murah, jadi tanyakan
  `/rewards/spin-price/{email}` sebelum menampilkan harga.
- **Peserta yang sudah lolos / Golden Buzzer** (bagian 9): mereka berhenti
  menerima vote, jadi matikan tombol dukung untuk peserta yang muncul di
  `GET /winners`. Kolom `via` memberi tahu jalurnya, dan Golden Buzzer selalu
  ber-`round_id` null karena lepas dari gelombang.
- API key salah/kurang → `401`. Data tidak valid → `400` (detail di field `message`).

---

## Legacy (opsional — kompatibilitas)

Endpoint lama yang masih jalan. **Tak perlu dipakai** kalau sudah pakai sync by email di atas.

- **POST** `/participants` — daftar/update by nomor WA.
- **PATCH** `/participants/id/{id}` — update by ID sistem ini (semua field opsional).
- **PATCH** `/participants/{phone}/phone` — ganti nomor WA saja (`{ "new_phone": "..." }`).
- **PUT** `/participants/{phone}/contents` — sync konten by nomor WA.
- **GET** `/participants/{phone}` — cek data by nomor WA.
