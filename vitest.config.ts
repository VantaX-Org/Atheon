import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'workers/**/*.test.ts'],
    exclude: ['workers/api/src/__tests__/auth.test.ts', 'workers/api/src/__tests__/catalysts.test.ts', 'workers/api/src/__tests__/smoke.test.ts', 'node_modules/**'],
    coverage: {
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}', 'workers/**/*.ts'],
      exclude: ['**/*.test.*', '**/*.d.ts', '**/index.ts'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
