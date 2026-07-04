import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from "typeorm";

export type SubmissionStatus = "pending" | "approved" | "rejected";

@Entity("submissions")
export class Submission {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "participant_id", type: "uuid" })
  participantId!: string;

  @Column({ name: "quest_id", type: "uuid" })
  questId!: string;

  @Column({ name: "content_id", type: "uuid", nullable: true })
  contentId!: string | null;

  @Column({ name: "proof_url", type: "text" })
  proofUrl!: string;

  @Column({ name: "proof_url_norm", type: "text", nullable: true })
  proofUrlNorm!: string | null;

  @Column({ type: "text", default: "pending" })
  status!: SubmissionStatus;

  @Column({ name: "review_note", type: "text", nullable: true })
  reviewNote!: string | null;

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

  @Column({ name: "submit_date", type: "date", default: () => "CURRENT_DATE" })
  submitDate!: string;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
