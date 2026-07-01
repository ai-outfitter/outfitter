// Defines the internal Settings shape produced from Outfitter settings files.
import type { ProfileSourceReference, RemoteSourceReference } from '../profiles/ProfileSource.js';

export type RemoteSettingsReference = RemoteSourceReference & { readonly path: string };
export type SettingsValue =
  string | number | boolean | null | readonly SettingsValue[] | { readonly [key: string]: SettingsValue };
export type CustomSettings = Readonly<Record<string, SettingsValue>>;

export interface StartupSettings {
  readonly asciiArt?: boolean;
}

export interface Settings {
  readonly defaultProfile?: string;
  readonly defaultAgent?: string;
  readonly profileSources?: readonly ProfileSourceReference[];
  readonly remoteSettings?: readonly RemoteSettingsReference[];
  readonly cacheDirectory?: string;
  readonly customSettings?: CustomSettings;
  readonly profileExport?: boolean;
  readonly startup?: StartupSettings;
}

export const emptySettings = (): Settings => ({
  profileSources: [],
  remoteSettings: [],
});
