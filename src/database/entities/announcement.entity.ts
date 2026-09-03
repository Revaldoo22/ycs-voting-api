import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

/**
 * Riwayat satu kali kirim pengumuman massal. Notifikasi per akun tersimpan di
 * tabel notifications; tabel ini menyimpan satu baris per PENGIRIMAN, supaya
 * admin bisa melihat apa yang pernah dikirim, ke berapa akun, dan berapa
 * banyak tautannya diklik.
 */
@Entity("announcements")
@Index("announcement_created", ["createdAt"])
export class Announcement {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "text" })
  title!: string;

  @Column({ type: "text" })
  body!: string;

  /** Jumlah akun yang benar-benar dikirimi (setelah dedupe). */
  @Column({ name: "sent_count", type: "int", default: 0 })
  sentCount!: number;

  /** true = hanya ke akun yang belum jadi peserta. */
  @Column({ name: "only_non_participants", type: "boolean", default: true })
  onlyNonParticipants!: boolean;

  /** Admin yang mengirim, disimpan sebagai teks agar riwayat tetap terbaca. */
  @Column({ name: "sent_by", type: "text", nullable: true })
  sentBy!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}

/**
 * Satu baris per klik tautan di pengumuman. Sengaja tidak unik per akun:
 * jumlah klik total dan jumlah akun unik dua-duanya berguna, jadi keduanya
 * dihitung dari baris-baris ini.
 */
@Entity("announcement_clicks")
@Index("announcement_click_ann", ["announcementId"])
export class AnnouncementClick {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "announcement_id", type: "uuid" })
  announcementId!: string;

  /** Akun yang mengklik. Null bila sesi tak dikenali. */
  @Column({ name: "profile_id", type: "uuid", nullable: true })
  profileId!: string | null;

  /** URL yang diklik, untuk membedakan bila pesan memuat beberapa tautan. */
  @Column({ type: "text" })
  url!: string;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
