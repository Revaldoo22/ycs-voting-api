import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

export type RoundStatus = "draft" | "active" | "closed";
export type RoundSchoolStatus = "active" | "lolos" | "gugur";

/** Gelombang kompetisi. Hanya satu round berstatus 'active' pada satu waktu. */
@Entity("rounds")
export class Round {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "text" })
  name!: string;

  @Column({ type: "text", default: "draft" })
  status!: RoundStatus;

  /** Default jumlah sekolah lolos per kabupaten saat gelombang ditutup. */
  @Column({ name: "top_n", type: "int", default: 1 })
  topN!: number;

  @Column({ name: "starts_at", type: "timestamptz", nullable: true })
  startsAt!: Date | null;

  @Column({ name: "ends_at", type: "timestamptz", nullable: true })
  endsAt!: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}

/** Keikutsertaan sekolah dalam satu gelombang + hasil akhirnya. */
@Entity("round_schools")
@Index("rs_uniq", ["roundId", "schoolId"], { unique: true })
export class RoundSchool {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "round_id", type: "uuid" })
  roundId!: string;

  @Column({ name: "school_id", type: "uuid" })
  schoolId!: string;

  @Column({ type: "text", default: "active" })
  status!: RoundSchoolStatus;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
