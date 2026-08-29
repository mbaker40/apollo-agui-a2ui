import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    globalSetup: ['./src/global-setup.ts'],
    // Scenarios share one executor store and run as a scripted conversation —
    // strictly in order, one file at a time.
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 20_000,
    hookTimeout: 90_000,
  },
});
