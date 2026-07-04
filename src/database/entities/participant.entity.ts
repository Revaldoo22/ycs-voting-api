import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from "typeorm";

export type ParticipantStatus = "active" | "inactive";

@Entity("participants")
export class Participant {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  /**
   * ID peserta di aplikasi pendaftaran (web kedua) yang jadi sumber data.
   * Kunci sinkronisasi: upsert/replikasi di-address pakai ini. Unik, nullable
   * (peserta yang dibuat manual di admin sini boleh tanpa external_id).
   */
  @Column({ name: "external_id", type: "text", nullable: true, unique: true })
  externalId!: string | null;

  /** Linked login account (profiles.id). Null after account deletion. */
  @Column({ name: "profile_id", type: "uuid", nullable: true })
  profileId!: string | null;

  @Column({ type: "text" })
  name!: string;

  @Column({ name: "school_id", type: "uuid", nullable: true })
  schoolId!: string | null;

  @Column({ name: "photo_url", type: "text", nullable: true })
  photoUrl!: string | null;

  @Column({ type: "text", nullable: true })
  description!: string | null;

  @Column({ name: "total_points", type: "int", default: 0 })
  totalPoints!: number;

  @Column({ type: "text", default: "active" })
  status!: ParticipantStatus;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
