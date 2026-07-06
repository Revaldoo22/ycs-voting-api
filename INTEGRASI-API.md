# API Integrasi — Web Pendaftaran → YCS

Dokumen singkat buat tim web pendaftaran. Semua endpoint server-ke-server.

**Arsitektur:** web pendaftaran = **sumber data (master)**. Sistem YCS ini =
**replika**. Kalian distribusikan data ke sini; kunci sinkronnya **`email`**
peserta. Kirim ulang `email` yang sama = update, bukan dobel — kalian tidak
perlu menyimpan ID apa pun dari sini.

> **Email juga jadi dasar pencocokan voter:** kalau ada voter yang login SSO
> Google dengan email sama seperti peserta, dia otomatis ditandai **"Peserta"**
> dan **tidak bisa vote dirinya sendiri**.

> **Pakai endpoint no. 1 (Sync by email) sebagai jalur utama.** Endpoint
> lain (by nomor WA / by ID) hanya alternatif/legacy.

## Auth (wajib tiap request)

Kirim 2 header ini:

```
X-Api-Key: <API_KEY_YANG_DIBERIKAN>
Content-Type: application/json
```

Base URL: `https://<domain-api>/api/integrations`

---

## 1. Sync Peserta (utama — by email)

**POST** `/participants/sync`

Kirim data peserta + `email` (kunci). Create kalau baru, update kalau `email`
sudah pernah dikirim. Nomor WA & sekolah ikut disinkron.

Body:

```json
{
  "email": "budi@sekolah.sch.id",
  "name": "Budi Santoso",
  "phone_number": "08123456789",
  "school_name": "SMA Negeri 1 Semarang",
  "region_code": "3374",
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
| `school_name` | ✅ | sekolah auto-dibuat kalau belum ada |
| `region_code` | — | kode BPS kabupaten |
| `external_id` | — | ID kalian (disimpan, opsional) |
| `description` / `photo_url` / `status` | — | opsional |

Respon: `{ "created": true|false, "participant": { ... } }`

Verifikasi: **GET** `/participants/by-email/{email}`.

> Ganti nama, nomor WA, sekolah, foto, status — semua cukup lewat endpoint ini
> (kirim ulang dengan `email` sama). Nomor/email dicek unik → `409` bila bentrok.

---

## 2. (Legacy) Daftar / Update Peserta by nomor WA

**POST** `/participants`

Idempoten by **nomor WA** → kirim ulang nomor sama = update, bukan bikin baru.

Body:

```json
{
  "name": "Budi Santoso",
  "phone_number": "08123456789",
  "school_name": "SMA Negeri 1 Semarang",
  "region_code": "3374",
  "description": "Deskripsi singkat (opsional)",
  "photo_url": "https://cdn-kalian.com/foto/budi.jpg",
  "status": "active"
}
```

| Field | Wajib | Keterangan |
|-------|-------|-----------|
| `name` | ✅ | 2–100 karakter |
| `phone_number` | ✅ | 8–20 digit, nomor WA (kunci idempoten) |
| `school_name` | ✅ | 2–150. Sekolah otomatis dibuat kalau belum ada |
| `region_code` | — | Kode BPS kabupaten (biar sekolah baru langsung terpetakan) |
| `description` | — | maks 1000 karakter |
| `photo_url` | — | URL foto (harus sudah di-upload di sisi kalian, lihat catatan) |
| `status` | — | `active` / `inactive` (default `active`) |

Respon:

```json
{ "created": true, "participant": { "id": "...", "name": "...", ... } }
```

`created: true` = peserta baru, `false` = update.

> Simpan `participant.id` dari respon. Untuk update selanjutnya, pakai
> **endpoint no. 2 (update by ID)** — lebih andal, nomor WA pun bisa ikut diganti.

---

## 3. (Legacy) Update Peserta by ID sistem ini

**PATCH** `/participants/id/{id}`

`{id}` = `participant.id` yang kalian simpan dari respon daftar. **Semua field
opsional** — kirim hanya yang berubah. Nomor WA pun bisa diganti di sini.

Body (contoh ganti beberapa field sekaligus):

```json
{
  "name": "Nama Baru",
  "phone_number": "08990002222",
  "school_name": "SMA Negeri 2 Semarang",
  "region_code": "3374",
  "description": "...",
  "photo_url": "https://cdn-kalian.com/foto/baru.jpg",
  "status": "inactive"
}
```

Respon: `{ "ok": true, "participant": { ... } }`

> Kalau `phone_number` baru sudah dipakai akun lain → respon `409`.

**Ini cara sync utama**: saat peserta diedit di dashboard web kedua, kirim
PATCH ini → semua data ikut ter-update di sini.

### Alternatif: ganti nomor WA saja

**PATCH** `/participants/{phone}/phone` — body `{ "new_phone": "..." }`.
Berguna kalau kalian identifikasi by nomor lama, bukan by ID.

---

## 4. Sekolah & Kabupaten

**GET** `/regions` — daftar kabupaten (id, name, code BPS, province). Pakai
`code` untuk memetakan sekolah ke kabupaten.

**POST** `/schools` — upsert sekolah by nama (case-insensitive):

```json
{ "name": "SMA Negeri 1 Semarang", "region_code": "3374" }
```

Respon: `{ "ok": true, "school": { ... } }`

> Sekolah juga otomatis dibuat saat daftar/update peserta — endpoint ini
> berguna kalau web kedua mengelola master sekolah secara terpisah.

---

## 5. Sync Konten Peserta

**PUT** `/participants/{phone}/contents`

Ganti **seluruh** daftar konten peserta (full-replace). `{phone}` = nomor WA peserta.

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

## 6. Cek Data Peserta by nomor WA (opsional)

**GET** `/participants/{phone}`

Respon: `{ "participant": {...}, "contents": [...] }`

---

## Contoh cepat (curl)

```bash
# UTAMA: sync peserta by email (create/update)
curl -X POST https://<domain-api>/api/integrations/participants/sync \
  -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"email":"budi@sekolah.sch.id","name":"Budi","phone_number":"08123456789","school_name":"SMA 1 Semarang","region_code":"3374"}'

# Verifikasi
curl https://<domain-api>/api/integrations/participants/by-email/budi@sekolah.sch.id -H "X-Api-Key: $KEY"

# Daftar kabupaten
curl https://<domain-api>/api/integrations/regions -H "X-Api-Key: $KEY"

# Upsert sekolah
curl -X POST https://<domain-api>/api/integrations/schools \
  -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"name":"SMA Negeri 1 Semarang","region_code":"3374"}'

# Sync konten
curl -X PUT https://<domain-api>/api/integrations/participants/08123456789/contents \
  -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"contents":[{"kind":"engage","url":"https://instagram.com/p/x","label":"Reels"}]}'
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
- Nomor WA tetap harus unik antar peserta → `409` bila bentrok.
- API key salah/kurang → `401`. Data tidak valid → `400` (detail di field `message`).
