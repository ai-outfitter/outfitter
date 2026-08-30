// Common portable .agents validation at the complete effective-resource-set boundary. Every command
// that gates on validation — `validate`, and `run --strict` — collects and judges findings here, so
// the pass/fail policy has one definition. Adapter-specific checks stay at the projection boundary.
import type { resolveEffectiveSet } from '../resolver/ResolverContext.js';
import type { ValidationFinding } from '../resolver/ResolverValidation.js';
import { validateEffectiveSet, validationFinding } from '../resolver/ResolverValidation.js';
import { formatSettingsIssue } from '../settings/SettingsLoader.js';
import type { SettingsLoadIssue } from '../settings/SettingsLoader.js';
import type { ResolutionWarningDetail } from './ResolutionWarning.js';

const settingsFindings = (issues: readonly SettingsLoadIssue[]): readonly ValidationFinding[] =>
  issues.map((issue) =>
    validationFinding({
      phase: 'parse',
      code: 'settings-invalid',
      severity: 'error',
      resource: 'settings',
      sourcePath: issue.filePath,
      message: formatSettingsIssue(issue),
      remediation: 'Correct the settings file, then run validation again.',
    }),
  );

const settingsWarningFindings = (warnings: readonly ResolutionWarningDetail[]): readonly ValidationFinding[] =>
  warnings.map((warning) =>
    validationFinding({
      phase: 'resolve',
      code: 'settings-warning',
      severity: 'warning',
      resource: warning.resource,
      sourcePath: warning.sourcePath,
      message: warning.message,
      remediation: 'Run outfitter sync to update remote sources. Correct any invalid source configuration.',
    }),
  );

export const collectCommonValidationFindings = (
  resolved: ReturnType<typeof resolveEffectiveSet>,
  projectDirectory: string,
): readonly ValidationFinding[] => [
  ...settingsFindings(resolved.settingsIssues),
  ...settingsWarningFindings(resolved.warningDetails),
  ...validateEffectiveSet(resolved.set, projectDirectory),
];

/** An error always fails validation; a warning fails it only under `--strict`. */
export const commonValidationPassed = (findings: readonly ValidationFinding[], strict: boolean | undefined): boolean =>
  strict === true ? findings.length === 0 : !findings.some((finding) => finding.severity === 'error');

export const formatValidationFindings = (findings: readonly ValidationFinding[], ok: boolean): readonly string[] => {
  if (findings.length === 0) {
    return ['✓ No issues found.'];
  }

  const lines = findings.map(
    (finding) =>
      `${finding.severity === 'error' ? '✗' : '⚠'} [${finding.code}] ${finding.resource}: ${finding.message} ` +
      `Source: ${finding.sourcePath}. Remediation: ${finding.remediation}`,
  );

  return [...lines, ok ? '✓ Passed (warnings only).' : '✗ Validation failed.'];
};
