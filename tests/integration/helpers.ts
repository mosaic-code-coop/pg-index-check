import pg from 'pg';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://test:test@localhost:5434/test';

/**
 * Connects to the test database, failing with setup instructions if it is unreachable
 */
export async function connectTestClient(connectionString = TEST_DATABASE_URL): Promise<pg.Client> {
  const client = new pg.Client({ connectionString });
  try {
    await client.connect();
  } catch (error) {
    throw new Error(
      '\n\n' +
        'Cannot connect to test database at: ' + connectionString + '\n' +
        '\n' +
        'To run integration tests, you have two options:\n' +
        '\n' +
        '  1. Use the automated setup script (recommended):\n' +
        '      npm run test:integration:setup\n' +
        '\n' +
        '  2. Manual setup:\n' +
        '      docker compose up -d --wait postgres-test\n' +
        '      npm run test:integration\n' +
        '\n' +
        'Original error: ' + (error instanceof Error ? error.message : String(error)) + '\n'
    );
  }
  return client;
}

export async function serverMajorVersion(client: pg.Client): Promise<number> {
  const result = await client.query<{ server_version_num: string }>('SHOW server_version_num');
  return Math.floor(Number(result.rows[0].server_version_num) / 10000);
}

/**
 * Creates the `orders` table used by the tests: a few rows, so every plan would be a
 * sequential scan without enable_seqscan off
 */
export async function createOrdersTable(client: pg.Client): Promise<void> {
  await client.query('DROP TABLE IF EXISTS orders');
  await client.query(`
    CREATE TABLE orders (
      id serial PRIMARY KEY,
      org_id int NOT NULL,
      customer_id int NOT NULL,
      status text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await client.query('CREATE INDEX orders_org_created_idx ON orders (org_id, created_at)');
  await client.query(`
    INSERT INTO orders (org_id, customer_id, status)
    SELECT g % 3, g, 'open' FROM generate_series(1, 5) g
  `);
  await client.query('ANALYZE orders');
}
