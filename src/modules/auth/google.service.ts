import {
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export interface GoogleUser {
  email: string;
  name: string | null;
  picture: string | null;
}

/**
 * Minimal Google OAuth2 (authorization-code flow) without extra deps.
 * The callback URL goes through the Next proxy (same-origin), so the
 * session cookie set afterwards Just Works.
 */
@Injectable()
export class GoogleService {
  constructor(private readonly config: ConfigService) {}

  private get clientId() {
    return this.config.get<string>("GOOGLE_CLIENT_ID", "");
  }
  private get clientSecret() {
    return this.config.get<string>("GOOGLE_CLIENT_SECRET", "");
  }
  private get redirectUri() {
    return this.config.get<string>(
      "GOOGLE_CALLBACK_URL",
      "http://localhost:3000/api/auth/google/callback",
    );
  }

  get configured(): boolean {
    return !!this.clientId && !!this.clientSecret;
  }

  authUrl(state?: string): string {
    if (!this.configured) {
      throw new InternalServerErrorException(
        "Google SSO belum dikonfigurasi (GOOGLE_CLIENT_ID/SECRET).",
      );
    }
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: "code",
      scope: "openid email profile",
      prompt: "select_account",
      ...(state ? { state } : {}),
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  /** Exchange the authorization code for the user's identity. */
  async exchange(code: string): Promise<GoogleUser> {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: this.redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const token = (await tokenRes.json()) as {
      access_token?: string;
      error_description?: string;
    };
    if (!tokenRes.ok || !token.access_token) {
      throw new UnauthorizedException(
        token.error_description ?? "Login Google gagal.",
      );
    }

    const infoRes = await fetch(
      "https://openidconnect.googleapis.com/v1/userinfo",
      { headers: { Authorization: `Bearer ${token.access_token}` } },
    );
    const info = (await infoRes.json()) as {
      email?: string;
      name?: string;
      picture?: string;
    };
    if (!infoRes.ok || !info.email) {
      throw new UnauthorizedException("Tidak bisa membaca akun Google.");
    }
    return {
      email: info.email.toLowerCase(),
      name: info.name ?? null,
      picture: info.picture ?? null,
    };
  }
}
