import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['server/**/*.test.ts'],
    globals: true,
    testTimeout: 10000,
    hookTimeout: 10000,
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});