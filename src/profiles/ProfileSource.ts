// Defines references to local or URI-backed profile sources.
export interface ProfileSourceReference {
  readonly path?: string;
  readonly uri?: string;
  readonly only?: readonly string[];
  readonly except?: readonly string[];
}

export const createLocalProfileSource = (path: string): ProfileSourceReference => ({
  path,
});

export const createUriProfileSource = (uri: string): ProfileSourceReference => ({
  uri,
});
