import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Max,
  Min,
  MinLength,
} from "class-validator";
import { JwtGuard } from "../../common/guards/jwt.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { ApiKeyGuard } from "../../common/guards/api-key.guard";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import type { JwtPayload } from "../../common/guards/jwt.guard";
import { RewardsService } from "./rewards.service";

// ------------------------------- DTO ---------------------------------

class CatalogDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  code!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  point_cost?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  key_cost?: number;

  @IsOptional()
  @IsIn(["item", "spin"])
  kind?: "item" | "spin";

  @IsOptional()
  @IsInt()
  @Min(0)
  spin_grant?: number;

  /** null = stok tidak dibatasi. */
  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsInt()
  sort_order?: number;
}

class CatalogPatchDto {
  @IsOptional() @IsString() @MaxLength(60) code?: string;
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsInt() @Min(0) point_cost?: number;
  @IsOptional() @IsInt() @Min(0) key_cost?: number;
  @IsOptional() @IsIn(["item", "spin"]) kind?: "item" | "spin";
  @IsOptional() @IsInt() @Min(0) spin_grant?: number;
  @IsOptional() @IsInt() @Min(0) stock?: number | null;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsInt() sort_order?: number;
}

class PrizeDto {
  @IsString() @MinLength(2) @MaxLength(60) code!: string;
  @IsString() @MinLength(1) @MaxLength(120) label!: string;
  @IsOptional() @IsInt() @Min(0) weight?: number;
  @IsOptional() @IsBoolean() is_empty?: boolean;
  @IsOptional() @IsInt() @Min(0) key_grant?: number;
  // null = tanpa batas, dan @IsOptional sudah mengizinkannya.
  @IsOptional() @IsInt() @Min(0) stock?: number | null;
  /** Batas jumlah AKUN penerima (mis. 41 orang), bukan jumlah keping. */
  @IsOptional() @IsInt() @Min(0) winner_quota?: number | null;
  /** Maksimal berapa kali satu akun boleh dapat hadiah ini. */
  @IsOptional() @IsInt() @Min(0) max_per_account?: number | null;
  /** Hadiah dijamin di titik spin acak (dipakai Kunci), bukan diundi. */
  @IsOptional() @IsBoolean() is_guaranteed?: boolean;
  @IsOptional() @IsInt() @Min(1) guarantee_min_spin?: number;
  @IsOptional() @IsInt() @Min(1) guarantee_max_spin?: number;
  /** Diberikan otomatis saat ambang poin / jumlah spin tercapai. */
  @IsOptional() @IsInt() @Min(0) auto_at_points?: number | null;
  @IsOptional() @IsInt() @Min(0) auto_at_spins?: number | null;
  @IsOptional() @IsString() @MaxLength(20) color?: string;
  /** URL gambar hadiah, hasil POST /upload. Kosongkan untuk menghapus. */
  @IsOptional() @IsString() @MaxLength(500) image_url?: string | null;
  @IsOptional() @IsBoolean() active?: boolean;
  /** Kunci mutlak: tak pernah keluar lewat jalur mana pun. Untuk grand prize. */
  @IsOptional() @IsBoolean() is_locked?: boolean;
  @IsOptional() @IsInt() sort_order?: number;
}

class PrizePatchDto extends PrizeDto {
  @IsOptional() @IsString() @MaxLength(60) declare code: string;
  @IsOptional() @IsString() @MaxLength(120) declare label: string;
}

class SpinOptionsDto {
  @IsOptional() @IsInt() @Min(0) spin_point_cost?: number;
  /** Harga diskon spin pertama tiap akun (sekali seumur akun). */
  @IsOptional() @IsInt() @Min(0) spin_first_cost?: number;
  /** Matikan seluruh roda spin di web kedua. */
  @IsOptional() @IsBoolean() spin_enabled?: boolean;
  @IsOptional() @IsBoolean() spin_bundle_enabled?: boolean;
  @IsOptional() @IsInt() @Min(1) spin_bundle_count?: number;
  @IsOptional() @IsInt() @Min(0) spin_bundle_bonus?: number;
}

class CreateClaimDto {
  @IsString() @MaxLength(200) email!: string;
  @IsUUID() spin_result_id!: string;
  @IsString() @MinLength(2) @MaxLength(100) name!: string;
  @IsString() @MinLength(2) @MaxLength(150) school!: string;
  @IsString() @MinLength(2) @MaxLength(100) region!: string;
  /** Nomor WA aktif; dinormalkan server jadi 08xxx. */
  @IsString() @MinLength(8) @MaxLength(30) contact!: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

class UpdateClaimDto {
  @IsIn(["pending", "approved", "rejected", "sent"])
  status!: "pending" | "approved" | "rejected" | "sent";

