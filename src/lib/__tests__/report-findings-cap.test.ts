import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('client PDF finding cap removed', () => {
  it('report-generators no longer slices findings to 25', () => {
    const src = readFileSync(resolve(__dirname, '../report-generators.ts'), 'utf8');
    expect(src).not.toMatch(/\.slice\(0,\s*25\)/);
    expect(src).not.toMatch(/and \$\{findings\.length - 25\} more findings/);
  });
});
