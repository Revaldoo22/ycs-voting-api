import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

export type VoteKind = "daily5" | "fav20";

@Entity("daily_votes")
@Index("dv_uniq_device", ["participantId", "deviceFingerprint", "voteDate", "voteKind"], { unique: true })
@Index("dv_uniq_phone", ["participantId", "voterPhone", "voteDate", "voteKind"], { unique: true })
@Index("dv_uniq_email", ["participantId", "voterEmail", "voteDate", "voteKind"], { unique: true })
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

  @Column({ type: "int", default: 5 })
  points!: number;

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
