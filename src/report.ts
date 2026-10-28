import type { Finding, IndexCheckResult } from './types.js';

/**
 * Formats a check result for humans
 */
export function formatReport(result: IndexCheckResult): string {
  const sections = [
    `pg-index-check: ${result.findings.length} finding(s) across ${result.statementCount} statement(s)`,
  ];

  if (result.findings.length > 0) {
    sections.push(result.findings.map(formatFinding).join('\n\n'));
  }
  if (result.reported.length > 0) {
    sections.push(`Unplannable statements (not failing):\n\n${result.reported.map(formatFinding).join('\n\n')}`);
  }
  if (result.staleIgnoreRules.length > 0) {
    const rules = result.staleIgnoreRules.map(
      (rule) => `  - ${String(rule.table ?? rule.statement)} (${rule.reason})`
    );
    sections.push(`Ignore rules that matched nothing:\n${rules.join('\n')}`);
  }

  return sections.join('\n\n');
}

function formatFinding(finding: Finding): string {
  const heading = [finding.kind, finding.table, finding.sourceLocation && `at ${finding.sourceLocation}`]
    .filter(Boolean)
    .join(' ');

  const details = [
    finding.condition && `condition: ${finding.condition}`,
    finding.indexName && `index: ${finding.indexName}`,
    finding.error && `error: ${finding.error}`,
    finding.hint && `fix: ${finding.hint}`,
    `statement: ${finding.statement}`,
  ].filter(Boolean);

  return [heading, ...details.map((line) => `  ${line}`)].join('\n');
}
