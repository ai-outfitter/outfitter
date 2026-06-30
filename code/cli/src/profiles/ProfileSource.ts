// Defines references to local, URI-backed, or GitHub-backed profile sources.
interface ProfileSourceFilters {
  readonly only?: readonly string[];
  readonly except?: readonly string[];
}

export type RemoteSourceReference =
  | { readonly uri: string; readonly github?: never; readonly ref?: string; readonly path?: string }
  | { readonly github: string; readonly uri?: never; readonly ref?: string; readonly path?: string };

export type ProfileSourceReference =
  | (ProfileSourceFilters & {
      readonly path: string;
      readonly uri?: never;
      readonly github?: never;
      readonly ref?: never;
    })
  | (ProfileSourceFilters & {
      readonly uri: string;
      readonly github?: never;
      readonly ref?: string;
      readonly path?: string;
    })
  | (ProfileSourceFilters & {
      readonly github: string;
      readonly uri?: never;
      readonly ref?: string;
      readonly path?: string;
    });

export const createLocalProfileSource = (path: string): ProfileSourceReference => ({
  path,
});

export const createUriProfileSource = (uri: string): ProfileSourceReference => ({
  uri,
});

export const normalizeRemoteSourceUri = (source: RemoteSourceReference): string => {
  if (source.uri !== undefined) {
    return source.uri;
  }

  return `git+https://github.com/${source.github}.git`;
};
