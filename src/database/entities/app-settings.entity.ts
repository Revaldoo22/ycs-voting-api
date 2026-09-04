import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

/** Single-row settings table (id is always true). */
@Entity("app_settings")
export class AppSettings {
  @PrimaryColumn({ type: "boolean", default: true })
  id!: boolean;

  @Column({ name: "event_open", type: "boolean", default: true })
  eventOpen!: boolean;

  @Column({ name: "closed_message", type: "text", default: "" })
  closedMessage!: string;

  @Column({ name: "ip_daily_limit", type: "int", default: 5 })
  ipDailyLimit!: number;

  @Column({ name: "spin_wheel_mode", type: "varchar", default: "ALWAYS_TUMBLER" })
  spinWheelMode!: string;

  // ---- Spin web kedua -------------------------------------------------
  /** Poin yang dipotong untuk satu kali spin di luar jatah gratis. */
  @Column({ name: "spin_point_cost", type: "int", default: 10 })
  spinPointCost!: number;

  /**
   * Harga diskon spin PERTAMA tiap akun (sekali seumur akun). Setelah itu
   * kembali ke harga normal `spinPointCost`.
   */
  @Column({ name: "spin_first_cost", type: "int", default: 3 })
  spinFirstCost!: number;

  /**
   * Roda spin aktif atau tidak. Beda dari `spin_bundle_enabled` yang hanya
   * mematikan paket 5x: ini mematikan SELURUH spin di web kedua, dipakai saat
   * hadiah belum siap atau event spin ditutup.
   */
  @Column({ name: "spin_enabled", type: "boolean", default: true })
  spinEnabled!: boolean;

  /** Paket banyak spin sekaligus tersedia atau tidak (opsi "5x + bonus"). */
  @Column({ name: "spin_bundle_enabled", type: "boolean", default: true })
  spinBundleEnabled!: boolean;

  /** Jumlah spin berbayar dalam satu paket. */
  @Column({ name: "spin_bundle_count", type: "int", default: 5 })
  spinBundleCount!: number;

  /** Spin bonus gratis yang menyertai paket (5x + 1 bonus). */
  @Column({ name: "spin_bundle_bonus", type: "int", default: 1 })
  spinBundleBonus!: number;

  /**
   * Mode paksa: kode hadiah yang SELALU keluar untuk setiap spin, melewati
   * undian acak. null = roda berjalan normal sesuai bobot.
   *
   * Dipakai saat panitia ingin hasilnya pasti, mis. semua peserta dapat
   * Tumbler. Batas jatah dan maksimal per akun tetap dihormati: kalau hadiah
   * paksa sudah tak bisa diklaim akun itu, hasilnya jatuh ke Dash, bukan
   * menembus kuota. Hadiah terkunci tidak bisa dijadikan hadiah paksa.
   */
  @Column({ name: "spin_forced_prize_code", type: "text", nullable: true })
  spinForcedPrizeCode!: string | null;

  /**
   * Tahan hadiah paksa sampai akun mencapai jumlah spin ini. Di bawah ambang
   * hasilnya Dash. null / 0 = langsung berlaku dari spin pertama.
   *
   * Dipakai untuk "Tumbler baru muncul setelah 10 kali spin".
   */
  @Column({ name: "spin_forced_min_spins", type: "int", nullable: true })
  spinForcedMinSpins!: number | null;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
