import { createHash } from "crypto";
import type { Request } from "express";

const SALT = process.env.HASH_SALT ?? "idola-stekom";

function sha(input: string): string {
  return createHash("sha256").update(`${SALT}:${input}`).digest("hex");
}

/** Coarse device hint from UA + accept-language (secondary anti-cheat signal). */
export function serverHashFromRequest(req: Request): string | null {
  const ua = req.headers["user-agent"] ?? "";
  const lang = req.headers["accept-language"] ?? "";
  if (!ua) return null;
  return sha(`${ua}|${lang}`);
}

/** Salted hash of the caller IP — never stores the raw IP. */
export function ipHashFromRequest(req: Request): string | null {
  const fwd = (req.headers["x-forwarded-for"] as string) ?? "";
  const ip = fwd.split(",")[0]?.trim() || req.socket?.remoteAddress || "";
  if (!ip) return null;
  return sha(ip);
}
