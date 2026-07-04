import {
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  RawBodyRequest,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request, Response } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { DepotService } from "./depot.service";

/**
 * /api/media/:fileId — URL permanen milik app untuk file Depot.
 * Tiap akses minta signed URL segar lalu 302 (signed URL short-lived,
 * tidak boleh dipersist / di-cache lama).
 */
@Controller("media")
export class MediaController {
  constructor(private readonly depot: DepotService) {}

  @Get(":fileId")
  async serve(
    @Param("fileId") fileId: string,
    @Res() res: Response,
    @Query("variant") variant?: string,
    @Query("download") download?: string,
  ) {
    const url = await this.depot.signedUrl(fileId, {
      variant: variant || undefined,
      download: !!download,
    });
    res.setHeader("Cache-Control", "private, max-age=60");
    return res.redirect(302, url);
  }
}

/** Penerima webhook Depot (file.ready / file.failed) — HMAC-verified. */
@Controller("hooks")
export class DepotHooksController {
  constructor(private readonly config: ConfigService) {}

  @Post("depot")
  @HttpCode(200)
  handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers("x-webhook-signature") signature: string,
    @Headers("x-webhook-event") event: string,
    @Headers("x-webhook-delivery") delivery: string,
  ) {
    const secret = this.config.get<string>("DEPOT_WEBHOOK_SECRET", "");
    const raw = req.rawBody;
    if (!secret || !raw || !signature) {
      throw new UnauthorizedException();
    }
    const expected = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException();
    }

    // Saat ini cukup dicatat — /api/media fallback ke original bila varian
    // belum siap, jadi tidak ada state yang wajib diubah. Titik sambung
    // untuk notifikasi/penandaan di masa depan.
     
    console.log(`[depot] ${event} delivery=${delivery}`);
    return { ok: true };
  }
}