  /** Wajib saat menolak, supaya peserta tahu penyebabnya. */
  @IsOptional() @IsString() @MaxLength(300) admin_note?: string;
}

class SpinTargetDto {
  @IsOptional() @IsString() @MaxLength(200) email?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsString() @MinLength(2) @MaxLength(60) prize_code!: string;
  /** Spin ke-berapa. Kosong = spin berikutnya, kapan pun. */
  @IsOptional() @IsInt() @Min(1) at_spin?: number | null;
  @IsString() @MinLength(3) @MaxLength(200) reason!: string;
}

class AdjustPointsDto {
  @IsString()
  @MaxLength(200)
  email!: string;

  /** Boleh negatif untuk menarik kembali poin. */
  @IsInt()
  @Min(-1000000)
  @Max(1000000)
  points!: number;

  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason!: string;
}

class RedeemDto {
  @IsString() @MaxLength(160) email!: string;
  @IsString() @MaxLength(60) code!: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

class SpinDto {
  @IsString() @MaxLength(160) email!: string;
  @IsOptional() @IsIn(["single", "bundle"]) option?: "single" | "bundle";
}

class StatusDto {
  @IsIn(["pending", "done", "canceled"])
  status!: "pending" | "done" | "canceled";
}

/** Ubah payload snake_case dari API jadi field entity (camelCase). */
function toCatalogEntity(d: CatalogDto | CatalogPatchDto) {
  return {
    ...(d.code !== undefined && { code: d.code }),
    ...(d.name !== undefined && { name: d.name }),
    ...(d.description !== undefined && { description: d.description }),
    ...(d.point_cost !== undefined && { pointCost: d.point_cost }),
    ...(d.key_cost !== undefined && { keyCost: d.key_cost }),
    ...(d.kind !== undefined && { kind: d.kind }),
    ...(d.spin_grant !== undefined && { spinGrant: d.spin_grant }),
    ...(d.stock !== undefined && { stock: d.stock }),
    ...(d.active !== undefined && { active: d.active }),
    ...(d.sort_order !== undefined && { sortOrder: d.sort_order }),
  };
}

function toPrizeEntity(d: PrizeDto | PrizePatchDto) {
  return {
    ...(d.code !== undefined && { code: d.code }),
    ...(d.label !== undefined && { label: d.label }),
    ...(d.weight !== undefined && { weight: d.weight }),
    ...(d.is_empty !== undefined && { isEmpty: d.is_empty }),
    ...(d.key_grant !== undefined && { keyGrant: d.key_grant }),
    ...(d.stock !== undefined && { stock: d.stock }),
    ...(d.winner_quota !== undefined && { winnerQuota: d.winner_quota }),
    ...(d.max_per_account !== undefined && { maxPerAccount: d.max_per_account }),
    ...(d.is_guaranteed !== undefined && { isGuaranteed: d.is_guaranteed }),
    ...(d.guarantee_min_spin !== undefined && {
      guaranteeMinSpin: d.guarantee_min_spin,
    }),
    ...(d.guarantee_max_spin !== undefined && {
      guaranteeMaxSpin: d.guarantee_max_spin,
    }),
    ...(d.auto_at_points !== undefined && { autoAtPoints: d.auto_at_points }),
    ...(d.auto_at_spins !== undefined && { autoAtSpins: d.auto_at_spins }),
    ...(d.color !== undefined && { color: d.color }),
    ...(d.image_url !== undefined && {
      // String kosong dari form berarti "hapus gambar", bukan URL kosong.
      imageUrl: d.image_url?.trim() ? d.image_url.trim() : null,
    }),
    ...(d.active !== undefined && { active: d.active }),
    ...(d.is_locked !== undefined && { isLocked: d.is_locked }),
    ...(d.sort_order !== undefined && { sortOrder: d.sort_order }),
  };
}

// ----------------------------- Admin ---------------------------------

/**
 * Kelola sistem penukaran poin, hadiah spin, dan opsi spin. Dipakai panel
 * admin; UI penukarannya sendiri ada di web kedua (lihat controller
 * integrasi di bawah).
 */
@Controller("admin/rewards")
@UseGuards(JwtGuard, RolesGuard)
@Roles("admin")
export class RewardsAdminController {
  constructor(private readonly svc: RewardsService) {}

  /** Isi katalog & hadiah bawaan event (idempoten). */
  @Post("seed")
  seed() {
    return this.svc.seed();
  }

  // --- Katalog penukaran poin ---
  @Get("catalog")
  listCatalog() {
    return this.svc.listCatalog(true);
  }

