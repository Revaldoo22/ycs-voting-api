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

  /** Default jumlah sekolah lolos saat gelombang ditutup. */
  @Column({ name: "top_n", type: "int", default: 1 })
  topN!: number;

  /**
   * Cara menentukan yang lolos saat tutup:
   *  - 'per_region': top_n sekolah per kabupaten (default lama)
   *  - 'global': top_n sekolah teratas lintas kabupaten (mis. 200 semifinalis)
   */
  @Column({ name: "select_mode", type: "text", default: "per_region" })
  selectMode!: "per_region" | "global";

  /** Urutan gelombang (1,2,3…). Menentukan 'gelombang berikutnya' saat tutup. */
  @Column({ name: "sequence", type: "int", default: 0 })
  sequence!: number;

  @Column({ name: "starts_at", type: "timestamptz", nullable: true })
  startsAt!: Date | null;

  @Column({ name: "ends_at", type: "timestamptz", nullable: true })
  endsAt!: Date | null;

  /**
   * Jadwal auto-close. Cron harian akan menutup + menggulirkan gelombang ini
   * begitu waktu ini terlewat (selama status masih 'active'). Null = manual.
   */
  @Column({ name: "scheduled_close_at", type: "timestamptz", nullable: true })
  scheduledCloseAt!: Date | null;

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

  /**
   * Poin bawaan gelombang. Untuk sekolah gugur yang lanjut ke gelombang
   * susulan, diisi 50% poin akhir gelombang sebelumnya (poin peserta asli
   * tak diubah). Ranking round = carry_points + poin vote round ini.
   */
  @Column({ name: "carry_points", type: "int", default: 0 })
  carryPoints!: number;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
