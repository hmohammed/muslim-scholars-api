import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    // Test files share one Postgres database, so run them one at a time.
    fileParallelism: false,
  },
});
