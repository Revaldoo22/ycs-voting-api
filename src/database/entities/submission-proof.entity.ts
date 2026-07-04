import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from "typeorm";

@Entity("submission_proofs")
export class SubmissionProof {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "submission_id", type: "uuid" })
  submissionId!: string;

  @Column({ type: "text" })
  url!: string;

  @Column({ name: "url_norm", type: "text", nullable: true })
  urlNorm!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
