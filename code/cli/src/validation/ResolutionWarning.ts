/** A non-fatal resolution warning with the resource and declaration file that caused it. */
export interface ResolutionWarningDetail {
  readonly message: string;
  readonly resource: string;
  readonly sourcePath: string;
}
