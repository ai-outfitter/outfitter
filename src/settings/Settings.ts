// Defines the internal Settings shape produced from Bridl settings files.
import type { ProfileSourceReference, RemoteSourceReference } from '../profiles/ProfileSource.js';

export type RemoteSettingsReference = RemoteSourceReference & { readonly path: string };

export interface Settings {
  readonly defaultProfile?: string;
  readonly profileSources?: readonly ProfileSourceReference[];
  readonly remoteSettings?: readonly RemoteSettingsReference[];
}

export const emptySettings = (): Settings => ({
  profileSources: [],
  remoteSettings: [],
});
