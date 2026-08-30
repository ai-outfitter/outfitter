export type CompositionDiagnosticCode =
  'inheritance-cycle' | 'resource-invalid' | 'resource-unresolved' | 'reference-escaped';

export interface CompositionDiagnostic {
  readonly severity: 'error' | 'warning';
  readonly code: CompositionDiagnosticCode;
  readonly message: string;
  readonly sourcePath?: string;
  /** An isolated catalog can defer this check until the complete effective set is available. */
  readonly deferInIsolatedSource?: boolean;
}

/** The message-only view a caller reports; the typed diagnostics stay the single source of truth. */
export const diagnosticMessages = (details: readonly CompositionDiagnostic[]): readonly string[] =>
  details.map(({ message }) => message);

export const uniqueDiagnostics = (details: readonly CompositionDiagnostic[]): readonly CompositionDiagnostic[] => {
  const seen = new Set<string>();
  return details.filter((detail) => {
    if (seen.has(detail.message)) return false;
    seen.add(detail.message);
    return true;
  });
};
