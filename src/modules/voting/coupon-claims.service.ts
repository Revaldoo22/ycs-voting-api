import { ConflictException, Injectable, OnModuleInit } from "@nestjs/common";
import { DataSource } from "typeorm";
import { Coupon, CouponClaim, Profile } from "../../database/entities";

/** Coded errors the controller maps to user-facing messages. */
export class ClaimError extends ConflictException {
  constructor(public readonly code: string) {
    super(code);
  }
}

/** Batas jumlah screenshot bukti follow per klaim. */
export const MAX_CLAIM_PROOFS = 12;

/**
 * Klaim kupon undian (follow akun Univ STEKOM/TopLoker), terpisah dari vote.
 * Karena DB_SYNC=false di produksi, tabelnya di-provision idempoten saat boot
 * (gaya raw-SQL codebase ini), tak perlu migrasi.
 */
@Injectable()
export class CouponClaimsService implements OnModuleInit {
  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit() {
    await this.dataSource.query(`
      create table if not exists coupon_claims (
        id uuid primary key default gen_random_uuid(),
        profile_id uuid not null,
        status text not null default 'pending',
        proofs jsonb not null,
        reviewed_at timestamptz,
        created_at timestamptz not null default now()
      )
    `);
    await this.dataSource.query(
      `create unique index if not exists coupon_claim_uniq_profile on coupon_claims (profile_id)`,
    );
    await this.dataSource.query(
      `create index if not exists coupon_claim_status on coupon_claims (status)`,
    );
  }

  /** Status klaim voter ini (null bila belum pernah klaim). */
  async myClaim(profileId: string) {
    return this.dataSource
      .getRepository(CouponClaim)
      .findOneBy({ profileId });
  }

  /**
   * Ajukan klaim kupon (follow + bukti). Peserta YCS tak perlu klaim, sudah
   * dapat kupon otomatis saat vote. Idempoten: klaim yang sudah ada
   * (pending/approved) dikembalikan apa adanya, tak dibuat dobel.
   */
  async claim(profileId: string, proofs: unknown) {
    const profile = await this.dataSource
      .getRepository(Profile)
      .findOneBy({ id: profileId });
    if (!profile) throw new ClaimError("LOGIN_REQUIRED");

    // Sudah pernah follow-confirm (mis. sebagai peserta YCS) → tak perlu klaim.
    if (profile.followedAt) throw new ClaimError("ALREADY_FOLLOWED");

    const existing = await this.dataSource
      .getRepository(CouponClaim)
      .findOneBy({ profileId });
    if (existing) throw new ClaimError("CLAIM_EXISTS");

    const rawList: unknown[] = Array.isArray(proofs) ? proofs : [];
    const urls = [
      ...new Set(
        rawList.filter(
          (u): u is string =>
            typeof u === "string" &&
            u.length <= 500 &&
            /^https?:\/\/.+/i.test(u),
        ),
      ),
    ];
    if (urls.length < 1) throw new ClaimError("CLAIM_PROOF_REQUIRED");
    if (urls.length > MAX_CLAIM_PROOFS) {
      throw new ClaimError("CLAIM_PROOF_TOOMANY");
    }

    try {
      return await this.dataSource
        .getRepository(CouponClaim)
        .save({ profileId, proofs: urls, status: "pending" });
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        throw new ClaimError("CLAIM_EXISTS");
      }
      throw err;
    }
  }

  /**
   * Terbitkan kupon undian (idempoten) untuk profil yang follow-nya
   * diverifikasi. Return kode kupon (kupon baru ATAU yang sudah ada bila
   * dipanggil dua kali karena race, tetap satu kode per profil+source).
   */
  async grantCoupon(
    em: import("typeorm").EntityManager,
    profileId: string,
  ): Promise<string> {
    await em.getRepository(Profile).update(
      { id: profileId },
      { followedAt: new Date() },
    );
    const code =
      "YCS-" +
      Array.from({ length: 2 }, () =>
        Math.random().toString(36).slice(2, 6).toUpperCase(),
      ).join("-");
    await em
      .getRepository(Coupon)
      .createQueryBuilder()
      .insert()
      .values({ profileId, code, source: "follow" })
      .orIgnore() // unique (profile, source): idempoten
      .execute();
    const existing = await em
      .getRepository(Coupon)
      .findOneBy({ profileId, source: "follow" });
    return existing?.code ?? code;
  }
}
