import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

export type PmbJobStatus = "running" | "stopped" | "done";

/**
 * Satu baris per RUN backfill kirim tracking ke PMB (bisa berjam-jam,
 * ribuan data). Berjalan sebagai background job di server (bukan
 * request-response biasa) supaya tidak tergantung tab admin tetap terbuka.
 * Progress disimpan di DB (bukan cuma memory) supaya bertahan lintas
 * restart proses & bisa dipoll dari halaman admin.
 */
@Entity("pmb_tracking_jobs")
@Index("pmb_job_status", ["status"])
export class PmbTrackingJob {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "text", default: "running" })
  status!: PmbJobStatus;

  /** Filter yang dipakai saat job dimulai (untuk ditampilkan di histori). */
  @Column({ name: "filter_intent", type: "text", nullable: true })
  filterIntent!: string | null;

  @Column({ name: "filter_awareness", type: "text", nullable: true })
  filterAwareness!: string | null;

  /** Kalau true, kirim ulang meski profil sudah pernah pmb_tracked_at. */
  @Column({ type: "boolean", default: false })
  force!: boolean;

  /** Berapa data dikirim sekaligus (paralel) per batch. */
  @Column({ name: "batch_size", type: "int", default: 1 })
  batchSize!: number;

  /** Jeda antar BATCH (bukan antar data) dalam milidetik. */
  @Column({ name: "delay_ms", type: "int", default: 1000 })
  delayMs!: number;

  @Column({ type: "int", default: 0 })
  total!: number;

  @Column({ type: "int", default: 0 })
  processed!: number;

  @Column({ type: "int", default: 0 })
  ok!: number;

  @Column({ type: "int", default: 0 })
  fail!: number;

  @Column({ type: "int", default: 0 })
  skipped!: number;

  /** Admin yang memulai job, disimpan sebagai teks agar histori tetap terbaca. */
  @Column({ name: "started_by", type: "text", nullable: true })
  startedBy!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}

/**
 * Satu baris per DATA yang diproses dalam sebuah job, supaya admin bisa
 * melihat persis siapa yang sukses/gagal dan pesan error-nya (bukan cuma
 * angka total).
 */
@Entity("pmb_tracking_job_items")
@Index("pmb_job_item_job", ["jobId"])
export class PmbTrackingJobItem {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "job_id", type: "uuid" })
  jobId!: string;

  @Column({ name: "profile_id", type: "uuid" })
  profileId!: string;

  @Column({ type: "text", nullable: true })
  name!: string | null;

  @Column({ type: "text" })
  status!: "ok" | "fail" | "skipped";

  @Column({ type: "text", nullable: true })
  error!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
