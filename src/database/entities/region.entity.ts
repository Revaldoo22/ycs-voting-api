import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from "typeorm";

/** Kabupaten/kota. `code` = kode BPS — kunci join ke GeoJSON peta nanti. */
@Entity("regions")
export class Region {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "text" })
  name!: string;

  @Column({ type: "text", unique: true, nullable: true })
  code!: string | null;

  @Column({ type: "text", nullable: true })
  province!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
