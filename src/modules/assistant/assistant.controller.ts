import { Body, Controller, Get, Query, UseGuards } from "@nestjs/common";
import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { Post } from "@nestjs/common";
import { JwtGuard } from "../../common/guards/jwt.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { AssistantService } from "./assistant.service";

class TurnDto {
  @IsIn(["user", "assistant"])
  role!: "user" | "assistant";

  @IsString()
  @MaxLength(2000)
  content!: string;
}

class AskDto {
  /** Path halaman admin yang sedang dibuka, mis. "/admin/poin". */
  @IsString()
  @MaxLength(200)
  path!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(2000)
  message!: string;

  /** Beberapa pesan terakhir, supaya pertanyaan lanjutan tetap nyambung. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TurnDto)
  history?: TurnDto[];
}

/**
 * Asisten penjelas fitur, khusus panel admin.
 *
 * Dijaga JwtGuard + peran admin: isi jawabannya menjelaskan cara kerja
 * internal sistem, termasuk aturan hadiah dan penilaian, yang tidak perlu
 * diketahui publik.
 */
@Controller("admin/assistant")
@UseGuards(JwtGuard, RolesGuard)
@Roles("admin")
export class AssistantController {
  constructor(private readonly svc: AssistantService) {}

  /** Konteks halaman + pertanyaan saran yang sesuai halaman itu. */
  @Get("context")
  context(@Query("path") path?: string) {
    return this.svc.pageContext(path ?? "/admin");
  }

  @Post("ask")
  ask(@Body() dto: AskDto) {
    return this.svc.ask({
      path: dto.path,
      message: dto.message,
      history: dto.history,
    });
  }
}
