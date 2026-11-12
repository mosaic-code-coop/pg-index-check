import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evaluatePlan, indexesWithConditions } from '../src/plan-rules.js';
import { FindingKind } from '../src/types.js';
import type { PlanNode } from '../src/types.js';

// Plans captured from PostgreSQL 17 with enable_seqscan off; see tests/integration/helpers.ts for the table
function loadPlan(name: string): PlanNode {
  return JSON.parse(readFileSync(new URL(`./fixtures/plans/${name}.json`, import.meta.url), 'utf8'));
}

const pre18Context = {
  leadingColumns: new Map([['public.orders_org_created_idx', 'org_id']]),
  leadingColumnsByTable: new Map<string, Set<string>>(),
  checkTrailingIndexColumns: true,
};

describe('evaluatePlan', () => {
  it('flags a sequential scan with a filter', () => {
    expect(evaluatePlan(loadPlan('seq-scan-filter'), pre18Context)).toEqual([
      {
        kind: FindingKind.SEQ_SCAN_FILTER,
        table: 'public.orders',
        condition: '(orders.customer_id = $1)',
        hint: 'CREATE INDEX ON public.orders (customer_id)',
      },
    ]);
  });

  it('ignores a sequential scan whose filter is only <>', () => {
    expect(evaluatePlan(loadPlan('seq-scan-negation'), pre18Context)).toEqual([]);
  });

  it('passes an index condition on the leading column', () => {
    expect(evaluatePlan(loadPlan('index-cond'), pre18Context)).toEqual([]);
  });

  it('flags a whole-index scan filtering on one column', () => {
    expect(evaluatePlan(loadPlan('full-index-scan'), pre18Context)).toEqual([
      expect.objectContaining({ kind: FindingKind.FULL_INDEX_SCAN, indexName: 'orders_pkey' }),
    ]);
  });

  it('does not flag a whole-index scan when a usable index for the filter exists', () => {
    // The generic planner walked orders_pkey to order by id, but an index leads
    // with the filtered `status` column, so production can serve the filter.
    const context = {
      ...pre18Context,
      leadingColumnsByTable: new Map([['public.orders', new Set(['status'])]]),
    };
    expect(evaluatePlan(loadPlan('full-index-scan'), context)).toEqual([]);
  });

  it('flags a bitmap index condition that skips the leading column, only before PostgreSQL 18', () => {
    const plan = loadPlan('trailing-index-column');

    expect(indexesWithConditions(plan)).toEqual(['public.orders_org_created_idx']);
    expect(evaluatePlan(plan, pre18Context)).toEqual([
      expect.objectContaining({
        kind: FindingKind.TRAILING_INDEX_COLUMN,
        table: 'public.orders',
        indexName: 'orders_org_created_idx',
      }),
    ]);
    expect(evaluatePlan(plan, { ...pre18Context, checkTrailingIndexColumns: false })).toEqual([]);
  });
});
