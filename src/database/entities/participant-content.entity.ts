import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from "typeorm";
import type { ContentKind } from "./quest.entity";

@Entity("participant_contents")
export class ParticipantContent {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "participant_id", type: "uuid" })
  participantId!: string;

  @Column({ type: "text" })
  kind!: ContentKind;

  @Column({ type: "text" })
  url!: string;

  @Column({ type: "text", nullable: true })
  label!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
