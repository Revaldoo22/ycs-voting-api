import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from "typeorm";

export type Role = "admin" | "participant" | "voter";
export type CollegeIntent = "ya" | "tidak" | "ragu";

/**
 * Auth account. Admin & participant log in with phone + password.
 * Voters sign in with Google SSO (email) and complete the onboarding
 * wizard once (name, password, school, class, status, region, intent).
 */
@Entity("profiles")
export class Profile {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "text", nullable: true })
  name!: string | null;

  @Column({ name: "phone_number", type: "text", unique: true, nullable: true })
  phoneNumber!: string | null;

  /** SSO identity (Google). Unique per account. */
  @Column({ type: "text", unique: true, nullable: true })
  email!: string | null;

  /** Foto profil dari akun Google — di-refresh tiap login SSO. */
  @Column({ name: "avatar_url", type: "text", nullable: true })
  avatarUrl!: string | null;

  @Column({ name: "password_hash", type: "text", nullable: true })
  passwordHash!: string | null;

  @Column({ type: "text", default: "voter" })
  role!: Role;

  @Column({ name: "school_id", type: "uuid", nullable: true })
  schoolId!: string | null;

  // ---- Voter onboarding data -----------------------------------------
  /** Kelas: 10 | 11 | 12 | alumni. */
  @Column({ name: "voter_class", type: "text", nullable: true })
  voterClass!: string | null;

  /** Status: teman_sekolah | guru | keluarga | teman_luar. */
  @Column({ name: "voter_status", type: "text", nullable: true })
  voterStatus!: string | null;

  /** Kabupaten/kota asal — FK ke regions (sinkron dgn data admin). */
  @Column({ name: "region_id", type: "uuid", nullable: true })
  regionId!: string | null;

  /** Niat melanjutkan kuliah: ya | tidak | ragu. */
  @Column({ name: "college_intent", type: "text", nullable: true })
  collegeIntent!: CollegeIntent | null;

  // ---- Survey PMB (leads) --------------------------------------------
  /** Awareness Universitas STEKOM: belum_tahu | pernah_dengar | sudah_minat. */
  @Column({ name: "stekom_awareness", type: "text", nullable: true })
  stekomAwareness!: string | null;

  /** Sumber tahu STEKOM (diisi bila sudah tahu): mis. medsos, teman, iklan. */
  @Column({ name: "stekom_source", type: "text", nullable: true })
  stekomSource!: string | null;

  /** Waktu voter mengonfirmasi follow akun Univ STEKOM (sekali seumur event). */
  @Column({ name: "followed_at", type: "timestamptz", nullable: true })
  followedAt!: Date | null;

  /** Screenshot bukti follow (diverifikasi manual saat undian). */
  @Column({ name: "follow_proof_url", type: "text", nullable: true })
  followProofUrl!: string | null;

  /** True once the onboarding wizard has been completed. */
  @Column({ type: "boolean", default: false })
  onboarded!: boolean;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
