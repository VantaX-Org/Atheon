import { createHmac } from 'node:crypto';

/**
 * Standard RFC-6238 TOTP (SHA-1, 30s step, 6 digits) from a base32 seed.
 * Mirrors e2e/fixtures/real-login.ts so the verification gate can complete a
 * real MFA challenge exactly as the browser suite does — same algorithm, same
 * seed format. Lives here (not shared) because the two suites have separate
 * tsconfigs and must not import across package boundaries.
 */
export function generateTotp(seed: string, step = 30, digits = 6): string {
  const key = base32Decode(seed);
  let counter = Math.floor(Date.now() / 1000 / step);
  const buf = Buffer.alloc(8);
  for (let i = 7; i >= 0; i--) {
    buf[i] = counter & 0xff;
    counter = Math.floor(counter / 256);
  }
  const hmac = createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (bin % 10 ** digits).toString().padStart(digits, '0');
}

function base32Decode(b32: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = b32.replace(/=+$/, '').replace(/\s/g, '').toUpperCase();
  let bits = '';
  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) continue;
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}
