/** Keep digits only; convert leading 62 to 0 (Indonesian numbers). */
export function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, "");
  if (digits.startsWith("62")) return "0" + digits.slice(2);
  return digits;
}

/**
 * Canonical form of a proof link for de-duplication — mirrors the old
 * normalize_link() SQL: lowercase, strip protocol/www/query/fragment/trailing /.
 */
export function normalizeLink(url: string): string {
  let s = url.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
  const cut = s.search(/[?#]/);
  if (cut >= 0) s = s.slice(0, cut);
  return s.replace(/\/+$/, "");
}

/** Generate a human-friendly participant password (STK-XXXX-XXXX). */
export function generatePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(8);
  require("crypto").webcrypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += chars[b % chars.length];
  return `STK-${out.slice(0, 4)}-${out.slice(4)}`;
}
