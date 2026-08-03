import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  MaxLength,
} from "class-validator";

/**
 * Identitas voter. TIDAK lagi dikirim klien — server mengisinya dari akun
 * login (SSO + wizard). Dibiarkan opsional agar body lama tetap diterima,
 * tapi nilainya selalu ditimpa nilai dari profil sesi.
 */
export class VoterInfoDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone_number?: string;

  @IsOptional()
  @IsEmail({}, { message: "Email tidak valid" })
  @MaxLength(150)
  email?: string;

  @IsOptional()
  @IsIn(["teman_sekolah", "guru", "keluarga", "teman_luar", "peserta"])
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  school?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  class?: string;
}

export class CastVoteDto extends VoterInfoDto {
  @IsUUID()
  participant_id!: string;

  /** Tak dipakai lagi untuk anti-cheat (dedup murni by email/WA). Opsional. */
  @IsOptional()
  @IsString()
  fingerprint?: string;

  /** Voter menyatakan sudah follow 2 saluran WhatsApp (gate vote pertama). */
  @IsOptional()
  follow_confirmed?: boolean;

  /** Screenshot bukti follow saluran WhatsApp (array URL, boleh banyak). */
  @IsOptional()
  follow_proofs?: string[] | Record<string, string>;
}

/** Klaim kupon undian (follow akun Univ STEKOM/TopLoker), terpisah dari vote. */
export class ClaimCouponDto {
  @IsArray()
  @ArrayMinSize(1, { message: "Lampirkan minimal 1 bukti follow" })
  @ArrayMaxSize(12, { message: "Maksimal 12 bukti follow" })
  @IsUrl({ require_tld: false }, { each: true, message: "Bukti follow tidak valid" })
  proofs!: string[];
}

export class CreateSubmissionDto extends VoterInfoDto {
  @IsUUID()
  participant_id!: string;

  @IsUUID()
  quest_id!: string;

  @IsArray()
  @ArrayMinSize(1, { message: "Lampirkan minimal 1 bukti" })
  @ArrayMaxSize(5, { message: "Maksimal 5 bukti" })
  @IsUrl({ require_tld: false }, { each: true, message: "Bukti tidak valid" })
  proof_urls!: string[];

  @IsOptional()
  @IsUUID()
  content_id?: string;
}
