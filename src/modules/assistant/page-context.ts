/**
 * Penjelasan tiap halaman admin, dipakai sebagai konteks untuk asisten.
 *
 * Ditaruh di server, bukan dikirim dari klien, karena dua alasan: klien bisa
 * memalsukan konteks untuk memancing jawaban yang menyesatkan, dan teks ini
 * dipakai membentuk prompt sehingga harus jadi satu sumber kebenaran.
 *
 * Isinya sengaja menjelaskan ATURAN dan JEBAKAN, bukan sekadar daftar tombol.
 * Panitia bertanya "kenapa hasilnya begini", bukan "tombol ini apa".
 */
export type PageInfo = {
  /** Nama halaman seperti di sidebar. */
  title: string;
  /** Ringkas apa gunanya halaman ini. */
  summary: string;
  /** Fitur dan aturan yang perlu diketahui. */
  features: string[];
  /** Pertanyaan yang relevan di halaman ini. */
  suggestions: string[];
};

/**
 * Cara kerja perhitungan yang berlaku LINTAS halaman.
 *
 * Disertakan di setiap prompt, bukan hanya di halaman tertentu, karena
 * panitia bertanya "angka ini dari mana" di halaman mana pun. Isinya
 * diverifikasi langsung dari query yang benar-benar dipakai, jadi jangan
 * mengubahnya tanpa memeriksa kode yang bersangkutan.
 */
export const DASAR_HITUNG: string[] = [
  "POIN PESERTA = jumlah baris vote berstatus approved untuk peserta itu, satu vote satu poin. Vote pending dan vote boost admin (is_bot) TIDAK dihitung. Karena itu poin peserta sama dengan jumlah vote approved-nya.",

  "SALDO POIN SPIN = poin dari vote approved, ditambah penyesuaian manual admin, dikurangi poin yang sudah dibelanjakan. Rumusnya: tersedia = diperoleh + penyesuaian - terpakai, dan tidak pernah minus. Penyesuaian manual sengaja terpisah dari vote supaya menambah saldo tidak menaikkan statistik event maupun klasemen.",

  "VOTE BOOST ADMIN tidak menghasilkan poin spin karena ditandai is_bot dan disaring di semua perhitungan. Itu sebabnya menu Penyesuaian Poin ada.",

  "TOTAL VOTER = jumlah identitas unik berdasarkan nomor WA, gabungan tiga kelompok: pernah vote, pernah quest disetujui, dan akun voter yang sudah menyelesaikan onboarding walau belum vote. Karena gabungan, angkanya bisa lebih besar dari jumlah akun onboarding.",

  "VOTE DITOLAK diambil dari tabel arsip, bukan dari tabel vote. Vote yang ditolak DIHAPUS dari tabel vote supaya voter bisa mengirim bukti ulang, jadi jejaknya hanya ada di arsip.",

  "VOTER PULIH = voter unik yang pernah ditolak lalu mengajukan ulang dan akhirnya disetujui. VOTER HILANG = yang ditolak dan tidak pernah kembali. Dipisah karena angka ditolak saja tidak bisa membedakan keduanya.",

  "POIN PESERTA DI SATU GELOMBANG = poin bawaan (carry) ditambah poin vote yang masuk di gelombang itu saja. Jadi angka di halaman gelombang bisa berbeda dari total poin peserta di klasemen, dan itu bukan kesalahan.",

  "KUOTA EFEKTIF GELOMBANG = kuota dasar ditambah seluruh sisa slot dari gelombang sebelumnya yang sudah DITUTUP. Sisa slot satu gelombang = kuota dasarnya dikurangi jumlah yang lolos di situ. Dihitung ulang setiap kali dibaca, jadi perubahan panitia langsung terlihat.",

  "GOLDEN BUZZER tidak ikut dihitung dalam jumlah lolos gelombang mana pun, jadi tidak memakai slot dan tidak mengurangi kuota.",

  "PELUANG HADIAH SPIN = bobot hadiah dibagi total bobot semua hadiah yang benar-benar ikut diundi. Hadiah terkunci, hadiah nonaktif, hadiah berbobot nol, dan hadiah yang ambangnya belum tercapai tidak masuk pembagi ini.",

  "JATAH HADIAH dihitung per ORANG, memakai jumlah email unik penerima, bukan jumlah barang. Akun yang sudah pernah menang tidak menambah pemakaian jatah kalau menang lagi.",

  "PERINGKAT diurutkan dari poin tertinggi. Peringkat sekolah memakai akumulasi poin seluruh pesertanya.",
];

