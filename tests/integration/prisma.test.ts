import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { createTrackedPool, trackPrismaClient } from '@mosaic-code/pg-source-comments';
import { FindingKind, checkIndexes, resetCapture } from '../../src/index.js';
import { TEST_DATABASE_URL, connectTestClient } from './helpers.js';

const options = { connectionString: TEST_DATABASE_URL };

describe('with Prisma and pg-source-comments', () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = await connectTestClient();
    // Matches tests/prisma/schema.prisma: no index on customer_id
    await client.query('DROP TABLE IF EXISTS invoices');
    await client.query('CREATE TABLE invoices (id serial PRIMARY KEY, customer_id int NOT NULL)');
  });

  afterAll(async () => {
    await client.query('DROP TABLE IF EXISTS invoices');
    await client.end();
  });

  it('reports the source location of a Prisma query on an unindexed column', async () => {
    const pool = createTrackedPool(TEST_DATABASE_URL);
    const prisma = trackPrismaClient(new PrismaClient({ adapter: new PrismaPg(pool) }));

    try {
      await resetCapture(options);
      await prisma.invoice.findMany({ where: { customerId: 1 } });
    } finally {
      await prisma.$disconnect();
      await pool.end();
    }

    const { findings } = await checkIndexes(options);

    expect(findings).toEqual([
      expect.objectContaining({
        kind: FindingKind.SEQ_SCAN_FILTER,
        table: 'public.invoices',
        hint: 'CREATE INDEX ON public.invoices (customer_id)',
        sourceLocation: expect.stringMatching(/^tests\/integration\/prisma\.test\.ts:\d+$/),
      }),
    ]);
  });
});
