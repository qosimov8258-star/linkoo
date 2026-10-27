import "server-only"

import { createHmac } from "node:crypto"

import bcrypt from "bcryptjs"

const SALT_ROUNDS = 12

// bcrypt only reads the first 72 bytes of its input (36 Cyrillic letters), so a
// longer password with another tail would still match. Passwords are therefore
// pre-hashed first: HMAC-SHA256 (fixed key, which keeps these digests apart from
// plain SHA-256 hashes leaked elsewhere) → base64, 44 characters that cover the
// whole password, then bcrypt. Such hashes are stored with this prefix; a hash
// without it is a legacy one (bcrypt of the raw password), still accepted, and
// replaced at the next sign-in (app/api/auth/login). Changing the key or the
// prefix makes every stored password invalid.
const PREHASH_PREFIX = "$sha256-bcrypt$"
const PREHASH_KEY = "linko:password:v1"
const BCRYPT_INPUT_BYTES = 72

function prehash(password: string): string {
  return createHmac("sha256", PREHASH_KEY).update(password, "utf8").digest("base64")
}

export async function hashPassword(password: string): Promise<string> {
  return PREHASH_PREFIX + (await bcrypt.hash(prehash(password), SALT_ROUNDS))
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (hash.startsWith(PREHASH_PREFIX)) return bcrypt.compare(prehash(password), hash.slice(PREHASH_PREFIX.length))
  return bcrypt.compare(password, hash)
}

/** True for a hash made before the pre-hash scheme (only the first 72 bytes count). */
export function isLegacyHash(hash: string): boolean {
  return !hash.startsWith(PREHASH_PREFIX)
}

/** True when a password that matched a legacy hash is certainly the stored one:
 * shorter than 72 bytes (bcrypt adds a NUL byte, so 72 bytes are already cut)
 * and without NUL bytes. A longer one may differ from the stored password after
 * byte 72, so it must not simply be re-hashed. */
export function legacyMatchIsExact(password: string): boolean {
  return Buffer.byteLength(password, "utf8") < BCRYPT_INPUT_BYTES && !password.includes("\u0000")
}
