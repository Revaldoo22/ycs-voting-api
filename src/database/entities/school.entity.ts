import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from "typeorm";

@Entity("schools")
export class School {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "text" })
  name!: string;

  /** Kabupaten/kota (regions) — dasar pengelompokan heatmap & gelombang. */
  @Column({ name: "region_id", type: "uuid", nullable: true })
  regionId!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
