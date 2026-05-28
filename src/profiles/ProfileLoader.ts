// Defines profile loading plan scaffolding before profile.yml parsing exists.
import type { ProfileSourceReference } from './ProfileSource.js';

export interface ProfileLoadPlan {
  readonly sources: readonly ProfileSourceReference[];
}

export const createProfileLoadPlan = (sources: readonly ProfileSourceReference[]): ProfileLoadPlan => ({
  sources,
});
