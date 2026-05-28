// Defines watch targets for tack inputs while an agent process runs.
export interface TackWatchPlan {
  readonly paths: readonly string[];
}

export const createTackWatchPlan = (paths: readonly string[]): TackWatchPlan => ({
  paths,
});
