import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

export type NotificationType = "vote_rejected";

/**
 * Pemberitahuan untuk voter (mis. vote ditolak beserta alasannya).
 * Baris vote yang ditolak dihapus (hak vote kembali), jadi alasan
 * penolakan disimpan di sini agar voter tetap tahu kenapa & bisa vote ulang.
 */
@Entity("notifications")
export class Notification {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "profile_id", type: "uuid" })
  @Index("notif_profile")
  profileId!: string;

  @Column({ type: "text", default: "vote_rejected" })
  type!: NotificationType;

  @Column({ type: "text" })
  title!: string;

  @Column({ type: "text" })
  body!: string;

  /** Terisi saat voter membuka/menandai notifikasi ini sudah dibaca. */
  @Column({ name: "read_at", type: "timestamptz", nullable: true })
  readAt!: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