export const PAGES: Record<string, PageInfo> = {
  "/admin": {
    title: "Dashboard",
    summary:
      "Ringkasan angka event: peserta, voter, vote masuk, dan grafik pertumbuhan harian.",
    features: [
      "Kartu statistik punya ikon tanda tanya berisi penjelasan cara angkanya dihitung.",
      "Grafik Pertumbuhan Voter membandingkan jumlah akun baru per hari dengan jumlah orang yang ngevote per hari, 7 hari terakhir.",
      "Total Voter bisa lebih besar dari jumlah akun onboarding, karena ada voter yang login tapi belum menyelesaikan wizard onboarding.",
      "Ada rincian vote ditolak, vote yang mengulang lalu akhirnya disetujui, dan vote yang hilang.",
    ],
    suggestions: [
      "Apa bedanya Total Voter dan jumlah akun?",
      "Kenapa grafik pertumbuhan bisa turun?",
      "Bagaimana vote ditolak dihitung di dashboard?",
    ],
  },

  "/admin/rounds": {
    title: "Gelombang",
    summary:
      "Atur gelombang seleksi (Grup A, B, C), kuota lolos, dan waktu penutupan.",
    features: [
      "Kuota lolos dihitung per PESERTA, bukan per sekolah.",
      "Slot yang tidak terpakai di satu gelombang otomatis ditambahkan ke gelombang berikutnya, dan dihitung ulang setiap kali dibaca sehingga perubahan panitia langsung terlihat.",
      "Golden Buzzer TIDAK memakai slot gelombang. Kalau ada 1 Golden Buzzer, slot lolos gelombang tetap utuh.",
      "Gelombang terakhir ditandai final, jadi sisa slotnya tidak diteruskan ke mana pun.",
      "Menutup gelombang menetapkan siapa yang lolos berdasarkan peringkat poin saat itu.",
    ],
    suggestions: [
      "Bagaimana slot sisa diteruskan ke gelombang berikutnya?",
      "Apa yang terjadi saat gelombang ditutup?",
      "Apakah Golden Buzzer mengurangi kuota lolos?",
    ],
  },

  "/admin/hasil": {
    title: "Hasil Lolos",
    summary:
      "Daftar peserta yang lolos tiap gelombang, bisa diekspor dan ditukar.",
    features: [
      "Bisa ekspor CSV seluruh peserta lolos lintas gelombang.",
      "Fitur tukar: menurunkan peserta yang sudah lolos dan menaikkan peserta dari daftar berikutnya. Nilainya dihitung ulang otomatis.",
      "Boleh hanya menurunkan tanpa menaikkan, misalnya dari 200 jadi 190.",
      "Peserta Golden Buzzer tidak muncul di sini karena dia lepas dari gelombang.",
      "Satu peserta hanya bisa lolos di satu gelombang. Yang sudah lolos tidak ikut gelombang berikutnya dan tidak bisa divote lagi.",
    ],
    suggestions: [
      "Bagaimana cara menukar peserta yang lolos?",
      "Kenapa Golden Buzzer tidak ada di daftar ini?",
      "Bisakah saya hanya mengurangi jumlah yang lolos?",
    ],
  },

  "/admin/golden-buzzer": {
    title: "Golden Buzzer",
    summary:
      "Pilih peserta yang langsung lolos tanpa menunggu hasil gelombang.",
    features: [
      "Golden Buzzer adalah peserta yang dipilih langsung panitia atau juri karena punya keunggulan unik, inspiratif, dan bisa jadi role model.",
      "Yang ditandai langsung lolos, lepas dari gelombang, dan tidak bisa divote lagi.",
      "Tidak ada batas jumlah, dan tidak memakai slot gelombang.",
      "Menandai peserta sebagai Golden Buzzer akan mengeluarkan dia dari daftar lolos gelombang, jadi namanya tidak muncul dua kali.",
      "Peserta Golden Buzzer tetap tampil di halaman voting dengan tampilan khusus, tanpa tombol vote.",
    ],
    suggestions: [
      "Apa itu Golden Buzzer dan bedanya dengan lolos gelombang?",
      "Apakah Golden Buzzer mengurangi kuota lolos?",
      "Apa yang terjadi kalau peserta yang sudah lolos gelombang dijadikan Golden Buzzer?",
    ],
  },

  "/admin/quests": {
    title: "Quest",
    summary: "Kelola misi tambahan yang bisa dikerjakan voter untuk poin.",
    features: [
      "Tiap quest punya poin dan gambar referensi.",
      "Voter mengumpulkan bukti, lalu panitia memeriksanya di halaman Submission.",
    ],
    suggestions: [
      "Bagaimana cara menambah quest baru?",
      "Bagaimana poin quest dihitung?",
    ],
  },

  "/admin/submissions": {
    title: "Submission",
    summary: "Periksa bukti pengerjaan quest dari voter.",
    features: [
      "Status pending berarti poinnya belum masuk.",
      "Menyetujui submission menambahkan poin quest ke peserta yang didukung.",
    ],
    suggestions: [
      "Kapan poin quest masuk ke peserta?",
      "Apa yang terjadi kalau submission ditolak?",
    ],
  },

  "/admin/votes": {
    title: "Verifikasi Vote",
    summary:
      "Periksa bukti follow saluran WhatsApp dari voter sebelum vote pertamanya dihitung.",
    features: [
      "Vote pertama tiap voter perlu bukti follow 2 saluran WhatsApp.",
      "Selama masih pending, poinnya belum masuk ke peserta.",
      "Ada tab khusus untuk melihat vote yang ditolak, lengkap dengan alasannya.",
      "Voter yang ditolak bisa mengirim bukti ulang, dan riwayat penolakannya tetap tersimpan.",
    ],
    suggestions: [
      "Kenapa vote masih pending?",
      "Di mana saya bisa melihat vote yang ditolak?",
      "Apa yang terjadi setelah saya menyetujui vote?",
    ],
  },

  "/admin/kupon-klaim": {
    title: "Verifikasi Klaim Kupon",
    summary: "Periksa bukti follow akun untuk klaim kupon undian.",
    features: [
      "Kupon undian terpisah dari vote. Follow akun Instagram memberi kupon, bukan poin.",
      "Ada tab untuk melihat klaim yang ditolak.",
    ],
    suggestions: [
      "Apa bedanya kupon undian dan poin vote?",
      "Bagaimana cara melihat klaim yang ditolak?",
    ],
  },

  "/admin/participants": {
    title: "Peserta",
    summary: "Data peserta lomba, foto, sekolah, dan statusnya.",
    features: [
      "Peserta biasanya disinkron dari web pendaftaran lewat API, kunci sinkronnya email.",
      "Foto peserta bisa diunggah di sini dan dikompres otomatis.",
      "Mengubah data di sini bisa tertimpa saat sinkron berikutnya dari web pendaftaran.",
    ],
    suggestions: [
      "Dari mana data peserta berasal?",
      "Kenapa perubahan data peserta bisa kembali seperti semula?",
    ],
  },

  "/admin/schools": {
    title: "Sekolah",
    summary: "Data sekolah dan kabupaten asalnya.",
    features: [
      "Sekolah otomatis dibuat saat peserta disinkron kalau belum ada.",
      "Kabupaten terisi otomatis dari NPSN kalau NPSN-nya cocok dengan data master.",
    ],
    suggestions: [
      "Bagaimana kabupaten sekolah terisi otomatis?",
      "Kenapa ada sekolah tanpa kabupaten?",
    ],
  },

  "/admin/voters": {
    title: "Voter",
    summary: "Daftar akun voter beserta aktivitasnya.",
    features: [
      "Voting wajib login. Tidak ada vote sebagai tamu.",
      "Ada voter yang sudah login tapi belum menyelesaikan wizard onboarding, jadi datanya belum lengkap.",
    ],
    suggestions: [
      "Apakah bisa vote tanpa akun?",
      "Kenapa ada voter yang datanya tidak lengkap?",
    ],
  },

  "/admin/daerah": {
    title: "Daerah",
    summary: "Data kabupaten dan provinsi yang dipakai sistem.",
    features: [
      "Dipakai mengelompokkan peserta dan sekolah di klasemen.",
    ],
    suggestions: ["Untuk apa data daerah dipakai?"],
  },

  "/admin/leads": {
    title: "Leads PMB",
    summary:
      "Data voter yang menyatakan minat kuliah, untuk keperluan penerimaan mahasiswa baru.",
    features: [
      "Diisi dari jawaban wizard onboarding voter, bukan formulir terpisah.",
      "Ada pertanyaan niat kuliah dan dari mana dia tahu STEKOM.",
    ],
    suggestions: [
      "Dari mana data Leads PMB berasal?",
      "Apa saja pertanyaan yang ditanyakan ke voter?",
    ],
  },

  "/admin/kupon": {
    title: "Daftar Kupon",
    summary: "Semua kupon undian yang sudah terbit dan status menangnya.",
    features: [
      "Tiap kupon punya kode unik.",
      "Kupon yang sudah menang ditandai beserta hadiahnya.",
    ],
    suggestions: [
      "Bagaimana voter mendapat kupon?",
      "Bagaimana cara melihat kupon yang sudah menang?",
    ],
  },

  "/admin/undian": {
    title: "Undian",
    summary: "Mengundi pemenang dari kupon yang terbit.",
    features: [
      "Kolom hadiah WAJIB diisi sebelum mengundi. Tombol Undi Cepat mati kalau kolomnya kosong.",
      "Ada dua mode: Undi Cepat memakai hadiah di kolom, dan mode roda menentukan hadiah dari segmen tempat roda berhenti.",
      "Kemenangan bisa dibatalkan, dan kuponnya kembali ke kolam undian.",
      "Undian ini TERPISAH dari spin hadiah di web kedua. Undian memakai kupon, spin memakai poin.",
      "Daftar pemenang ada di bagian Riwayat Pemenang di halaman ini, memuat nama, kode kupon, dan hadiahnya.",
      "Jumlah pemenang dihitung dari kupon yang sudah ditandai menang. Kupon yang kemenangannya dibatalkan tidak ikut dihitung karena kembali ke kolam undian.",
      "Hadiah yang tampil di riwayat dibaca dari data kupon, jadi selalu hadiah yang sebenarnya diterima, bukan hadiah yang tertulis saat undian dimulai.",
    ],
    suggestions: [
      "Apa bedanya Undian dan Spin hadiah?",
      "Bagaimana cara membatalkan pemenang yang salah undi?",
      "Kenapa kolom hadiah wajib diisi?",
    ],
  },

  "/admin/pengumuman": {
    title: "Pengumuman",
    summary: "Kirim notifikasi massal ke akun voter dan lihat riwayatnya.",
    features: [
      "Ada dedupe 24 jam: akun yang sudah menerima pengumuman dalam 24 jam terakhir dilewati, supaya tombol yang tertekan dua kali tidak membanjiri lonceng voter.",
      "Karena dedupe itu, jumlah terkirim bisa jauh lebih kecil dari jumlah sasaran. Angka yang dilewati ditampilkan supaya tidak membingungkan.",
      "Riwayat mencatat jumlah terkirim, jumlah dibuka, dan jumlah klik tautan.",
      "Ada tombol refresh untuk memperbarui angkanya.",
    ],
    suggestions: [
      "Kenapa jumlah terkirim jauh lebih sedikit dari sasaran?",
      "Apa bedanya angka dibuka dan angka klik?",
      "Bagaimana cara kerja dedupe 24 jam?",
    ],
  },

  "/admin/poin": {
    title: "Penyesuaian Poin",
    summary:
      "Atur saldo poin spin sebuah akun, dan seluruh aturan hadiah roda spin di web kedua.",
    features: [
      "Penyesuaian poin menambah atau mengurangi saldo spin tanpa membuat vote, jadi klasemen dan statistik event tetap akurat. Alasan wajib, dan bisa dibatalkan.",
      "Vote boost dari admin tidak menghasilkan poin spin, itu sebabnya penyesuaian manual ini ada.",
      "Tombol Tutup Spin mematikan seluruh roda spin di web kedua. Penolakan dilakukan di server, jadi tetap aman walau tombolnya masih tampil di web kedua.",
      "BOBOT menentukan peluang di undian acak dan sifatnya RELATIF: peluang = bobot dibagi total bobot semua hadiah. Menaikkan satu bobot ikut menurunkan peluang hadiah lain. Cara termudah menaikkan peluang semua hadiah adalah menurunkan bobot Dash.",
      "JATAH membatasi jumlah ORANG yang boleh menang hadiah itu, bukan jumlah barang. Kosong berarti tanpa batas.",
      "OTOMATIS menahan sekaligus menjamin. Diisi 10 kali spin berarti hadiah itu tidak bisa didapat sebelum spin ke-10 walau beruntung, lalu diberikan tepat di spin ke-10.",
      "KUNCI berbeda dari nonaktif. Nonaktif hanya mengeluarkan hadiah dari undian acak, sedangkan jalur otomatis dan jaminan tidak melihat status aktif. Kunci menutup semua jalur, dan hadiah terkunci tetap tergambar di roda sebagai pemikat dengan peluang 0.",
      "Satu akun hanya boleh menerima SATU BARANG seumur hidup. Yang sudah dapat Tumbler tidak bisa dapat Kaos juga, dan seterusnya selalu Dash. Kunci dan Dash tidak dihitung sebagai barang.",
      "Dash tidak bisa dikunci atau diberi jatah karena itu hadiah cadangan wajib saat peserta tidak dapat apa-apa.",
      "Gambar hadiah bisa diunggah per hadiah, dikompres otomatis jadi 400px.",
    ],
    suggestions: [
      "Kenapa bobot satu hadiah mempengaruhi peluang hadiah lain?",
      "Apa bedanya Kunci dan menonaktifkan hadiah?",
      "Apa arti kolom Otomatis dan Jatah?",
      "Kenapa vote boost tidak menghasilkan poin spin?",
    ],
  },

  "/admin/spin-log": {
    title: "Log Spin",
    summary:
      "Riwayat permintaan spin dari web kedua, dan penandaan akun untuk hadiah tertentu.",
    features: [
      "Satu baris adalah satu PERMINTAAN, bukan satu hadiah. Paket 5x + 1 bonus menghasilkan 6 hadiah tapi hanya sekali ditagih poin.",
      "Tiap hadiah menampilkan asalnya: undian, jaminan, ambang otomatis, atau ditandai panitia.",
      "Rekap hadiah menunjukkan berapa kali tiap hadiah keluar dan ke berapa orang, berguna memeriksa sisa jatah.",
      "Panel Tandai Akun Dapat Hadiah dipakai untuk pemenang yang sudah ditetapkan panitia di luar sistem, misalnya hadiah panggung.",
      "Penandaan mencocokkan akun lewat email ATAU nomor WA, cukup salah satu. Nomor dinormalkan jadi 08xxx.",
      "Kolom Di spin ke- boleh dikosongkan, artinya spin berikutnya kapan pun dia memutar.",
      "Penandaan sekali pakai dan didahulukan dari semua jalur lain. Hadiah terkunci tidak bisa ditandai.",
      "Penandaan ke akun yang belum ada ditolak saat disimpan, supaya ketahuan sekarang bukan saat acara.",
    ],
    suggestions: [
      "Kenapa satu baris log bisa berisi banyak hadiah?",
      "Bagaimana cara menandai akun supaya dapat hadiah tertentu?",
      "Apa arti asal hadiah ditandai panitia?",
    ],
  },

  "/admin/klaim-hadiah": {
    title: "Klaim Hadiah",
    summary:
      "Pengajuan klaim hadiah spin dari peserta, lengkap dengan data pengiriman.",
    features: [
      "Peserta hanya bisa mengajukan hadiah yang benar-benar dia menangkan, diperiksa di server.",
      "Data pengiriman disalin saat pengajuan, bukan dibaca dari profil, jadi riwayat tetap benar walau peserta mengubah profilnya kemudian.",
      "Alur statusnya: Menunggu, Disetujui, Sudah dikirim. Yang ditolak atau terkirim bisa dikembalikan ke Menunggu kalau ada koreksi.",
      "Alasan WAJIB diisi saat menolak, supaya peserta tahu penyebabnya dan bisa mengajukan ulang.",
      "Nomor WA jadi tautan chat langsung.",
      "Dash dan Kunci tidak bisa diklaim. Yang pertama bukan barang, yang kedua alat tukar.",
      "Satu hadiah hanya menerima satu pengajuan.",
    ],
    suggestions: [
      "Bagaimana alur memproses klaim hadiah?",
      "Kenapa alasan wajib diisi saat menolak?",
      "Apakah peserta bisa mengklaim hadiah orang lain?",
    ],
  },

  "/admin/setting": {
    title: "Pengaturan",
    summary: "Setelan umum event: kontak, tautan, dan parameter voting.",
    features: [
      "Perubahan di sini berlaku untuk seluruh sistem.",
    ],
    suggestions: ["Setelan apa saja yang ada di halaman ini?"],
  },

  "/admin/log": {
    title: "Log Aktivitas",
    summary: "Riwayat aktivitas: vote, quest, dan undian, secara real-time.",
    features: [
      "Bisa disaring per jenis, per peserta, dan per rentang tanggal.",
      "Untuk baris undian, hadiah dibaca dari data kupon sehingga selalu menampilkan hadiah yang sebenarnya.",
    ],
    suggestions: [
      "Aktivitas apa saja yang tercatat di sini?",
      "Bagaimana cara menyaring log per peserta?",
    ],
  },
};

