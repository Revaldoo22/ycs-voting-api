import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from "class-validator";

/** Edit akun voter — WA & foto tidak termasuk (identitas & Google). */
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

  @IsOptional()
  @IsIn(["10", "11", "12", "alumni"], { message: "Pilih kelas" })
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
