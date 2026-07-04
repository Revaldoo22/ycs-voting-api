import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

export class CreateParticipantDto {
  @IsString()
  @MinLength(2, { message: "Nama peserta minimal 2 karakter" })
  @MaxLength(100)
  name!: string;

  /** Pick an existing school… */
  @IsOptional()
  @IsUUID()
  school_id?: string;

  /** …or type a new one (find-or-create, case-insensitive). */
  @IsOptional()
  @IsString()
  @MaxLength(150)
  school_name?: string;

  @IsString()
  @MinLength(8, { message: "Nomor WhatsApp minimal 8 digit" })
  @MaxLength(20)
  @Matches(/^[0-9+\-\s().]+$/, { message: "Nomor WhatsApp tidak valid" })
  phone_number!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  photo_url?: string;
}

export class UpdateParticipantDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsUUID()
  school_id?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  school_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @IsOptional()
  photo_url?: string | null;

  @IsOptional()
  @IsIn(["active", "inactive"])
  status?: "active" | "inactive";

  @IsOptional()
  @IsBoolean()
  reset_password?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(72)
  new_password?: string;
}
