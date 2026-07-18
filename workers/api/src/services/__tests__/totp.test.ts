/**
 * TOTP verification tests — auth-critical. verifyTOTP gates step-up MFA and
 * high-risk action handlers, so a broken base32 decode, HMAC, or skew window
 * either locks everyone out or accepts stale codes.
 *
 * The generator below is an INDEPENDENT HOTP implementation (not shared with
 * the code under test) so a bug can't hide by being symmetric. RFC 6238 test
 * vectors pin the algorithm against the spec; the live-time cases pin the
 * ±1-step skew window verifyTOTP actually uses.
 */
import { describe, it, expect } from 'vitest';
import { verifyTOTP } from '../totp';

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_CHARS[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_CHARS[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(secret: string): Uint8Array {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of secret.toUpperCase()) {
    const idx = BASE32_CHARS.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
}

/** Independent HOTP for an explicit counter — the RFC 4226 dynamic truncation. */
async function hotp(secretBase32: string, counter: number): Promise<string> {
  const keyData = base32Decode(secretBase32);
  const buf = new ArrayBuffer(8);
  new DataView(buf).setUint32(4, counter, false);
  const key = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const hmac = new Uint8Array(await crypto.subtle.sign('HMAC', key, buf));
  const off = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[off] & 0x7f) << 24) |
    ((hmac[off + 1] & 0xff) << 16) |
    ((hmac[off + 2] & 0xff) << 8) |
    (hmac[off + 3] & 0xff);
  return (bin % 1000000).toString().padStart(6, '0');
}

// RFC 6238 seed: ASCII "12345678901234567890".
const RFC_SECRET = base32Encode(new TextEncoder().encode('12345678901234567890'));

function codeForTime(secret: string, unixSeconds: number): Promise<string> {
  return hotp(secret, Math.floor(unixSeconds / 30));
}

describe('verifyTOTP', () => {
  it('rejects malformed input without touching crypto', async () => {
    expect(await verifyTOTP('', '123456')).toBe(false);
    expect(await verifyTOTP(RFC_SECRET, '')).toBe(false);
    expect(await verifyTOTP(RFC_SECRET, '12345')).toBe(false); // too short
    expect(await verifyTOTP(RFC_SECRET, '1234567')).toBe(false); // too long
  });

  it('accepts the current-step code (base32 decode + HMAC-SHA1 correct)', async () => {
    const now = Math.floor(Date.now() / 1000);
    expect(await verifyTOTP(RFC_SECRET, await codeForTime(RFC_SECRET, now))).toBe(true);
  });

  it('tolerates +/-1 step of clock skew, rejects beyond it', async () => {
    const now = Math.floor(Date.now() / 1000);
    expect(await verifyTOTP(RFC_SECRET, await codeForTime(RFC_SECRET, now - 30))).toBe(true);
    expect(await verifyTOTP(RFC_SECRET, await codeForTime(RFC_SECRET, now + 30))).toBe(true);
    // 2 steps out (±60s) is outside the window.
    expect(await verifyTOTP(RFC_SECRET, await codeForTime(RFC_SECRET, now - 90))).toBe(false);
    expect(await verifyTOTP(RFC_SECRET, await codeForTime(RFC_SECRET, now + 90))).toBe(false);
  });

  it('rejects a valid-format code for the wrong secret', async () => {
    const now = Math.floor(Date.now() / 1000);
    const otherSecret = base32Encode(new TextEncoder().encode('09876543210987654321'));
    const wrong = await codeForTime(otherSecret, now);
    // Guard against the ~1-in-1e6 collision where both secrets share a code.
    const right = await codeForTime(RFC_SECRET, now);
    if (wrong !== right) expect(await verifyTOTP(RFC_SECRET, wrong)).toBe(false);
  });

  it('lowercase / whitespace-free base32 secret still decodes', async () => {
    const now = Math.floor(Date.now() / 1000);
    const code = await codeForTime(RFC_SECRET, now);
    expect(await verifyTOTP(RFC_SECRET.toLowerCase(), code)).toBe(true);
  });
});
