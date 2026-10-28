import type { Client } from 'pg';
import type { PlanNode } from './types.js';

export type ExplainOutcome = { plan: PlanNode } | { error: string };

/**
 * Makes the planner treat sequential scans as a last resort for this session,
 * so any sequential scan left in a plan is one no index can replace
 */
export async function preparePlanningSession(client: Client): Promise<void> {
  await client.query('SET enable_seqscan = off');
}

/**
 * Plans a statement with placeholders ($1, ...) left in place. Sent without bound
 * values (simple query protocol), which EXPLAIN (GENERIC_PLAN) requires.
 */
export async function explainStatement(client: Client, statement: string): Promise<ExplainOutcome> {
  try {
    const result = await client.query<{ 'QUERY PLAN': [{ Plan: PlanNode }] }>(
      `EXPLAIN (GENERIC_PLAN, VERBOSE, FORMAT JSON) ${statement}`
    );
    return { plan: result.rows[0]['QUERY PLAN'][0].Plan };
  } catch (error) {
    // Recorded as an UNPLANNABLE finding, which fails by default
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Server major version, e.g. 16
 */
export async function serverMajorVersion(client: Client): Promise<number> {
  const result = await client.query<{ server_version_num: string }>('SHOW server_version_num');
  return Math.floor(Number(result.rows[0].server_version_num) / 10000);
}

/**
 * Leading column of each btree index, keyed by `schema.index`. Expression indexes
 * have no leading column and are omitted.
 */
export async function leadingIndexColumns(client: Client, indexKeys: string[]): Promise<Map<string, string>> {
  if (indexKeys.length === 0) {
    return new Map();
  }

  const result = await client.query<{ index_key: string; column_name: string }>(
    `
    SELECT n.nspname || '.' || c.relname AS index_key, a.attname AS column_name
    FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_am am ON am.oid = c.relam
    JOIN pg_catalog.pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
    WHERE am.amname = 'btree' AND n.nspname || '.' || c.relname = ANY($1)
    `,
    [indexKeys]
  );

  return new Map(result.rows.map((row) => [row.index_key, row.column_name]));
}
