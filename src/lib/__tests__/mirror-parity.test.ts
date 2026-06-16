// Byte-parity guard for every src/lib module mirrored into workers/api/src/lib.
// The worker cannot import from repo src/, so each shared module is copied. This
// test (root node runner — full FS access, unlike the workers-pool sandbox)
// fails if a mirror drifts from its canonical copy by even one byte (incl.
// comments + helper function bodies, which a shape-only compare would miss).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(__dirname, '../../..');
function assertMirror(relPath: string) {
  const canonical = readFileSync(resolve(repoRoot, 'src/lib', relPath), 'utf8');
  const mirror = readFileSync(resolve(repoRoot, 'workers/api/src/lib', relPath), 'utf8');
  expect(mirror).toBe(canonical);
}

describe('src/lib ↔ workers/api/src/lib mirror parity', () => {
  it('ingest-manifest.ts is byte-identical', () => {
    assertMirror('ingest-manifest.ts');
  });

  it('ingest-validate.ts is byte-identical', () => {
    assertMirror('ingest-validate.ts');
  });

  it('finding-charts.ts is byte-identical', () => {
    assertMirror('finding-charts.ts');
  });
});
