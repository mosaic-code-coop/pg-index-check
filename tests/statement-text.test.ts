import { describe, expect, it } from 'vitest';
import { isCheckableStatement, parseSourceLocation } from '../src/statement-text.js';

describe('isCheckableStatement', () => {
  it('checks queries and data-modifying statements, skipping comments and parentheses', () => {
    expect(isCheckableStatement('/* x */ (SELECT 1) UNION (SELECT 2)')).toBe(true);
    expect(isCheckableStatement('DELETE FROM orders WHERE id = $1')).toBe(true);
  });

  it('skips inserts, utility statements and catalog queries', () => {
    expect(isCheckableStatement('INSERT INTO orders VALUES ($1)')).toBe(false);
    expect(isCheckableStatement('SET enable_seqscan = off')).toBe(false);
    expect(isCheckableStatement('SELECT pg_stat_statements_reset()')).toBe(false);
  });
});

describe('parseSourceLocation', () => {
  it('reads a pg-source-comments comment after the first keyword', () => {
    expect(parseSourceLocation('SELECT /* src/orders.ts:42 in listOrders */ * FROM orders')).toBe(
      'src/orders.ts:42'
    );
  });

  it('ignores other comments', () => {
    expect(parseSourceLocation('SELECT * FROM orders WHERE id IN ($1 /*, ... */)')).toBeUndefined();
  });
});
