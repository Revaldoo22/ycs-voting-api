import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

/** scrypt hash stored as `salt:hash` hex. No external dep; swap for argon2/bcrypt later. */
export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(plain, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(plain: string, stored: string | null): boolean {
  if (!stored || !stored.includes(":")) return false;
  const [saltHex, hashHex] = stored.split(":");
  const hash = Buffer.from(hashHex, "hex");
  const test = scryptSync(plain, Buffer.from(saltHex, "hex"), 64);
  return hash.length === test.length && timingSafeEqual(hash, test);
}
