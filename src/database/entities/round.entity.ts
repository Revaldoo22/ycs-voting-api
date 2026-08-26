import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

export type RoundStatus = "draft" | "active" | "closed";
export type RoundParticipantStatus = "active" | "lolos" | "gugur";

/** Gelombang kompetisi. Hanya satu round berstatus 'active' pada satu waktu. */
@Entity("rounds")
export class Round {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "text" })
  name!: string;

  @Column({ type: "text", default: "draft" })
  status!: RoundStatus;

  /** Default jumlah peserta lolos saat gelombang ditutup. */
  @Column({ name: "top_n", type: "int", default: 1 })
  topN!: number;

  /**
   * Cara menentukan yang lolos saat tutup:
   *  - 'global': top_n peserta teratas lintas kabupaten (mis. 200 semifinalis)
   *  - 'per_region': top_n peserta per kabupaten (asal sekolahnya)
   */
  @Column({ name: "select_mode", type: "text", default: "global" })
  selectMode!: "per_region" | "global";

  /** Urutan gelombang (1,2,3…). Menentukan 'gelombang berikutnya' saat tutup. */
  @Column({ name: "sequence", type: "int", default: 0 })
  sequence!: number;

  /**
   * Gelombang penutup event. Saat ditutup, TIDAK ada gelombang lanjutan yang
   * dibuat/diaktifkan, jadi kompetisi benar-benar berakhir. Tanpa flag ini
   * sistem akan terus menggulirkan gelombang baru selama masih ada peserta
   * yang belum lolos.
   */
  @Column({ name: "is_final", type: "boolean", default: false })
  isFinal!: boolean;

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

/**
 * Keikutsertaan PESERTA dalam satu gelombang + hasil akhirnya. Unit yang
 * lolos/gugur adalah peserta, bukan sekolah. Sekolah hanya label asal
 * peserta (dipakai untuk tampilan & filter kabupaten).
 */
@Entity("round_participants")
@Index("rp_uniq", ["roundId", "participantId"], { unique: true })
export class RoundParticipant {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "round_id", type: "uuid" })
  roundId!: string;

  @Column({ name: "participant_id", type: "uuid" })
  participantId!: string;

  @Column({ type: "text", default: "active" })
  status!: RoundParticipantStatus;

  /**
   * Poin bawaan gelombang. Untuk peserta gugur yang lanjut ke gelombang
   * susulan, diisi 50% poin akhir gelombang sebelumnya (total_points peserta
   * tak diubah). Ranking round = carry_points + poin vote round ini.
   */
  @Column({ name: "carry_points", type: "int", default: 0 })
  carryPoints!: number;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
