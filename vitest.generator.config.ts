import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/generator/**/*.test.ts'],
    testTimeout: 600_000,
  },
});
