import { describe, it, expect } from 'vitest';
// The workers-pool sandbox cannot readFileSync outside workers/api, so we
// compare the exported manifests structurally instead of byte-for-byte. The
// canonical src/lib copy and this worker mirror are kept identical by hand;
// the JSON.stringify comparison fails loudly if they ever diverge in shape.
import { INGEST_MANIFEST as mirror } from '../lib/ingest-manifest';
import { INGEST_MANIFEST as canonical } from '../../../../src/lib/ingest-manifest';

describe('ingest-manifest mirror parity', () => {
  it('worker mirror matches src/lib canonical', () => {
    expect(JSON.stringify(mirror)).toBe(JSON.stringify(canonical));
  });
});
