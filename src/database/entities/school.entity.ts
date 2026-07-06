import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

@Entity("schools")
export class School {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "text" })
  name!: string;

  /** NPSN — ID sekolah nasional (unik). Dari schools.csv. */
  @Column({ type: "text", nullable: true, unique: true })
  @Index("school_npsn")
  npsn!: string | null;

  /** Jenjang: SMA/SMK/dll. */
  @Column({ type: "text", nullable: true })
  jenjang!: string | null;

  /**
   * Kabupaten/kota (regions level 'regency') — dasar pengelompokan heatmap &
   * gelombang. Tetap dipertahankan untuk kompatibilitas.
   */
  @Column({ name: "region_id", type: "uuid", nullable: true })
  @Index("school_region")
  regionId!: string | null;

  /** Kode BPS wilayah (dari CSV) — untuk filter wizard bertingkat. */
  @Column({ name: "province_code", type: "text", nullable: true })
  @Index("school_province_code")
  provinceCode!: string | null;

  @Column({ name: "regency_code", type: "text", nullable: true })
  @Index("school_regency_code")
  regencyCode!: string | null;

  @Column({ name: "district_code", type: "text", nullable: true })
  @Index("school_district_code")
  districtCode!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
