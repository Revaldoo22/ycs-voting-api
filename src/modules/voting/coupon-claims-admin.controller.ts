import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from "class-validator";
import { DataSource, EntityManager } from "typeorm";
import { CouponClaim, Rejection } from "../../database/entities";
import { JwtGuard } from "../../common/guards/jwt.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { NotificationsService } from "./notifications.service";
import { CouponClaimsService } from "./coupon-claims.service";

class ReviewClaimDto {
  @IsIn(["approved", "rejected"])
  status!: "approved" | "rejected";

  /** Alasan penolakan, masuk ke notifikasi voter. */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

class BulkReviewClaimDto {
  @IsIn(["approved", "rejected"])
  status!: "approved" | "rejected";

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200, { message: "Maksimal 200 klaim per batch" })
  @IsUUID("4", { each: true })
  ids!: string[];
}

/**
 * Review klaim kupon undian (bukti follow), TERPISAH dari vote, vote selalu
 * langsung sukses. Approve = voter dapat kupon undian. Reject = baris klaim
 * DIHAPUS agar voter bisa klaim ulang dengan bukti yang benar.
 */
@Controller("admin/coupon-claims")
@UseGuards(JwtGuard, RolesGuard)
@Roles("admin")
export class CouponClaimsAdminController {
  constructor(
    private readonly db: DataSource,
    private readonly notifications: NotificationsService,
    private readonly couponClaims: CouponClaimsService,
  ) {}

  /**
   * Daftar klaim untuk direview. Pencarian dilakukan di SQL (bukan filter di
   * browser) karena hasilnya dibatasi 500 baris: tanpa ini, voter di luar 500
   * terbaru tak akan pernah ketemu walau namanya diketik di kotak cari.
   */
  @Get()
  list(@Query("status") status?: string, @Query("search") search?: string) {
    const q = search?.trim() || null;
    return this.db.query(
      `select cc.id, cc.status, cc.proofs, cc.created_at, cc.reviewed_at,
              pr.id as profile_id, pr.name as voter_name, pr.email as voter_email,
              pr.phone_number as voter_phone
       from coupon_claims cc
       join profiles pr on pr.id = cc.profile_id
       where ($1::text is null or cc.status = $1)
         and ($2::text is null or (
              pr.name ilike '%' || $2 || '%'
           or pr.email ilike '%' || $2 || '%'
           or pr.phone_number ilike '%' || $2 || '%'
         ))
       order by cc.created_at desc
       limit 500`,
      [status || null, q],
    );
  }

  /** Riwayat penolakan (arsip). Baris asli sudah dihapus saat ditolak. */
  @Get("rejections")
  rejections(@Query("search") search?: string) {
    const q = search?.trim() || null;
    return this.db.query(
      `select r.id, r.reason, r.voter_name, r.voter_email, r.voter_phone,
              coalesce(r.proofs, '[]'::jsonb) as proofs,
              r.submitted_at as created_at, r.created_at as rejected_at,
              'rejected' as status, null::uuid as profile_id,
              null::timestamptz as reviewed_at
       from rejections r
       where r.kind = $1
         and ($2::text is null or (
              r.voter_name ilike '%' || $2 || '%'
           or r.voter_email ilike '%' || $2 || '%'
           or r.voter_phone ilike '%' || $2 || '%'
           or r.voter_school ilike '%' || $2 || '%'
         ))
       order by r.created_at desc
       limit 500`,
      ["coupon_claim", q],
    );
  }

  @Get("counts")
  async counts() {
    const rows = await this.db.query(
      // rejected TIDAK dari coupon_claims: baris klaim dihapus saat ditolak,
      // jejaknya ada di arsip rejections.
      `select
         (select count(*) filter (where status = 'pending')
            from coupon_claims)::int as pending,
         (select count(*) filter (where status = 'approved')
            from coupon_claims)::int as approved,
         (select count(*) from rejections
            where kind = 'coupon_claim')::int as rejected`,
    );
    return rows[0];
  }

  @Patch(":id")
  async review(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ReviewClaimDto,
  ) {
    return this.db.transaction(async (em) => {
      const result = await this.reviewOne(em, id, dto.status, dto.reason);
      if (!result) throw new NotFoundException("Klaim tidak ditemukan.");
      return result;
    });
  }

  /** Review massal (approve/tolak banyak sekaligus) dalam satu transaksi. */
  @Post("bulk")
  async bulk(@Body() dto: BulkReviewClaimDto) {
    return this.db.transaction(async (em) => {
      let processed = 0;
      for (const id of dto.ids) {
        if (await this.reviewOne(em, id, dto.status, dto.reason)) processed++;
      }
      return { ok: true, processed };
    });
  }

  /** Inti review satu klaim. Return null bila klaim tak ditemukan. */
  private async reviewOne(
    em: EntityManager,
    id: string,
    status: "approved" | "rejected",
    reason?: string,
  ) {
    const claim = await em
      .getRepository(CouponClaim)
      .createQueryBuilder("cc")
      .setLock("pessimistic_write")
      .where("cc.id = :id", { id })
      .getOne();
    if (!claim) return null;

    const profile = await em.query(
      `select name, email, phone_number from profiles where id = $1`,
      [claim.profileId],
    );
    const voter = profile[0] as
      | { name: string | null; email: string | null; phone_number: string | null }
      | undefined;

    if (status === "rejected") {
      // Hapus baris → voter bisa klaim ulang dengan bukti yang benar.
      const alasan = reason?.trim()
        ? ` Alasan: ${reason.trim()}.`
        : " Bukti follow tidak sesuai.";
      await this.notifications.notifyByVoter(
        em,
        { email: voter?.email, phone: voter?.phone_number },
        {
          type: "coupon_claim_rejected",
          title: "Klaim kupon kamu ditolak",
          body:
            `Klaim kupon undian handphone kamu belum bisa kami terima.${alasan}` +
            " Kamu bisa klaim lagi dengan bukti yang benar.",
        },
      );
      // Arsipkan dulu: baris klaim hilang setelah ini, jadi tanpa arsip
      // penolakan tak punya jejak yang bisa ditinjau admin.
      await em.getRepository(Rejection).insert({
        kind: "coupon_claim",
        reason: reason?.trim() || null,
        voterName: voter?.name ?? null,
        voterEmail: voter?.email ?? null,
        voterPhone: voter?.phone_number ?? null,
        proofs: claim.proofs ?? null,
        submittedAt: claim.createdAt,
      });

      await em.getRepository(CouponClaim).delete({ id });
      return { ok: true, removed: true };
    }

    // Approve: idempoten kalau sudah approved sebelumnya.
    if (claim.status === "approved") return { ok: true };
    claim.status = "approved";
    claim.reviewedAt = new Date();
    await em.getRepository(CouponClaim).save(claim);
    const code = await this.couponClaims.grantCoupon(em, claim.profileId);

    await this.notifications.notifyByVoter(
      em,
      { email: voter?.email, phone: voter?.phone_number },
      {
        type: "coupon_claim_approved",
        title: "Selamat! Kupon undian kamu terbit",
        body: `Klaim kupon kamu disetujui. Kode kuponmu: ${code}. Cek di menu Kupon Saya.`,
      },
    );
    return { ok: true };
  }
}