/** Halaman yang tidak dikenali tetap dijawab, dengan konteks umum. */
export const FALLBACK: PageInfo = {
  title: "Panel Admin",
  summary: "Panel admin YCS 2026 untuk mengelola voting, seleksi, dan hadiah.",
  features: [
    "Menu dikelompokkan jadi Kompetisi, Data, dan Lainnya.",
    "Kompetisi berisi gelombang, hasil lolos, Golden Buzzer, quest, dan verifikasi.",
    "Lainnya berisi kupon, undian, pengumuman, pengaturan spin, dan log.",
  ],
  suggestions: [
    "Apa saja menu yang ada di panel admin?",
    "Di mana saya mengatur hadiah spin?",
    "Di mana saya melihat peserta yang lolos?",
  ],
};

/**
 * Cocokkan path ke halaman. Prefiks terpanjang menang supaya sub-halaman
 * seperti /admin/votes/123 ikut konteks /admin/votes.
 *
 * "/admin" dikecualikan dari pencocokan prefiks: sebagai induk semua path
 * admin, dia akan menangkap halaman apa pun yang belum terdaftar di sini,
 * dan asisten lalu menjelaskan Dashboard di halaman yang bukan Dashboard.
 * Lebih baik jatuh ke konteks umum yang jujur tidak spesifik.
 */
export function resolvePage(pathRaw: string): { path: string; info: PageInfo } {
  const path = (pathRaw || "").split("?")[0].replace(/\/+$/, "") || "/admin";
  let best: string | null = null;
  for (const key of Object.keys(PAGES)) {
    const cocok = key === "/admin" ? path === key : path === key || path.startsWith(key + "/");
    if (cocok && (!best || key.length > best.length)) best = key;
  }
  return best
    ? { path: best, info: PAGES[best] }
    : { path, info: FALLBACK };
}
