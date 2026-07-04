import { IsIn, IsOptional, IsString, MinLength } from "class-validator";

export class LoginDto {
  /** Full name OR WhatsApp number. */
  @IsString()
  @MinLength(2)
  identifier!: string;

  @IsString()
  @MinLength(1)
  password!: string;

  /** When the login page targets a specific role, reject mismatches. */
  @IsOptional()
  @IsIn(["admin", "participant"])
  expected_role?: "admin" | "participant";
}
