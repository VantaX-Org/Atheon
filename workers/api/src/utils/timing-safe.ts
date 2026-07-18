// Constant-time string comparison — no early return on length or byte mismatch,
// so compare duration doesn't leak how much of a secret was guessed correctly.
// Used to gate setup-secret routes; mirrors the inline check in index.ts.
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  let mismatch = ab.length !== bb.length ? 1 : 0;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) {
    mismatch |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return mismatch === 0;
}
