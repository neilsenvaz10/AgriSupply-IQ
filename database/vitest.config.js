import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
    setupFiles: ['./src/test/setup.js'],
    restoreMocks: true,
    // Integration tests talk to one real database: run test files one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
