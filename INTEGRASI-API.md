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

## 3. Sekolah & Kabupaten

**GET** `/regions` — daftar kabupaten (id, name, code BPS, province). Pakai
`code` untuk memetakan sekolah ke kabupaten.

**POST** `/schools` — upsert sekolah by nama (case-insensitive):

```json
{ "name": "SMA Negeri 1 Semarang", "region_code": "3374" }
```

Respon: `{ "ok": true, "school": { ... } }`

> Sekolah juga otomatis dibuat saat sync peserta — endpoint ini berguna kalau
> web pendaftaran mengelola master sekolah secara terpisah.

---

## Contoh cepat (curl)

```bash
KEY=<API_KEY>
BASE=https://api-idola.stekom.ac.id/api/integrations

# 1. Sync peserta (create/update) by email
curl -X POST $BASE/participants/sync \
  -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"email":"budi@sekolah.sch.id","name":"Budi","phone_number":"08123456789","school_name":"SMA 1 Semarang","region_code":"3374"}'

# 2. Sync konten by email
curl -X PUT $BASE/participants/by-email/budi@sekolah.sch.id/contents \
  -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"contents":[{"kind":"engage","url":"https://instagram.com/p/x","label":"Reels"}]}'

# Verifikasi peserta
curl $BASE/participants/by-email/budi@sekolah.sch.id -H "X-Api-Key: $KEY"

# Daftar kabupaten
curl $BASE/regions -H "X-Api-Key: $KEY"

# Upsert sekolah
curl -X POST $BASE/schools \
  -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"name":"SMA Negeri 1 Semarang","region_code":"3374"}'
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