  @Post("catalog")
  createCatalog(@Body() dto: CatalogDto) {
    return this.svc.createCatalog(
      toCatalogEntity(dto) as Parameters<RewardsService["createCatalog"]>[0],
    );
  }

  @Patch("catalog/:id")
  updateCatalog(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: CatalogPatchDto,
  ) {
    return this.svc.updateCatalog(id, toCatalogEntity(dto));
  }

  @Delete("catalog/:id")
  removeCatalog(@Param("id", ParseUUIDPipe) id: string) {
    return this.svc.removeCatalog(id);
  }

  /** Saldo satu akun, untuk halaman penyesuaian poin di admin. */
  @Get("balance/:email")
  adminBalance(@Param("email") email: string) {
    return this.svc.getBalance(email);
  }

  // --- Klaim hadiah ---

  /** Pengajuan klaim; `?status=` menyaring per tahap, `?email=` per akun. */
  @Get("claims")
  listClaims(@Query("status") status?: string, @Query("email") email?: string) {
    return this.svc.listClaims({ status, email });
  }

  /** Jumlah pengajuan per status, untuk tab di panel. */
  @Get("claims/counts")
  claimCounts() {
    return this.svc.claimCounts();
  }

  /** Setujui, tolak, atau tandai sudah dikirim. */
  @Patch("claims/:id")
  updateClaim(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateClaimDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.svc.updateClaim(id, dto, user?.name ?? user?.sub ?? null);
  }

  // --- Log spin ---

