// Test-only helpers for the R2b-2 password-user suites (not imported by
// production code). Low-entropy fake values only (gitleaks).
import { createHmac } from "node:crypto";

export const GOOD_PASSWORD = "correct horse battery staple";
export const OTHER_PASSWORD = "another sturdy passphrase here";
export const TOTP_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
export const TENANT = "11111111-1111-4111-8111-111111111111";
export const FOREIGN_TENANT = "22222222-2222-4222-8222-222222222222";
export const ENTRA_ISSUER = `https://login.microsoftonline.com/${TENANT}/v2.0`;

const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function b32(s: string): Buffer {
  let bits = "";
  for (const ch of s) bits += A.indexOf(ch).toString(2).padStart(5, "0");
  const out: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8)
    out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}

// RFC 6238 code (SHA-1, 6 digits, 30 s step) computed independently of the
// production module so the suites do not rely on it to verify itself.
export function totpAt(at: Date, secret: string = TOTP_SECRET): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at.getTime() / 30000)));
  const h = createHmac("sha1", b32(secret)).update(counter).digest();
  const o = (h[19] ?? 0) & 0xf;
  const n =
    (((h[o] ?? 0) & 0x7f) << 24) |
    (((h[o + 1] ?? 0) & 0xff) << 16) |
    (((h[o + 2] ?? 0) & 0xff) << 8) |
    ((h[o + 3] ?? 0) & 0xff);
  return String(n % 1_000_000).padStart(6, "0");
}

// The KMS envelope boundary (`@/lib/auth/secret-envelope`) is mocked with this
// reversible fake: ciphertext never contains the plaintext.
export const fakeEnvelope = {
  encryptSecret: async (plain: string): Promise<string> =>
    `ct:${Buffer.from([...plain].reverse().join("")).toString("base64")}`,
  decryptSecret: async (cipher: string): Promise<string> =>
    [...Buffer.from(cipher.slice(3), "base64").toString()].reverse().join(""),
};
