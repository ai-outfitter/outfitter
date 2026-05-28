// Defines the internal Settings shape produced from Bridl settings files.
import type { ProfileSourceReference } from '../profiles/ProfileSource.js';

export interface Settings {
  readonly defaultProfile?: string;
  readonly profileSources: readonly ProfileSourceReference[];
}

export const emptySettings = (): Settings => ({
  profileSources: [],
});
