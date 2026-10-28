import pg from 'pg';
import { readCapturedStatements, resetCapturedStatements } from './capture.js';
import {
  explainStatement,
  leadingIndexColumns,
  preparePlanningSession,
  serverMajorVersion,
} from './explain.js';
import { applyIgnoreRules } from './ignore.js';
import { evaluatePlan, indexesWithConditions } from './plan-rules.js';
import { formatReport } from './report.js';
import { parseSourceLocation } from './statement-text.js';
import { FindingKind, UnplannableMode } from './types.js';
import type { CaptureOptions, Finding, IndexCheckOptions, IndexCheckResult, PlanNode } from './types.js';

/** PostgreSQL 18 added skip scan, so conditions on trailing index columns are servable */
const SKIP_SCAN_MAJOR_VERSION = 18;
/** EXPLAIN (GENERIC_PLAN) was added in PostgreSQL 16 */
const MINIMUM_MAJOR_VERSION = 16;

/**
 * Thrown by assertIndexes() when statements have no usable index
 */
export class IndexCheckError extends Error {
  readonly result: IndexCheckResult;

  constructor(result: IndexCheckResult) {
    super(formatReport(result));
    this.name = 'IndexCheckError';
    this.result = result;
  }
}

/**
 * Clears recorded statements. Call before the test suite runs (e.g. in vitest globalSetup).
 */
export async function resetCapture(options: CaptureOptions): Promise<void> {
  await withClient(options.connectionString, resetCapturedStatements);
}

/**
 * Plans every statement recorded since resetCapture() with sequential scans
 * disabled, and returns those no index can serve
 */
export async function checkIndexes(options: IndexCheckOptions): Promise<IndexCheckResult> {
  const unplannableMode = options.unplannable ?? UnplannableMode.FAIL;

  return withClient(options.connectionString, async (client) => {
    // Read before running anything else, so this check's own queries are not captured
    const statements = await readCapturedStatements(client);

    const majorVersion = await serverMajorVersion(client);
    if (majorVersion < MINIMUM_MAJOR_VERSION) {
      throw new Error(`pg-index-check: PostgreSQL ${MINIMUM_MAJOR_VERSION}+ is required, found ${majorVersion}`);
    }
    await preparePlanningSession(client);

    const allFindings: Finding[] = [];
    for (const statement of statements) {
      allFindings.push(...(await checkStatement(client, statement, majorVersion)));
    }

    const isReportedOnly = (finding: Finding) =>
      finding.kind === FindingKind.UNPLANNABLE && unplannableMode === UnplannableMode.REPORT;
    const { kept, staleIgnoreRules } = applyIgnoreRules(allFindings, options.ignore ?? []);

    return {
      statementCount: statements.length,
      findings: kept.filter((finding) => !isReportedOnly(finding)),
      reported: kept.filter(isReportedOnly),
      staleIgnoreRules,
    };
  });
}

/**
 * Like checkIndexes(), but throws an IndexCheckError listing the findings.
 * Call after the test suite runs (e.g. in vitest globalSetup's teardown).
 */
export async function assertIndexes(options: IndexCheckOptions): Promise<IndexCheckResult> {
  const result = await checkIndexes(options);
  if (result.findings.length > 0) {
    throw new IndexCheckError(result);
  }
  return result;
}

async function checkStatement(client: pg.Client, statement: string, majorVersion: number): Promise<Finding[]> {
  const sourceLocation = parseSourceLocation(statement);
  const outcome = await explainStatement(client, statement);

  if ('error' in outcome) {
    return [{ kind: FindingKind.UNPLANNABLE, statement, sourceLocation, error: outcome.error }];
  }

  const findings = await evaluate(client, outcome.plan, majorVersion);
  return findings.map((finding) => ({ ...finding, statement, sourceLocation }));
}

async function evaluate(client: pg.Client, plan: PlanNode, majorVersion: number) {
  const checkTrailingIndexColumns = majorVersion < SKIP_SCAN_MAJOR_VERSION;
  const leadingColumns = checkTrailingIndexColumns
    ? await leadingIndexColumns(client, indexesWithConditions(plan))
    : new Map<string, string>();

  return evaluatePlan(plan, { leadingColumns, checkTrailingIndexColumns });
}

async function withClient<T>(connectionString: string, work: (client: pg.Client) => Promise<T>): Promise<T> {
  // A dedicated connection, so enable_seqscan never leaks into the application's sessions
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}
