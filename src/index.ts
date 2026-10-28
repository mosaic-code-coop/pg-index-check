// Main library exports
export { resetCapture, checkIndexes, assertIndexes, IndexCheckError } from './check.js';
export { formatReport } from './report.js';
export { FindingKind, UnplannableMode } from './types.js';

// Type exports
export type {
  CaptureOptions,
  Finding,
  IgnoreRule,
  IndexCheckOptions,
  IndexCheckResult,
} from './types.js';
