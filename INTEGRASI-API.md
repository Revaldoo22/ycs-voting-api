# API Integrasi — Web Pendaftaran → YCS

Dokumen singkat buat tim web pendaftaran. Semua endpoint server-ke-server.

## Auth (wajib tiap request)

Kirim 2 header ini:

```
X-Api-Key: <API_KEY_YANG_DIBERIKAN>
Content-Type: application/json
```

Base URL: `https://<domain-api>/api/integrations`

---

## 1. Daftar / Update Peserta

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

## 2. Update Peserta by ID (dipakai dashboard web kedua)

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

## 3. Sekolah & Kabupaten

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

## 4. Sync Konten Peserta

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

## 5. Cek Data Peserta (opsional, buat verifikasi)

**GET** `/participants/{phone}`

Respon: `{ "participant": {...}, "contents": [...] }`

---

## Contoh cepat (curl)

```bash
# Daftar/update peserta
curl -X POST https://<domain-api>/api/integrations/participants \
  -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"name":"Budi","phone_number":"08123456789","school_name":"SMA 1 Semarang","region_code":"3374"}'

# Update peserta by ID (cara sync utama dari dashboard web kedua)
curl -X PATCH https://<domain-api>/api/integrations/participants/id/<PARTICIPANT_ID> \
  -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"name":"Nama Baru","phone_number":"08129999999","status":"inactive"}'

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

- **Idempoten by nomor WA** — aman kirim ulang, tidak dobel.
- **Foto**: endpoint ini tidak menerima file. Upload foto ke storage kalian dulu, lalu kirim `photo_url`-nya.
- Daftar peserta otomatis: buat sekolah kalau belum ada + buatkan akun login peserta (login pakai nomor WA).
- Kalau API key salah/kurang → respon `401`.
- Kalau data tidak valid → respon `400` (pesan error ada di field `message`).
