import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    // Worker-side tests live in `workers/api/` and depend on `cloudflare:test`
    // (plus other `cloudflare:*` virtual modules) which only resolve inside the
    // dedicated `@cloudflare/vitest-pool-workers` runner — invoked by the
    // "Backend Tests" CI job via `cd workers/api && vitest run`. Including them
    // in the root runner made every PR fail CI with "cannot resolve
    // cloudflare:test".
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['workers/**', 'node_modules/**'],
    coverage: {
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['**/*.test.*', '**/*.d.ts', '**/index.ts'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
