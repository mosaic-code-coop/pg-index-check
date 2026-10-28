import type { Finding, IgnoreRule } from './types.js';

/**
 * Removes findings matched by an ignore rule and reports rules that matched nothing
 */
export function applyIgnoreRules(
  findings: Finding[],
  rules: IgnoreRule[]
): { kept: Finding[]; staleIgnoreRules: IgnoreRule[] } {
  for (const rule of rules) {
    validateRule(rule);
  }

  const usedRules = new Set<IgnoreRule>();
  const kept = findings.filter((finding) => {
    const matchingRule = rules.find((rule) => ruleMatches(rule, finding));
    if (matchingRule) {
      usedRules.add(matchingRule);
      return false;
    }
    return true;
  });

  return { kept, staleIgnoreRules: rules.filter((rule) => !usedRules.has(rule)) };
}

function validateRule(rule: IgnoreRule): void {
  if (rule.table === undefined && rule.statement === undefined) {
    throw new Error(`pg-index-check: ignore rule needs a table or statement: ${JSON.stringify(rule)}`);
  }
  if (!rule.reason?.trim()) {
    throw new Error(`pg-index-check: ignore rule needs a reason: ${String(rule.table ?? rule.statement)}`);
  }
}

function ruleMatches(rule: IgnoreRule, finding: Finding): boolean {
  const tableMatches =
    rule.table === undefined ||
    (finding.table !== undefined &&
      (typeof rule.table === 'string' ? rule.table === finding.table : rule.table.test(finding.table)));

  const statementMatches =
    rule.statement === undefined ||
    (typeof rule.statement === 'string'
      ? finding.statement.includes(rule.statement)
      : rule.statement.test(finding.statement));

  return tableMatches && statementMatches;
}
