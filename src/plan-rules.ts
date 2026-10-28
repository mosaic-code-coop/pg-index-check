import { FindingKind } from './types.js';
import type { Finding, PlanNode } from './types.js';

const INDEX_SCAN_TYPES = new Set(['Index Scan', 'Index Only Scan']);
const INDEX_COND_SCAN_TYPES = new Set(['Index Scan', 'Index Only Scan', 'Bitmap Index Scan']);

export interface PlanRuleContext {
  /**
   * Leading btree column per index, keyed by `schema.index`. Only needed when
   * checkTrailingIndexColumns is true.
   */
  leadingColumns: Map<string, string>;
  /** PostgreSQL 18+ can skip-scan, so trailing-column conditions are fine there */
  checkTrailingIndexColumns: boolean;
}

type PlanFinding = Omit<Finding, 'statement' | 'sourceLocation'>;

/**
 * Lists every plan node, depth first. Bitmap index scans don't name their table, so
 * they take it from the bitmap heap scan above them.
 */
export function flattenPlan(plan: PlanNode, bitmapRelation?: Pick<PlanNode, 'Schema' | 'Relation Name'>): PlanNode[] {
  const node = bitmapRelation && plan['Relation Name'] === undefined ? { ...plan, ...bitmapRelation } : plan;
  const childRelation =
    plan['Node Type'] === 'Bitmap Heap Scan'
      ? { Schema: plan.Schema, 'Relation Name': plan['Relation Name'] }
      : bitmapRelation;

  return [node, ...(plan.Plans ?? []).flatMap((child) => flattenPlan(child, childRelation))];
}

/**
 * Keys (`schema.index`) of indexes used with an index condition, for looking up
 * their leading columns
 */
export function indexesWithConditions(plan: PlanNode): string[] {
  return flattenPlan(plan)
    .filter((node) => INDEX_COND_SCAN_TYPES.has(node['Node Type']) && node['Index Cond'])
    .map((node) => indexKey(node));
}

/**
 * Applies the missing-index rules to a plan produced with enable_seqscan off
 */
export function evaluatePlan(plan: PlanNode, context: PlanRuleContext): PlanFinding[] {
  return flattenPlan(plan).flatMap((node) => {
    const finding =
      checkSeqScanFilter(node) ?? checkFullIndexScan(node) ?? checkTrailingIndexColumn(node, context);
    return finding ? [finding] : [];
  });
}

/**
 * A sequential scan that survives enable_seqscan off means no index can serve its filter
 */
function checkSeqScanFilter(node: PlanNode): PlanFinding | undefined {
  const filter = node.Filter;
  if (node['Node Type'] !== 'Seq Scan' || !filter || isNegationOnly(filter)) {
    return undefined;
  }

  return {
    kind: FindingKind.SEQ_SCAN_FILTER,
    table: tableName(node),
    condition: filter,
    hint: indexHint(node, filter),
  };
}

/**
 * Walking a whole index (usually to avoid a sort) while filtering on one column
 * means that column has no index. Range and IS NULL filters are skipped, since
 * pagination walks the primary key on purpose.
 */
function checkFullIndexScan(node: PlanNode): PlanFinding | undefined {
  const filter = node.Filter;
  if (!INDEX_SCAN_TYPES.has(node['Node Type']) || !filter || node['Index Cond']) {
    return undefined;
  }
  if (equalityColumn(filter) === undefined) {
    return undefined;
  }

  return {
    kind: FindingKind.FULL_INDEX_SCAN,
    table: tableName(node),
    condition: filter,
    indexName: node['Index Name'],
    hint: indexHint(node, filter),
  };
}

/**
 * Before PostgreSQL 18, an equality condition that skips a btree index's leading
 * column has to scan the whole index
 */
function checkTrailingIndexColumn(node: PlanNode, context: PlanRuleContext): PlanFinding | undefined {
  const indexCondition = node['Index Cond'];
  if (!context.checkTrailingIndexColumns || !INDEX_COND_SCAN_TYPES.has(node['Node Type']) || !indexCondition) {
    return undefined;
  }

  const leadingColumn = context.leadingColumns.get(indexKey(node));
  if (leadingColumn === undefined || !indexCondition.includes(' = ')) {
    return undefined;
  }
  if (new RegExp(`\\b"?${escapeRegExp(leadingColumn)}"?\\b`).test(indexCondition)) {
    return undefined;
  }

  return {
    kind: FindingKind.TRAILING_INDEX_COLUMN,
    table: tableName(node),
    condition: indexCondition,
    indexName: node['Index Name'],
    hint: `condition does not use the index's leading column "${leadingColumn}"`,
  };
}

/**
 * Filters made only of `<>` / `NOT IN` comparisons, which a btree index cannot serve
 */
function isNegationOnly(filter: string): boolean {
  return filter.includes('<>') && !/ = | < | > | <= | >= |~~| IS NULL/.test(filter);
}

/**
 * Column name when the filter is a single `column = value` comparison
 */
function equalityColumn(filter: string): string | undefined {
  if (/ AND | OR /.test(filter) || filter.split(' = ').length !== 2) {
    return undefined;
  }
  const match = /^\((?:\w+\.)?"?(\w+)"? = /.exec(filter);
  return match?.[1];
}

function indexHint(node: PlanNode, filter: string): string | undefined {
  const column = equalityColumn(filter);
  return column === undefined ? undefined : `CREATE INDEX ON ${tableName(node)} (${column})`;
}

function tableName(node: PlanNode): string | undefined {
  const relation = node['Relation Name'];
  if (relation === undefined) {
    return undefined;
  }
  return node.Schema ? `${node.Schema}.${relation}` : relation;
}

function indexKey(node: PlanNode): string {
  return `${node.Schema}.${node['Index Name']}`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
