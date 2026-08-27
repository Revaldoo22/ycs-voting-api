import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

/** Jenis pengajuan yang ditolak. */
export type RejectionKind = "vote" | "coupon_claim";

/**
 * Riwayat penolakan vote / klaim kupon.
 *
 * Baris vote & klaim SENGAJA dihapus saat ditolak, supaya unique index
 * (email/WA/profil) bebas lagi dan voter bisa mengajukan ulang dengan bukti
 * yang benar. Akibatnya jejaknya hilang. Tabel ini menyalin datanya sebelum
 * baris aslinya dihapus, jadi admin tetap punya riwayat untuk ditinjau.
 *
 * Sifatnya arsip: tidak dipakai logika voting, hanya dibaca halaman admin.
 * Kolom voter/peserta disimpan sebagai teks (bukan relasi) supaya riwayat
 * tetap terbaca walau peserta atau akunnya dihapus di kemudian hari.
 */
@Entity("rejections")
@Index("rejection_kind_created", ["kind", "createdAt"])
export class Rejection {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "text" })
  kind!: RejectionKind;

  /** Alasan yang diisi admin. Null = admin tidak mengisi alasan. */
  @Column({ type: "text", nullable: true })
  reason!: string | null;

  // ---- Identitas voter (disalin, bukan relasi) ----
  @Column({ name: "voter_name", type: "text", nullable: true })
  voterName!: string | null;

  @Column({ name: "voter_email", type: "text", nullable: true })
  voterEmail!: string | null;

  @Column({ name: "voter_phone", type: "text", nullable: true })
  voterPhone!: string | null;

  @Column({ name: "voter_school", type: "text", nullable: true })
  voterSchool!: string | null;

  // ---- Peserta yang dituju (hanya untuk kind 'vote') ----
  @Column({ name: "participant_id", type: "uuid", nullable: true })
  participantId!: string | null;

  @Column({ name: "participant_name", type: "text", nullable: true })
  participantName!: string | null;

  @Column({ name: "participant_school", type: "text", nullable: true })
  participantSchool!: string | null;

  /** Screenshot bukti follow yang ditolak (array URL). */
  @Column({ name: "proofs", type: "jsonb", nullable: true })
  proofs!: string[] | null;

  /** Kapan pengajuan aslinya dibuat voter. */
  @Column({ name: "submitted_at", type: "timestamptz", nullable: true })
  submittedAt!: Date | null;

  /** Kapan admin menolaknya. */
  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
