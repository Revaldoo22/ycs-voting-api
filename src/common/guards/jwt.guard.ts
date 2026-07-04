import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Request } from "express";

export interface JwtPayload {
  sub: string; // profile id
  role: string;
  name?: string;
}

export const AUTH_COOKIE = "idola_token";

/**
 * Verifies the JWT from the httpOnly cookie (browser flow) or the
 * Authorization: Bearer header (API clients) and attaches it as req.user.
 */
@Injectable()
export class JwtGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const bearer = req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice("Bearer ".length)
      : null;
    const cookie =
      (req as Request & { cookies?: Record<string, string> }).cookies?.[
        AUTH_COOKIE
      ] ?? null;
    const token = bearer ?? cookie;
    if (!token) throw new UnauthorizedException("Sesi tidak valid.");
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      (req as Request & { user: JwtPayload }).user = payload;
      return true;
    } catch {
      throw new UnauthorizedException("Sesi tidak valid.");
    }
  }
}
