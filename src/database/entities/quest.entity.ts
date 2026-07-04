import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from "typeorm";

export type QuestStatus = "active" | "inactive";
export type ProofType = "link" | "file";
export type QuestFrequency = "once" | "daily" | "global";
export type ContentKind = "engage" | "sound";

@Entity("quests")
export class Quest {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "text" })
  name!: string;

  @Column({ type: "text", nullable: true })
  description!: string | null;

  @Column({ type: "int", default: 0 })
  point!: number;

  @Column({ type: "text", default: "active" })
  status!: QuestStatus;

  @Column({ name: "proof_type", type: "text", default: "file" })
  proofType!: ProofType;

  @Column({ type: "text", default: "once" })
  frequency!: QuestFrequency;

  @Column({ name: "content_kind", type: "text", nullable: true })
  contentKind!: ContentKind | null;

  @Column({ name: "ref_link", type: "text", nullable: true })
  refLink!: string | null;

  @Column({ name: "ref_image", type: "text", nullable: true })
  refImage!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
