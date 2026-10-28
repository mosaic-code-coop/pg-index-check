/**
 * Why a statement was flagged
 */
export const FindingKind = {
  /** A sequential scan applies a filter that no index can serve */
  SEQ_SCAN_FILTER: 'SEQ_SCAN_FILTER',
  /** A whole index is walked to apply a single-column equality filter */
  FULL_INDEX_SCAN: 'FULL_INDEX_SCAN',
  /** An index condition skips the index's leading column (PostgreSQL 16/17 only) */
  TRAILING_INDEX_COLUMN: 'TRAILING_INDEX_COLUMN',
  /** PostgreSQL could not produce a plan for the statement */
  UNPLANNABLE: 'UNPLANNABLE',
} as const;

export type FindingKind = (typeof FindingKind)[keyof typeof FindingKind];

/**
 * What to do with statements PostgreSQL cannot EXPLAIN
 */
export const UnplannableMode = {
  /** Treat them as findings, failing assertIndexes() */
  FAIL: 'fail',
  /** List them in the report without failing */
  REPORT: 'report',
} as const;

export type UnplannableMode = (typeof UnplannableMode)[keyof typeof UnplannableMode];

export interface Finding {
  kind: FindingKind;
  /** Statement text as recorded by pg_stat_statements */
  statement: string;
  /** `path:line` from a pg-source-comments comment in the statement, if present */
  sourceLocation?: string;
  /** Schema-qualified table, e.g. `public.orders` */
  table?: string;
  /** Plan condition that triggered the finding, e.g. `(orders.status = $1)` */
  condition?: string;
  /** Index involved, for FULL_INDEX_SCAN and TRAILING_INDEX_COLUMN */
  indexName?: string;
  /** Suggested fix, when it can be derived from the condition */
  hint?: string;
  /** PostgreSQL error message, for UNPLANNABLE */
  error?: string;
}

export interface IgnoreRule {
  /** Schema-qualified table (`public.orders`); a string must match exactly */
  table?: string | RegExp;
  /** Statement text; a string matches if the statement contains it */
  statement?: string | RegExp;
  /** Why this is acceptable. Required so the allowlist stays auditable. */
  reason: string;
}

export interface CaptureOptions {
  connectionString: string;
}

export interface IndexCheckOptions extends CaptureOptions {
  /** Findings to accept, each with a reason */
  ignore?: IgnoreRule[];
  /** @default 'fail' */
  unplannable?: UnplannableMode;
}

export interface IndexCheckResult {
  /** Number of captured statements that were checked */
  statementCount: number;
  /** Findings that fail the check */
  findings: Finding[];
  /** Unplannable statements listed without failing (unplannable: 'report') */
  reported: Finding[];
  /** Ignore rules that matched no finding */
  staleIgnoreRules: IgnoreRule[];
}

/**
 * Subset of a PostgreSQL `EXPLAIN (FORMAT JSON, VERBOSE)` plan node used by the rules
 */
export interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  Schema?: string;
  'Index Name'?: string;
  'Index Cond'?: string;
  Filter?: string;
  Plans?: PlanNode[];
}
