import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request } from "express";
import { timingSafeEqual } from "crypto";

/** Guard integrasi server-ke-server: header X-Api-Key. */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>("INTEGRATION_API_KEY", "");
    if (!expected) {
      throw new UnauthorizedException(
        "Integrasi belum dikonfigurasi (INTEGRATION_API_KEY).",
      );
    }
    const req = context.switchToHttp().getRequest<Request>();
    const got = (req.headers["x-api-key"] as string) ?? "";
    const a = Buffer.from(expected);
    const b = Buffer.from(got);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException("API key salah.");
    }
    return true;
  }
}
