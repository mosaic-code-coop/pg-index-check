import type { Client } from 'pg';
import { isCheckableStatement } from './statement-text.js';

const SETUP_HELP =
  'Add pg_stat_statements to shared_preload_libraries (e.g. `postgres -c shared_preload_libraries=pg_stat_statements`) ' +
  'and call resetCapture() before the test suite runs.';

/**
 * Installs pg_stat_statements in the current database (if needed) and clears it,
 * so only statements run after this point are checked
 */
export async function resetCapturedStatements(client: Client): Promise<void> {
  await client.query('CREATE EXTENSION IF NOT EXISTS pg_stat_statements');
  await client.query('SELECT pg_stat_statements_reset()');
}

/**
 * Reads the distinct statements recorded for the current database since the last reset
 */
export async function readCapturedStatements(client: Client): Promise<string[]> {
  const installed = await client.query(
    "SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'pg_stat_statements'"
  );
  if (installed.rowCount === 0) {
    throw new Error(`pg-index-check: the pg_stat_statements extension is not installed. ${SETUP_HELP}`);
  }

  const captured = await client.query<{ query: string }>(`
    SELECT s.query
    FROM pg_stat_statements s
    JOIN pg_catalog.pg_database d ON d.oid = s.dbid
    WHERE d.datname = current_database() AND s.toplevel
  `);

  const statements = captured.rows.map((row) => row.query).filter(isCheckableStatement);
  if (statements.length === 0) {
    throw new Error(`pg-index-check: no statements were captured in this database. ${SETUP_HELP}`);
  }

  return statements;
}
