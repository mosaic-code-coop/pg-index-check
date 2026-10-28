import { describe, expect, it } from 'vitest';
import { formatReport } from '../src/report.js';
import { FindingKind } from '../src/types.js';

describe('formatReport', () => {
  it('lists findings, reported statements and stale ignore rules', () => {
    const report = formatReport({
      statementCount: 3,
      findings: [
        {
          kind: FindingKind.SEQ_SCAN_FILTER,
          statement: 'SELECT /* src/orders.ts:42 */ * FROM orders WHERE customer_id = $1',
          sourceLocation: 'src/orders.ts:42',
          table: 'public.orders',
          condition: '(orders.customer_id = $1)',
          hint: 'CREATE INDEX ON public.orders (customer_id)',
        },
      ],
      reported: [
        {
          kind: FindingKind.UNPLANNABLE,
          statement: 'SELECT * FROM gone',
          error: 'relation "gone" does not exist',
        },
      ],
      staleIgnoreRules: [{ table: 'public.legacy', reason: 'small lookup table' }],
    });

    expect(report).toBe(
      [
        'pg-index-check: 1 finding(s) across 3 statement(s)',
        '',
        'SEQ_SCAN_FILTER public.orders at src/orders.ts:42',
        '  condition: (orders.customer_id = $1)',
        '  fix: CREATE INDEX ON public.orders (customer_id)',
        '  statement: SELECT /* src/orders.ts:42 */ * FROM orders WHERE customer_id = $1',
        '',
        'Unplannable statements (not failing):',
        '',
        'UNPLANNABLE',
        '  error: relation "gone" does not exist',
        '  statement: SELECT * FROM gone',
        '',
        'Ignore rules that matched nothing:',
        '  - public.legacy (small lookup table)',
      ].join('\n')
    );
  });
});
