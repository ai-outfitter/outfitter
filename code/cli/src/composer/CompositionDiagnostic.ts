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

export interface DiagnosticList extends Array<string> {
  readonly details: CompositionDiagnostic[];
}

export const diagnosticList = (): DiagnosticList => {
  const list: string[] = [];
  Object.defineProperty(list, 'details', { value: [] as CompositionDiagnostic[], enumerable: false });
  return list as DiagnosticList;
};

export const addDiagnostic = (list: DiagnosticList, detail: CompositionDiagnostic): void => {
  list.push(detail.message);
  list.details.push(detail);
};

export const uniqueDiagnostics = (details: readonly CompositionDiagnostic[]): readonly CompositionDiagnostic[] =>
  details.filter((detail, index, all) => all.findIndex((candidate) => candidate.message === detail.message) === index);
