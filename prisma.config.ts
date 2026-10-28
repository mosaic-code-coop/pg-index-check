import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'tests/prisma/schema.prisma',
  datasource: {
    url: process.env.TEST_DATABASE_URL ?? 'postgresql://test:test@localhost:5434/test',
  },
});
