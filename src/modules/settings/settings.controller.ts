import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { SettingsService } from "./settings.service";
import { JwtGuard } from "../../common/guards/jwt.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";

class UpdateSettingsDto {
  @IsOptional()
  @IsBoolean()
  event_open?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  closed_message?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  ip_daily_limit?: number;
}

@Controller()
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  /** Public — the frontend gates overlays (maintenance/closed) with this. */
  @Get("public/settings")
  get() {
    return this.settings.getPublic();
  }

  /** Old path parity: POST /api/admin/settings. */
  @Post("admin/settings")
  @UseGuards(JwtGuard, RolesGuard)
  @Roles("admin")
  update(@Body() dto: UpdateSettingsDto) {
    return this.settings.update(dto);
  }
}
