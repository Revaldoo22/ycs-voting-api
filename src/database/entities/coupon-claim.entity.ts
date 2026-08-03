import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

export type CouponClaimStatus = "pending" | "approved" | "rejected";

/**
 * Klaim kupon undian handphone oleh voter (follow akun Univ STEKOM/TopLoker +
 * upload bukti), TERPISAH dari vote itu sendiri. Vote selalu langsung sukses;
 * klaim ini yang direview admin sebelum kupon diterbitkan. Satu profil hanya
 * bisa punya satu klaim (unique profileId) — reject menghapus baris agar
 * voter bisa klaim ulang dengan bukti yang benar.
 */
@Entity("coupon_claims")
@Index("coupon_claim_uniq_profile", ["profileId"], { unique: true })
export class CouponClaim {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "profile_id", type: "uuid" })
  profileId!: string;

  @Column({ type: "text", default: "pending" })
  @Index("coupon_claim_status")
  status!: CouponClaimStatus;

  /** Screenshot bukti follow (array URL). */
  @Column({ type: "jsonb" })
  proofs!: string[];

  @Column({ name: "reviewed_at", type: "timestamptz", nullable: true })
  reviewedAt!: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
