import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

export type VoteKind = "daily5";
export type VoteStatus = "pending" | "approved";

/**
 * Bukti follow per tugas (key tugas → URL screenshot), direview admin
 * sebelum poin masuk. Key: stekom_tiktok, stekom_ig, toploker_tiktok,
 * toploker_ig, wa_stekom, wa_ycs (data lama: ig, tiktok).
 */
export type FollowProofs = Record<string, string>;

// 1 akun = 1 vote SEUMUR EVENT. Unique index kini GLOBAL per identitas
// (email/WA/device), bukan lagi per (peserta+tanggal+kind) — sekali satu
// email/nomor/device dipakai vote, tak bisa dipakai vote lagi ke siapapun.
@Entity("daily_votes")
@Index("dv_uniq_device", ["deviceFingerprint"], { unique: true })
@Index("dv_uniq_phone", ["voterPhone"], { unique: true })
@Index("dv_uniq_email", ["voterEmail"], { unique: true })
export class DailyVote {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "participant_id", type: "uuid" })
  participantId!: string;

  /** Gelombang saat vote masuk (null = di luar gelombang aktif). */
  @Column({ name: "round_id", type: "uuid", nullable: true })
  @Index("dv_round")
  roundId!: string | null;

  @Column({ name: "vote_date", type: "date", default: () => "CURRENT_DATE" })
  voteDate!: string;

  @Column({ name: "vote_kind", type: "text", default: "daily5" })
  voteKind!: VoteKind;

  @Column({ type: "int", default: 1 })
  points!: number;

  /**
   * Vote pertama voter (wajib follow) masuk sebagai 'pending' — poin baru
   * dihitung setelah admin approve bukti follow. Reject = baris dihapus
   * (hak vote kembali). Vote lain (peserta/boost) langsung 'approved'.
   */
  @Column({ type: "text", default: "approved" })
  @Index("dv_status")
  status!: VoteStatus;

  /** Bukti follow per tugas: { ig, tiktok } (URL screenshot). */
  @Column({ name: "follow_proofs", type: "jsonb", nullable: true })
  followProofs!: FollowProofs | null;

  /** Vote sintetis yang dibuat admin (boost). Bisa di-rollback per gelombang. */
  @Column({ name: "is_bot", type: "boolean", default: false })
  @Index("dv_is_bot")
  isBot!: boolean;

  @Column({ name: "device_fingerprint", type: "text", nullable: true })
  deviceFingerprint!: string | null;

  @Column({ name: "server_hash", type: "text", nullable: true })
  serverHash!: string | null;

  @Column({ name: "ip_hash", type: "text", nullable: true })
  ipHash!: string | null;

  @Column({ name: "voter_name", type: "text", nullable: true })
  voterName!: string | null;

  @Column({ name: "voter_phone", type: "text", nullable: true })
  voterPhone!: string | null;

  @Column({ name: "voter_email", type: "text", nullable: true })
  voterEmail!: string | null;

  @Column({ name: "voter_status", type: "text", nullable: true })
  voterStatus!: string | null;

  @Column({ name: "voter_school", type: "text", nullable: true })
  voterSchool!: string | null;

  @Column({ name: "voter_class", type: "text", nullable: true })
  voterClass!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
