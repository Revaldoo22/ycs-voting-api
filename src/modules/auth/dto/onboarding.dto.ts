import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";
// region ditentukan dari kode BPS kabupaten (regency_code) sekolah terpilih.

export class OnboardingDto {
  @IsString()
  @MinLength(2, { message: "Nama minimal 2 karakter" })
  @MaxLength(100)
  name!: string;

  /** Vote identity is keyed by WhatsApp number, so we collect it here. */
  @IsString()
  @MinLength(8, { message: "Nomor WhatsApp minimal 8 digit" })
  @MaxLength(20)
  @Matches(/^[0-9+\-\s().]+$/, { message: "Nomor WhatsApp tidak valid" })
  phone_number!: string;

  @IsOptional()
  @IsUUID()
  school_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  school_name?: string;

  /** Kelas: wajib untuk siswa (10/11/12/alumni), bebas/opsional utk guru/keluarga. */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  class?: string;

  @IsIn(["teman_sekolah", "guru", "keluarga", "teman_luar"], {
    message: "Pilih status",
  })
  status!: string;

  /** Kode BPS kabupaten (regency) asal — dari sekolah terpilih. */
  @IsOptional()
  @IsString()
  @MaxLength(10)
  region_code?: string;

  @IsIn(["ya", "tidak", "ragu"], { message: "Pilih niat kuliah" })
  college_intent!: "ya" | "tidak" | "ragu";
}
