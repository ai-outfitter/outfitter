// Defines references to local or URI-backed profile sources.
interface ProfileSourceFilters {
  readonly only?: readonly string[];
  readonly except?: readonly string[];
}

export type ProfileSourceReference =
  | (ProfileSourceFilters & { readonly path: string; readonly uri?: never })
  | (ProfileSourceFilters & { readonly path?: never; readonly uri: string });

export const createLocalProfileSource = (path: string): ProfileSourceReference => ({
  path,
});

export const createUriProfileSource = (uri: string): ProfileSourceReference => ({
  uri,
});
