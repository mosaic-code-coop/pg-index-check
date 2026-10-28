import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    // Tests share one database and read pg_stat_statements, so run files serially
    fileParallelism: false,
  },
});
