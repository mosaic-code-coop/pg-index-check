import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { FindingKind, IndexCheckError, assertIndexes, checkIndexes, resetCapture } from '../../src/index.js';
import { tableLeadingColumns } from '../../src/explain.js';
import { TEST_DATABASE_URL, connectTestClient, createOrdersTable, serverMajorVersion } from './helpers.js';

const options = { connectionString: TEST_DATABASE_URL };

describe('checkIndexes', () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = await connectTestClient();
    await createOrdersTable(client);
  });

  afterAll(async () => {
    await client.query('DROP TABLE IF EXISTS orders');
    await client.end();
  });

  beforeEach(async () => {
    await resetCapture(options);
  });

  it('passes queries an index can serve, even on a tiny table', async () => {
    await client.query('SELECT * FROM orders WHERE id = $1', [1]);
    await client.query('SELECT * FROM orders WHERE org_id = $1 ORDER BY created_at', [1]);

    const result = await checkIndexes(options);

    expect(result.statementCount).toBe(2);
    expect(result.findings).toEqual([]);
  });

  it('reads the leading column of each btree index on a table', async () => {
    // orders has the primary key on id and orders_org_created_idx on (org_id, created_at)
    const leading = await tableLeadingColumns(client, ['public.orders']);

    expect(leading.get('public.orders')).toEqual(new Set(['id', 'org_id']));
  });

  it('does not flag a filter whose column leads an index, even if the planner walks another index', async () => {
    await client.query('CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status)');
    try {
      // ORDER BY id nudges the planner toward the primary key; status still has a usable index
      await client.query('SELECT * FROM orders WHERE status = $1 ORDER BY id DESC LIMIT 1', ['open']);

      const { findings } = await checkIndexes(options);

      expect(findings).toEqual([]);
    } finally {
      await client.query('DROP INDEX IF EXISTS orders_status_idx');
    }
  });

  it('flags a filter on an unindexed column with a CREATE INDEX hint', async () => {
    await client.query('SELECT * FROM orders WHERE customer_id = $1', [1]);

    const { findings } = await checkIndexes(options);

    expect(findings).toEqual([
      expect.objectContaining({
        kind: FindingKind.SEQ_SCAN_FILTER,
        table: 'public.orders',
        statement: 'SELECT * FROM orders WHERE customer_id = $1',
        hint: 'CREATE INDEX ON public.orders (customer_id)',
      }),
    ]);
  });

  it('flags an UPDATE and a DELETE filtering on an unindexed column', async () => {
    await client.query('UPDATE orders SET status = $1 WHERE customer_id = $2', ['open', -1]);
    await client.query('DELETE FROM orders WHERE customer_id = $1', [-1]);

    const { findings } = await checkIndexes(options);

    expect(findings.map((finding) => finding.kind)).toEqual([
      FindingKind.SEQ_SCAN_FILTER,
      FindingKind.SEQ_SCAN_FILTER,
    ]);
  });

  it('flags walking the primary key to filter on an unindexed column', async () => {
    await client.query('SELECT * FROM orders WHERE status = $1 ORDER BY id LIMIT 10', ['open']);

    const { findings } = await checkIndexes(options);

    expect(findings).toEqual([
      expect.objectContaining({ kind: FindingKind.FULL_INDEX_SCAN, indexName: 'orders_pkey' }),
    ]);
  });

  it('ignores <> filters, inserts and DDL', async () => {
    await client.query('SELECT * FROM orders WHERE status <> $1', ['closed']);
    await client.query('INSERT INTO orders (org_id, customer_id, status) VALUES ($1, $2, $3)', [9, 9, 'x']);
    await client.query('CREATE TABLE IF NOT EXISTS ddl_probe (id int)');
    await client.query('DROP TABLE ddl_probe');

    const result = await checkIndexes(options);

    expect(result.statementCount).toBe(1);
    expect(result.findings).toEqual([]);
  });

  it('flags a condition on a trailing composite column before PostgreSQL 18 only', async () => {
    await client.query('SELECT * FROM orders WHERE created_at = $1', [new Date()]);

    const { findings } = await checkIndexes(options);

    const expected =
      (await serverMajorVersion(client)) < 18
        ? [expect.objectContaining({ kind: FindingKind.TRAILING_INDEX_COLUMN, indexName: 'orders_org_created_idx' })]
        : [];
    expect(findings).toEqual(expected);
  });

  it('fails on unplannable statements by default, or reports them when configured', async () => {
    await client.query('CREATE TABLE dropped_table (id int)');
    await client.query('SELECT * FROM dropped_table WHERE id = $1', [1]);
    await client.query('DROP TABLE dropped_table');

    const failing = await checkIndexes(options);
    const reporting = await checkIndexes({ ...options, unplannable: 'report' });

    expect(failing.findings).toEqual([
      expect.objectContaining({
        kind: FindingKind.UNPLANNABLE,
        error: 'relation "dropped_table" does not exist',
      }),
    ]);
    expect(reporting.findings).toEqual([]);
    expect(reporting.reported).toHaveLength(1);
  });

  it('suppresses findings matched by an ignore rule and reports stale rules', async () => {
    await client.query('SELECT * FROM orders WHERE customer_id = $1', [1]);
    const ignore = [
      { table: 'public.orders', reason: 'small lookup table' },
      { table: /^public\.never_queried$/, reason: 'stale' },
    ];

    const result = await checkIndexes({ ...options, ignore });

    expect(result.findings).toEqual([]);
    expect(result.staleIgnoreRules).toEqual([ignore[1]]);
  });

  it('attaches the source location from a pg-source-comments comment', async () => {
    await client.query('SELECT /* src/orders.ts:42 */ * FROM orders WHERE customer_id = $1', [1]);

    const { findings } = await checkIndexes(options);

    expect(findings[0].sourceLocation).toBe('src/orders.ts:42');
  });

  it('assertIndexes throws a readable report', async () => {
    await client.query('SELECT * FROM orders WHERE customer_id = $1', [1]);

    const error = await assertIndexes(options).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(IndexCheckError);
    expect((error as IndexCheckError).message).toContain('fix: CREATE INDEX ON public.orders (customer_id)');
  });

  it('leaves enable_seqscan untouched for other sessions', async () => {
    await client.query('SELECT * FROM orders WHERE id = $1', [1]);

    await checkIndexes(options);

    const setting = await client.query<{ enable_seqscan: string }>('SHOW enable_seqscan');
    expect(setting.rows[0].enable_seqscan).toBe('on');
  });

  it('only checks statements from the current database', async () => {
    await client.query('DROP DATABASE IF EXISTS pg_index_check_other');
    await client.query('CREATE DATABASE pg_index_check_other');
    const otherUrl = TEST_DATABASE_URL.replace(/\/[^/]+$/, '/pg_index_check_other');
    const otherClient = await connectTestClient(otherUrl);

    try {
      await otherClient.query('CREATE TABLE other_orders (customer_id int)');
      await otherClient.query('SELECT * FROM other_orders WHERE customer_id = $1', [1]);
      await client.query('SELECT * FROM orders WHERE id = $1', [1]);

      const result = await checkIndexes(options);

      expect(result.statementCount).toBe(1);
      expect(result.findings).toEqual([]);
    } finally {
      await otherClient.end();
      await client.query('DROP DATABASE pg_index_check_other');
    }
  });

  it('throws when no statements were captured', async () => {
    await expect(checkIndexes(options)).rejects.toThrow('no statements were captured');
  });

  it('throws when pg_stat_statements is not installed', async () => {
    await client.query('DROP EXTENSION pg_stat_statements');

    try {
      await expect(checkIndexes(options)).rejects.toThrow('pg_stat_statements extension is not installed');
    } finally {
      await client.query('CREATE EXTENSION pg_stat_statements');
    }
  });
});
