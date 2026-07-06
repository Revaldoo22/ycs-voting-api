import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

export type RegionLevel = "province" | "regency" | "district";

/**
 * Wilayah administratif bertingkat (provinsi → kabupaten/kota → kecamatan).
 * `code` = kode BPS (unik lintas level). `parent_id` menautkan ke tingkat di
 * atasnya (provinsi.parent = null). Diisi dari schools.csv.
 */
@Entity("regions")
export class Region {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "text" })
  name!: string;

  /** Kode BPS. Unik lintas semua level (provinceCode/regencyCode/districtCode). */
  @Column({ type: "text", unique: true })
  @Index("region_code")
  code!: string;

  @Column({ type: "text" })
  @Index("region_level")
  level!: RegionLevel;

  /** Tingkat di atasnya: kabupaten→provinsi, kecamatan→kabupaten. Null = provinsi. */
  @Column({ name: "parent_id", type: "uuid", nullable: true })
  @Index("region_parent")
  parentId!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