  /**
   * Riwayat permintaan spin dari web kedua: siapa, bayar berapa poin, dan
   * dapat hadiah apa saja. Satu baris = satu permintaan, bukan satu hadiah,
   * karena paket 5x+1 hanya sekali ditagih.
   */
  @Get("spin-log")
  spinLog(
    @Query("email") email?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    return this.svc.spinLog({
      email,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  /** Rekap berapa kali tiap hadiah sudah keluar dan ke berapa orang. */
  @Get("spin-tally")
  spinTally() {
    return this.svc.spinPrizeTally();
  }

  // --- Penandaan hadiah per akun ---

  /** Daftar penandaan; `?email=` / `?phone=` untuk satu akun. */
  @Get("spin-targets")
  listTargets(@Query("email") email?: string, @Query("phone") phone?: string) {
    return this.svc.listTargets({ email, phone });
  }

  /** Tandai satu akun supaya mendapat hadiah tertentu. */
  @Post("spin-targets")
  addTarget(@Body() dto: SpinTargetDto, @CurrentUser() user: JwtPayload) {
    return this.svc.addTarget({
      ...dto,
      created_by: user?.name ?? user?.sub ?? null,
    });
  }

  /** Batalkan penandaan yang belum terpakai. */
  @Delete("spin-targets/:id")
  removeTarget(@Param("id", ParseUUIDPipe) id: string) {
    return this.svc.removeTarget(id);
  }

  // --- Penyesuaian poin manual ---

  /** Riwayat penyesuaian; `?email=` untuk satu akun. */
  @Get("point-adjustments")
  listAdjustments(@Query("email") email?: string) {
    return this.svc.listAdjustments(email);
  }

  /** Tambah / kurangi saldo poin sebuah akun tanpa membuat vote. */
  @Post("point-adjustments")
  adjustPoints(@Body() dto: AdjustPointsDto, @CurrentUser() user: JwtPayload) {
    return this.svc.adjustPoints({
      email: dto.email,
      points: dto.points,
      reason: dto.reason,
      createdBy: user?.name ?? user?.sub ?? null,
    });
  }

  /** Batalkan satu penyesuaian; saldo kembali seperti sebelumnya. */
  @Delete("point-adjustments/:id")
  removeAdjustment(@Param("id", ParseUUIDPipe) id: string) {
    return this.svc.removeAdjustment(id);
  }

  // --- Hadiah spin ---
  @Get("prizes")
  listPrizes() {
    return this.svc.listPrizes(true);
  }

  @Post("prizes")
  createPrize(@Body() dto: PrizeDto) {
    return this.svc.createPrize(
      toPrizeEntity(dto) as Parameters<RewardsService["createPrize"]>[0],
    );
  }

  @Patch("prizes/:id")
  updatePrize(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: PrizePatchDto,
  ) {
    return this.svc.updatePrize(id, toPrizeEntity(dto));
  }

  @Delete("prizes/:id")
  removePrize(@Param("id", ParseUUIDPipe) id: string) {
    return this.svc.removePrize(id);
  }

  // --- Opsi spin (1x / 5x + bonus) ---
  @Get("spin-options")
  spinOptions() {
    return this.svc.getSpinOptions();
  }

  @Patch("spin-options")
  updateSpinOptions(@Body() dto: SpinOptionsDto) {
    return this.svc.updateSpinOptions(dto);
  }

  // --- Penukaran masuk ---
  @Get("redemptions")
  redemptions(@Query("email") email: string) {
    return this.svc.listRedemptions(email ?? "");
  }

  @Patch("redemptions/:id")
  setStatus(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: StatusDto,
  ) {
    return this.svc.setRedemptionStatus(id, dto.status);
  }
}

// -------------------------- Web kedua (API) ---------------------------

/**
 * Endpoint untuk web kedua (server-ke-server, header X-Api-Key). UI-nya
 * dibangun di sana; di sini hanya data dan aturan mainnya.
 *
 * Soal poin: poin = jumlah vote yang masuk untuk peserta pemilik email
 * (1 vote = 1 poin). Menukar poin TIDAK mengurangi jumlah vote, karena
 * vote adalah dasar peringkat lomba. Yang dicatat adalah "poin terpakai",
 * lalu saldo = poin dari vote dikurangi poin terpakai.
 */
@Controller("integrations/rewards")
@UseGuards(ApiKeyGuard)
export class RewardsIntegrationController {
  constructor(private readonly svc: RewardsService) {}

  /** Katalog penukaran yang aktif, untuk ditampilkan di web kedua. */
  @Get("catalog")
  catalog() {
    return this.svc.listCatalog();
  }

  /** Hadiah spin aktif beserta peluangnya (persen). */
  /**
   * Hadiah spin. Default hanya yang aktif (untuk digambar di roda).
   * `?all=1` menyertakan hadiah nonaktif juga, dipakai kalau web kedua ingin
   * menampilkan daftar lengkap termasuk Grand Prize yang belum dinyalakan.
   */
  @Get("prizes")
  prizes(@Query("all") all?: string) {
    return this.svc.listPrizes(all === "1" || all === "true");
  }

  /** Pilihan spin yang tersedia: 1x atau paket 5x + bonus. */
  @Get("spin-options")
  spinOptions() {
    return this.svc.getSpinOptions();
  }

  /** Saldo poin, kunci, dan jatah spin milik satu akun. */
  @Get("balance/:email")
  balance(@Param("email") email: string) {
    return this.svc.getBalance(email);
  }

  /**
   * Harga spin berikutnya untuk satu akun. Spin pertama tiap akun lebih
   * murah, jadi UI harus menanyakan ini alih-alih memakai harga tetap.
   */
  @Get("spin-price/:email")
  spinPrice(@Param("email") email: string) {
    return this.svc.getSpinPricing(email);
  }

  /** Tukar poin dengan satu item katalog. */
  @Post("redeem")
  redeem(@Body() dto: RedeemDto) {
    return this.svc.redeem(dto.email, dto.code, dto.note);
  }

  /** Riwayat penukaran satu akun. */
  @Get("redemptions/:email")
  redemptions(@Param("email") email: string) {
    return this.svc.listRedemptions(email);
  }

  /** Putar roda: option "single" (1x) atau "bundle" (5x + bonus). */
  @Post("spin")
  spin(@Body() dto: SpinDto) {
    return this.svc.spin(dto.email, dto.option ?? "single");
  }

  /**
   * Hadiah milik satu akun beserta status klaimnya. Dipakai web kedua
   * menampilkan "hadiah saya" dan tombol ajukan klaim.
   */
  @Get("my-prizes/:email")
  myPrizes(@Param("email") email: string) {
    return this.svc.myPrizes(email);
  }

  /** Ajukan klaim satu hadiah. */
  @Post("claims")
  createClaim(@Body() dto: CreateClaimDto) {
    return this.svc.createClaim(dto);
  }

  /** Semua pengajuan milik satu akun, terbaru dulu. */
  @Get("claims/:email")
  myClaims(@Param("email") email: string) {
    return this.svc.myClaims(email);
  }

  /**
   * Detail satu pengajuan. `?email=` wajib diisi email pemiliknya: tanpa itu
   * id yang bocor bisa dipakai mengintip data pengiriman orang lain.
   */
  @Get("claim/:id")
  claimDetail(
    @Param("id", ParseUUIDPipe) id: string,
    @Query("email") email: string,
  ) {
    return this.svc.getClaim(id, email);
  }

  /** Riwayat spin satu akun. */
  @Get("spins/:email")
  spins(@Param("email") email: string, @Query("limit") limit?: string) {
    return this.svc.listSpins(email, limit ? Number(limit) : 50);
  }
}
