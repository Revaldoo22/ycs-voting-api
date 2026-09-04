import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from "class-validator";

/** Edit akun voter, WA & foto tidak termasuk (identitas & Google). */
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: "Nama minimal 2 karakter" })
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsUUID()
  school_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  school_name?: string;

  /**
   * String bebas, bukan @IsIn daftar dropdown. Onboarding mengizinkan kelas
   * manual seperti "XII Akuntansi 2"; kalau di sini dibatasi 4 pilihan, voter
   * dengan kelas manual tak bisa menyimpan perubahan apa pun di halaman Akun
   * karena class lamanya ikut terkirim dan ditolak.
   */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  class?: string;

  @IsOptional()
  @IsIn(["teman_sekolah", "guru", "keluarga", "teman_luar"], {
    message: "Pilih status",
  })
  status?: string;

  @IsOptional()
  @IsUUID(undefined, { message: "Pilih kabupaten" })
  region_id?: string;

  @IsOptional()
  @IsIn(["ya", "tidak", "ragu"], { message: "Pilih niat kuliah" })
  college_intent?: "ya" | "tidak" | "ragu";
}
