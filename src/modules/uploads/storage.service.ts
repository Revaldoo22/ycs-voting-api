import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomBytes } from "crypto";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { extname, join } from "path";
import { DepotService } from "./depot.service";

const LOCAL_DIR = "uploads";

/**
 * Penyimpanan file multi-driver (STORAGE_DRIVER):
 *   local (default) → ./uploads, diserve statis di /uploads/*
 *   s3              → bucket S3-compatible (MinIO/R2/Spaces/AWS)
 *   depot           → Depot media backend; DB simpan /api/media/:fileId
 *                     (URL permanen milik app — signed URL diminta segar
 *                     saat diakses, karena umurnya pendek)
 * put() mengembalikan URL publik file.
 */
@Injectable()
export class StorageService {
  private s3: S3Client | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly depot: DepotService,
  ) {}

  private get driver(): "local" | "s3" | "depot" {
    const d = this.config.get<string>("STORAGE_DRIVER", "local");
    return d === "s3" || d === "depot" ? d : "local";
  }

  private client(): S3Client {
    if (!this.s3) {
      const endpoint = this.config.get<string>("S3_ENDPOINT");
      this.s3 = new S3Client({
        region: this.config.get<string>("S3_REGION", "auto"),
        ...(endpoint ? { endpoint } : {}),
        forcePathStyle:
          this.config.get<string>("S3_FORCE_PATH_STYLE", "true") === "true",
        credentials: {
          accessKeyId: this.config.get<string>("S3_ACCESS_KEY", ""),
          secretAccessKey: this.config.get<string>("S3_SECRET_KEY", ""),
        },
      });
    }
    return this.s3;
  }

  /** Simpan file, balikan URL publiknya. */
  async put(buffer: Buffer, originalName: string, mimeType: string) {
    if (this.driver === "depot") {
      const { fileId } = await this.depot.upload(buffer, originalName, mimeType);
      return { key: fileId, url: `/api/media/${fileId}` };
    }

    const key = `${randomBytes(12).toString("hex")}${extname(originalName).toLowerCase()}`;

    if (this.driver === "local") {
      if (!existsSync(LOCAL_DIR)) mkdirSync(LOCAL_DIR, { recursive: true });
      writeFileSync(join(LOCAL_DIR, key), buffer);
      return { key, url: `/uploads/${key}` };
    }

    const bucket = this.config.get<string>("S3_BUCKET", "");
    if (!bucket) {
      throw new InternalServerErrorException(
        "Storage S3 belum dikonfigurasi (S3_BUCKET).",
      );
    }
    await this.client().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );

    const base =
      this.config.get<string>("S3_PUBLIC_URL") ??
      `${this.config.get<string>("S3_ENDPOINT", "")}/${bucket}`;
    return { key, url: `${base.replace(/\/+$/, "")}/${key}` };
  }
}
