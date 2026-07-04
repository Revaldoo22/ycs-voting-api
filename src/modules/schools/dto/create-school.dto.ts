import { IsString, MaxLength, MinLength } from "class-validator";

export class CreateSchoolDto {
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name!: string;
}
