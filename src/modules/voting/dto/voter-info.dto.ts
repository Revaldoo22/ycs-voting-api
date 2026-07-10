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

  /** Voter menyatakan sudah follow akun Univ STEKOM (gate vote pertama). */
  @IsOptional()
  follow_confirmed?: boolean;

  /** Screenshot bukti follow (kontrak lama — masih diterima). */
  @IsOptional()
  @IsUrl({ require_tld: false }, { message: "Bukti follow tidak valid" })
  follow_proof_url?: string;

  /** Bukti follow per tugas: screenshot follow Instagram Univ STEKOM. */
  @IsOptional()
  @IsUrl({ require_tld: false }, { message: "Bukti follow IG tidak valid" })
  follow_proof_ig?: string;

  /** Bukti follow per tugas: screenshot follow TikTok Univ STEKOM. */
  @IsOptional()
  @IsUrl({ require_tld: false }, { message: "Bukti follow TikTok tidak valid" })
  follow_proof_tiktok?: string;
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
