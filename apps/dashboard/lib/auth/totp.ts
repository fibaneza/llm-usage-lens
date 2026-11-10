import { createHmac, timingSafeEqual } from "node:crypto";

// Source: docs/specs/2026-11-10-access-control.md — "Sign-in methods" (master
// user TOTP); RFC 6238 (SHA-1, 6 digits, 30 s step, ±1 step window).
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;

export function base32Decode(input: string): Uint8Array {
  const clean = input.replace(/=+$/, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error("Invalid base32 character");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

function hotp(key: Uint8Array, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", key).update(buf).digest();
  const o = (h[h.length - 1] ?? 0) & 0xf;
  const n =
    (((h[o] ?? 0) & 0x7f) << 24) |
    ((h[o + 1] ?? 0) << 16) |
    ((h[o + 2] ?? 0) << 8) |
    (h[o + 3] ?? 0);
  return String(n % 1_000_000).padStart(6, "0");
}

export function verifyTotp(secret: string, code: string, now: Date): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  let key: Uint8Array;
  try {
    key = base32Decode(secret);
  } catch {
    return false;
  }
  const counter = Math.floor(now.getTime() / 1000 / STEP_SECONDS);
  const given = Buffer.from(code);
  let ok = false;
  for (const delta of [-1, 0, 1]) {
    if (counter + delta < 0) continue;
    const expected = Buffer.from(hotp(key, counter + delta));
    if (timingSafeEqual(expected, given)) ok = true;
  }
  return ok;
}
