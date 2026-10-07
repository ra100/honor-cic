import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 1500 },
  worker: { format: 'es' },
  test: { include: ['tests/**/*.test.ts'], environment: 'node', testTimeout: 30_000 },
});
