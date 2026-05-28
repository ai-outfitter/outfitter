// Defines validation result types before AJV-backed schema validation is implemented.
export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly issues: readonly ValidationIssue[];
}

export const createValidationResult = (issues: readonly ValidationIssue[]): ValidationResult => ({
  valid: issues.length === 0,
  issues,
});
