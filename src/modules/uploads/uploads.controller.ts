import {
  BadRequestException,
  Controller,
  HttpException,
  InternalServerErrorException,
  Logger,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Request } from "express";
import { memoryStorage } from "multer";
import { JwtGuard } from "../../common/guards/jwt.guard";
import { rateLimit } from "../../common/utils/rate-limit";
import { ipHashFromRequest } from "../../common/utils/server-hash";
import { StorageService } from "./storage.service";

const ALLOWED = /\.(jpe?g|png|webp|gif)$/i;

const interceptor = () =>
  FileInterceptor("file", {
    storage: memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => cb(null, ALLOWED.test(file.originalname)),
  });

/** Upload gambar → StorageService (lokal atau S3-compatible, via env). */
@Controller()
export class UploadsController {
  private readonly logger = new Logger(UploadsController.name);

  constructor(private readonly storage: StorageService) {}

  private async store(file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException(
        "File tidak valid (jpg/png/webp/gif, maks 5MB).",
      );
    }
    try {
      const { url } = await this.storage.put(
        file.buffer,
        file.originalname,
        file.mimetype,
      );
      return { ok: true, url };
    } catch (e) {
      // Galat tak terduga dari storage (jaringan putus, DNS, TLS) muncul
      // sebagai "Internal server error" polos yang tak bisa didiagnosis.
      // Sebabnya dibawa ke pesan, dan dicatat ke log server berikut namanya.
      if (e instanceof HttpException) throw e;
      const sebab = e instanceof Error ? e.message : String(e);
      this.logger.error(
        `Upload gagal: ${file.originalname} (${file.mimetype}, ${file.size}B): ${sebab}`,
      );
      throw new InternalServerErrorException(`Upload gagal: ${sebab}`);
    }
  }

  /** Authenticated upload (admin & participant photos, quest ref images). */
  @Post("upload")
  @UseGuards(JwtGuard)
  @UseInterceptors(interceptor())
  upload(@UploadedFile() file?: Express.Multer.File) {
    return this.store(file);
  }

  /** Anonymous voter proof upload, rate-limited per IP instead of auth. */
  @Post("upload-proof")
  @UseInterceptors(interceptor())
  uploadProof(@Req() req: Request, @UploadedFile() file?: Express.Multer.File) {
    const ipKey = ipHashFromRequest(req) ?? "noip";
    if (!rateLimit(`upload:${ipKey}`, 30, 60_000)) {
      throw new HttpException(
        { error: "Terlalu banyak unggahan. Coba lagi sebentar." },
        429,
      );
    }
    return this.store(file);
  }
}
