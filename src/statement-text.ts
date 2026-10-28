const CHECKED_KEYWORDS = new Set(['SELECT', 'WITH', 'UPDATE', 'DELETE']);

/**
 * Returns the first keyword of a statement (upper-cased), skipping leading
 * whitespace, comments and opening parentheses
 */
export function firstKeyword(statement: string): string | undefined {
  let index = 0;

  while (index < statement.length) {
    if (/\s/.test(statement[index]) || statement[index] === '(') {
      index += 1;
    } else if (statement.startsWith('/*', index)) {
      const commentEnd = statement.indexOf('*/', index + 2);
      if (commentEnd === -1) {
        return undefined;
      }
      index = commentEnd + 2;
    } else if (statement.startsWith('--', index)) {
      const lineEnd = statement.indexOf('\n', index + 2);
      if (lineEnd === -1) {
        return undefined;
      }
      index = lineEnd + 1;
    } else {
      const wordMatch = /^[A-Za-z_]+/.exec(statement.slice(index));
      return wordMatch?.[0].toUpperCase();
    }
  }

  return undefined;
}

/**
 * Whether a captured statement is one whose plan should be checked: a query or
 * data-modifying statement that reads rows, and not a catalog/monitoring query
 */
export function isCheckableStatement(statement: string): boolean {
  const keyword = firstKeyword(statement);
  if (keyword === undefined || !CHECKED_KEYWORDS.has(keyword)) {
    return false;
  }

  return !/pg_stat_statements|pg_catalog\.|information_schema\./i.test(statement);
}

/**
 * Extracts the `path:line` location from a pg-source-comments comment,
 * e.g. `SELECT /* src/api/users.ts:42 *\/ ...` gives `src/api/users.ts:42`
 */
export function parseSourceLocation(statement: string): string | undefined {
  const match = /\/\*\s*(\S+:\d+(?::\d+)?)(?:\s+in\s+\S+)?\s*\*\//.exec(statement);
  return match?.[1];
}
