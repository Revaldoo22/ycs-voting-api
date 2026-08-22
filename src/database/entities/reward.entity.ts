import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

/**
 * Katalog penukaran poin (redeem) dan hadiah spin, dikelola admin lewat API
 * dan dipakai UI web kedua.
 *
 * CATATAN PENTING soal poin: poin peserta = jumlah vote yang masuk (1 vote =
 * 1 poin). Menukar poin TIDAK PERNAH mengurangi jumlah vote, karena vote
 * adalah dasar peringkat lomba. Jadi penukaran dicatat terpisah sebagai
 * "poin terpakai" (lihat RewardRedemption), dan saldo yang bisa dibelanjakan
 * dihitung: poin dari vote MINUS poin yang sudah terpakai.
 */

/** Jenis imbalan dari satu penukaran poin. */
export type RedeemKind =
  /** Barang fisik yang diambil/dikirim (HP, e-money, tumbler). */
  | "item"
  /** Menambah jatah spin gratis. */
  | "spin";

@Entity("reward_catalog")
export class RewardCatalog {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  /** Kode stabil untuk dipanggil web kedua, mis. "hp_baru". Unik. */
  @Column({ type: "text", unique: true })
  code!: string;

  @Column({ type: "text" })
  name!: string;

  @Column({ type: "text", nullable: true })
  description!: string | null;

  /** Poin yang dipotong dari saldo saat ditukar. */
  @Column({ name: "point_cost", type: "int", default: 0 })
  pointCost!: number;

  /**
   * Kunci yang dibutuhkan selain poin. Kunci adalah syarat terpisah:
   * "2.000 poin (18 kunci)" berarti butuh dua-duanya.
   */
  @Column({ name: "key_cost", type: "int", default: 0 })
  keyCost!: number;

  @Column({ type: "text", default: "item" })
  kind!: RedeemKind;

  /** Untuk kind "spin": berapa jatah spin gratis yang diberikan. */
  @Column({ name: "spin_grant", type: "int", default: 0 })
  spinGrant!: number;

  /**
   * Sisa stok. null = tidak dibatasi. Berkurang tiap penukaran berhasil
   * supaya hadiah terbatas (mis. 1 HP) tidak kelebihan klaim.
   */
  @Column({ type: "int", nullable: true })
  stock!: number | null;

  @Column({ type: "boolean", default: true })
  active!: boolean;

  /** Urutan tampil di UI web kedua (kecil = atas). */
  @Column({ name: "sort_order", type: "int", default: 0 })
  sortOrder!: number;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}

/**
 * Hadiah pada roda spin web kedua. Peluang memakai bobot (weight), bukan
 * persen, supaya admin bisa menambah/menghapus hadiah tanpa perlu menghitung
 * ulang agar totalnya pas 100.
 */
@Entity("spin_prizes")
export class SpinPrize {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "text", unique: true })
  code!: string;

  @Column({ type: "text" })
  label!: string;

  /**
   * Bobot peluang relatif. Peluang = weight / total weight hadiah aktif.
   * Bobot 0 = tidak akan pernah keluar (tapi tetap tampil di roda).
   */
  @Column({ type: "int", default: 1 })
  weight!: number;

  /**
   * Hadiah "kosong" (💨). Ditandai supaya web kedua bisa menampilkan pesan
   * "belum beruntung" alih-alih mencatatnya sebagai hadiah.
   */
  @Column({ name: "is_empty", type: "boolean", default: false })
  isEmpty!: boolean;

  /** Kunci yang didapat kalau mendarat di sini (mis. hadiah "1 Kunci"). */
  @Column({ name: "key_grant", type: "int", default: 0 })
  keyGrant!: number;

  /**
   * Sisa stok hadiah besar. null = tidak dibatasi. Hadiah yang stoknya habis
   * otomatis dilewati saat pengundian.
   */
  @Column({ type: "int", nullable: true })
  stock!: number | null;

  @Column({ type: "text", nullable: true })
  color!: string | null;

  @Column({ type: "boolean", default: true })
  active!: boolean;

  @Column({ name: "sort_order", type: "int", default: 0 })
  sortOrder!: number;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}

/**
 * Catatan satu penukaran poin. Tabel inilah yang menyimpan "poin terpakai",
 * jadi jumlah vote di leaderboard tidak pernah tersentuh.
 */
@Entity("reward_redemptions")
export class RewardRedemption {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  /** Pemilik saldo. Identitas dipakai bersama web kedua lewat email. */
  @Column({ name: "profile_id", type: "uuid", nullable: true })
  profileId!: string | null;

  @Column({ type: "text" })
  email!: string;

  @Column({ name: "reward_code", type: "text" })
  rewardCode!: string;

  @Column({ name: "reward_name", type: "text" })
  rewardName!: string;

  /** Poin & kunci yang dipotong, disalin saat itu juga agar riwayat tetap
   * benar walau harga katalog diubah admin kemudian. */
  @Column({ name: "point_cost", type: "int", default: 0 })
  pointCost!: number;

  @Column({ name: "key_cost", type: "int", default: 0 })
  keyCost!: number;

  /** Jatah spin yang diberikan penukaran ini (untuk kind "spin"). */
  @Column({ name: "spin_grant", type: "int", default: 0 })
  spinGrant!: number;

  /** pending = menunggu diserahkan admin, done = sudah diambil. */
  @Column({ type: "text", default: "pending" })
  status!: "pending" | "done" | "canceled";

  @Column({ type: "text", nullable: true })
  note!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}

/**
 * Catatan satu putaran spin: apa yang didapat, dan berapa jatah/poin yang
 * terpakai. Dipakai untuk riwayat, audit, dan menghitung sisa jatah spin.
 */
@Entity("spin_results")
export class SpinResult {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "profile_id", type: "uuid", nullable: true })
  profileId!: string | null;

  @Column({ type: "text" })
  email!: string;

  @Column({ name: "prize_code", type: "text" })
  prizeCode!: string;

  @Column({ name: "prize_label", type: "text" })
  prizeLabel!: string;

  @Column({ name: "is_empty", type: "boolean", default: false })
  isEmpty!: boolean;

  @Column({ name: "key_grant", type: "int", default: 0 })
  keyGrant!: number;

  /**
   * Batch yang menaungi putaran ini. Paket "5x + 1 bonus" menghasilkan 6
   * baris dengan batch_id sama, jadi web kedua bisa menampilkannya sebagai
   * satu sesi.
   */
  @Column({ name: "batch_id", type: "uuid", nullable: true })
  batchId!: string | null;

  /** True untuk putaran bonus (yang tidak memotong jatah). */
  @Column({ name: "is_bonus", type: "boolean", default: false })
  isBonus!: boolean;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
