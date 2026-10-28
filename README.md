# pg-index-check

Fail your test suite when PostgreSQL queries have no usable index.

Your tests already run the queries your app makes. pg-index-check reads them back from `pg_stat_statements` after the suite, plans each one with sequential scans disabled, and reports any query that still has to read a whole table (or a whole index) to apply its filter.

## Features

- **Works on tiny test tables** - With `enable_seqscan = off`, a sequential scan only survives when no index can serve the query, however few rows the table has
- **Any driver or ORM** - Pure PostgreSQL: captures statements with `pg_stat_statements`, so Prisma, Drizzle, Knex or raw `pg` all work without code changes
- **Source locations** - Picks up `/* path:line */` comments from [pg-source-comments](https://github.com/mosaic-code-coop/pg-source-comments) and shows where each query came from
- **Auditable allowlist** - Ignore rules need a reason, and rules that no longer match anything are reported

## Requirements

- PostgreSQL 16+ (uses `EXPLAIN (GENERIC_PLAN)`)
- `pg_stat_statements` in `shared_preload_libraries` on the test database server
- Node.js 22.9.0+, pg 8.0.0+

## Installation

```bash
npm install --save-dev @mosaic-code/pg-index-check pg
```

## Quick Start

### 1. Load pg_stat_statements on the test database

```yaml
# docker-compose.yml
services:
  postgres-test:
    image: postgres:18-alpine
    command: postgres -c shared_preload_libraries=pg_stat_statements
```

GitHub Actions `services:` can't pass server flags, so start Postgres with `docker compose up -d --wait` (or `docker run ... postgres -c shared_preload_libraries=pg_stat_statements`) in a step instead.

### 2. Check after the test suite

```typescript
// tests/global-setup.ts
import { assertIndexes, resetCapture } from '@mosaic-code/pg-index-check';

const connectionString = process.env.TEST_DATABASE_URL!;

export async function setup() {
  // Installs the extension in the database if needed, and clears earlier statements
  await resetCapture({ connectionString });
}

export async function teardown() {
  // Throws an IndexCheckError listing every query without a usable index
  await assertIndexes({
    connectionString,
    ignore: [{ table: 'public.countries', reason: 'fixed lookup table, ~250 rows' }],
  });
}
```

```typescript
// vitest.config.ts
export default defineConfig({
  test: { globalSetup: ['tests/global-setup.ts'] },
});
```

A failing check fails the run (vitest exits non-zero when teardown throws):

```
pg-index-check: 1 finding(s) across 42 statement(s)

SEQ_SCAN_FILTER public.orders at src/orders/service.ts:88
  condition: (orders.customer_id = $1)
  fix: CREATE INDEX ON public.orders (customer_id)
  statement: SELECT /* src/orders/service.ts:88 */ "public"."orders"."id", ... WHERE "public"."orders"."customer_id" = $1
```

## What Gets Flagged

Every distinct `SELECT`, `WITH`, `UPDATE` and `DELETE` run against the current database since `resetCapture()` is planned with `EXPLAIN (GENERIC_PLAN, VERBOSE, FORMAT JSON)`.

| Kind | Plan shape | Typical cause |
|---|---|---|
| `SEQ_SCAN_FILTER` | Sequential scan with a filter | No index on the filtered column(s) |
| `FULL_INDEX_SCAN` | Index scan with no index condition, filtering on one column with `=` | `WHERE status = $1 ORDER BY id LIMIT n` with no index on `status` |
| `TRAILING_INDEX_COLUMN` | Index condition with `=` that skips the index's first column (PostgreSQL 16/17 only) | Filtering on `created_at` with an index on `(org_id, created_at)` |
| `UNPLANNABLE` | PostgreSQL could not plan the statement | Statement refers to a table the tests dropped |

Not flagged:

- `<>` / `NOT IN` filters, which a btree index can't serve
- Range and `IS NULL` filters on a whole-index scan, since pagination walks the primary key on purpose
- `TRAILING_INDEX_COLUMN` on PostgreSQL 18+, which can skip-scan
- `INSERT`, DDL, utility statements, and queries on `pg_catalog` / `information_schema`

## Configuration

```typescript
await assertIndexes({
  connectionString,

  // Findings to accept. Needs a table and/or statement, and a reason.
  //   table: string matches exactly (`public.orders`), or a RegExp
  //   statement: string matches if the statement contains it, or a RegExp
  ignore: [
    { table: 'public.countries', reason: 'fixed lookup table' },
    { statement: /FROM "public"."audit_log"/, reason: 'admin-only export, runs nightly' },
  ],

  // 'fail' (default): unplannable statements fail the check
  // 'report': list them in the report without failing
  unplannable: 'fail',
});
```

`checkIndexes()` takes the same options and returns the result without throwing:

```typescript
const { statementCount, findings, reported, staleIgnoreRules } = await checkIndexes({ connectionString });
```

## Using with pg-source-comments

When the app's `pg` pool is wrapped with [pg-source-comments](https://github.com/mosaic-code-coop/pg-source-comments) 0.4.0+, findings include the source file and line of the query.

- **Raw `pg` queries:** wrap the pool with `createTrackedPool`.
- **Prisma queries** (`findMany` etc.): also wrap the client with `trackPrismaClient(new PrismaClient({ adapter: new PrismaPg(pool) }))`. Prisma sends queries to the pool after an async hop, so without this the calling code is off the stack and no location is recorded. Needs pg-source-comments 0.4.0+.

`pg_stat_statements` keeps the text of the first call it sees for each distinct query, so a query made from several places shows the first location only.

## Limitations

- **Only tested queries are checked** - A query the test suite never runs isn't seen
- **Joins** - An index that only a join would use (e.g. an unindexed foreign key on the inner side) isn't reported
- **Generic plans** - Plans ignore actual parameter values. The check answers "can an index serve this?", not "will production use it?"
- **One database** - Only statements from the database in `connectionString` are checked; `resetCapture()` clears statistics for the whole server

## How It Works

```
resetCapture()       test suite runs              assertIndexes()
     │                      │                           │
pg_stat_statements_reset  app queries recorded   read statements for this database
                          in pg_stat_statements  SET enable_seqscan = off (own connection)
                                                 EXPLAIN (GENERIC_PLAN) each statement
                                                 apply rules → ignore rules → report
```

The check runs on its own connection, so `enable_seqscan` never changes for the app's sessions.

## Development

```bash
# Install dependencies
npm install

# Unit tests
npm test

# Integration tests (starts PostgreSQL 18 with docker compose)
npm run test:integration:setup

# Against another PostgreSQL version
docker compose down && POSTGRES_VERSION=16 npm run test:integration:setup

# Type check
npm run typecheck

# Build
npm run build
```

## License

[Do No Harm](https://github.com/raisely/NoHarm)
