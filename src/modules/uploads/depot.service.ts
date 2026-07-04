import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * Klien Depot (media backend STEKOM) — pola broker:
 * presign → PUT bytes langsung ke S3 → complete. API server Depot tidak
 * pernah dilewati bytes. Signed URL pendek umurnya, jadi DB kita hanya
 * menyimpan fileId (dibungkus /api/media/:id).
 */
@Injectable()
export class DepotService {
  constructor(private readonly config: ConfigService) {}

  private get base(): string {
    const host = this.config.get<string>("DEPOT_BASE_URL", "");
    if (!host) {
      throw new InternalServerErrorException(
        "Depot belum dikonfigurasi (DEPOT_BASE_URL).",
      );
    }
    return `${host.replace(/\/+$/, "")}/api/v1`;
  }

  private get headers() {
    return {
      Authorization: `Bearer ${this.config.get<string>("DEPOT_API_KEY", "")}`,
    };
  }

  /** fetch + backoff untuk 429 (plane /v1 rate-limited per key). */
  private async call(path: string, init: RequestInit = {}, tries = 3) {
    for (let i = 0; ; i++) {
      const res = await fetch(`${this.base}${path}`, {
        ...init,
        headers: { ...this.headers, ...init.headers },
      });
      if (res.status !== 429 || i >= tries - 1) return res;
      await new Promise((r) => setTimeout(r, 2 ** i * 500));
    }
  }

  /** Upload penuh: presign → PUT ke S3 → complete. Balikan fileId. */
  async upload(buffer: Buffer, name: string, mime: string) {
    const presignRes = await this.call("/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mime, size: buffer.length }),
    });
    if (!presignRes.ok) {
      throw new InternalServerErrorException(
        `Depot presign gagal (${presignRes.status}).`,
      );
    }
    const { fileId, uploadUrl } = (await presignRes.json()) as {
      fileId: number | string;
      uploadUrl: string;
    };

    // Bytes langsung ke S3 — URL sudah bertanda tangan, tanpa header auth.
    const putRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": mime },
      body: new Uint8Array(buffer),
    });
    if (!putRes.ok) {
      throw new InternalServerErrorException(
        `Upload ke storage gagal (${putRes.status}).`,
      );
    }

    const completeRes = await this.call(`/uploads/${fileId}/complete`, {
      method: "POST",
    });
    if (!completeRes.ok) {
      throw new InternalServerErrorException(
        `Depot complete gagal (${completeRes.status}).`,
      );
    }
    return { fileId: String(fileId) };
  }

  /** Signed URL segar (short-lived) — jangan disimpan. */
  async signedUrl(
    fileId: string,
    opts: { variant?: string; download?: boolean } = {},
  ): Promise<string> {
    const qs = new URLSearchParams();
    if (opts.variant) qs.set("variant", opts.variant);
    if (opts.download) qs.set("download", "1");
    const res = await this.call(
      `/files/${fileId}/url${qs.size ? `?${qs}` : ""}`,
    );
    if (res.status === 404) {
      throw new NotFoundException("File tidak ditemukan.");
    }
    if (!res.ok) {
      throw new InternalServerErrorException(
        `Depot url gagal (${res.status}).`,
      );
    }
    const { url } = (await res.json()) as { url: string };
    return url;
  }
}
