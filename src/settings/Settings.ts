// Defines the internal Settings shape produced from Outfitter settings files.
import type { ProfileSourceReference, RemoteSourceReference } from '../profiles/ProfileSource.js';

export type RemoteSettingsReference = RemoteSourceReference & { readonly path: string };
export type SettingsValue =
  | string
  | number
  | boolean
  | null
  | readonly SettingsValue[]
  | { readonly [key: string]: SettingsValue };
export type CustomSettings = Readonly<Record<string, SettingsValue>>;

export interface ContainerPolicySettings {
  readonly envPassthrough?: readonly string[];
}

export interface Settings {
  readonly defaultProfile?: string;
  readonly defaultAgent?: string;
  readonly defaultLaunchBackend?: 'host' | 'auto' | 'docker' | 'podman' | 'apple-container';
  readonly profileSources?: readonly ProfileSourceReference[];
  readonly remoteSettings?: readonly RemoteSettingsReference[];
  readonly cacheDirectory?: string;
  readonly containerPolicy?: ContainerPolicySettings;
  readonly customSettings?: CustomSettings;
}

export const emptySettings = (): Settings => ({
  profileSources: [],
  remoteSettings: [],
});
