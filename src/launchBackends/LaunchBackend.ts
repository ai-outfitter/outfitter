/* v8 ignore start -- interface-only module. */
// Defines the generic launch backend boundary used to wrap agent launch plans.
import type { CompositeProfile } from '../compositeProfile/CompositeProfile.js';
import type { CompositeProfileStatePath } from '../compositeProfile/StatePersistence.js';
import type { ContainerProfileControls } from '../profiles/Profile.js';

export type LaunchBackendId = 'host' | 'auto' | 'docker' | 'podman' | 'apple-container';
export type ConcreteLaunchBackendId = Exclude<LaunchBackendId, 'auto'>;

export interface ProcessLaunchPlan {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwd?: string;
}

export interface LaunchBackendPlan {
  readonly backendId: ConcreteLaunchBackendId;
  readonly launchPlan: ProcessLaunchPlan;
  readonly warnings: readonly string[];
}

export interface LaunchBackendRenderInput {
  readonly innerLaunchPlan: ProcessLaunchPlan;
  readonly container: ContainerProfileControls;
  readonly compositeProfile: CompositeProfile;
  readonly profileFolders: readonly string[];
  readonly projectDirectory: string;
  readonly cacheDirectory: string;
  readonly statePaths: readonly CompositeProfileStatePath[];
  readonly envPassthroughAllowed: readonly string[];
  readonly stdinIsTty: boolean;
  readonly stdoutIsTty: boolean;
}

export interface LaunchBackend {
  readonly id: ConcreteLaunchBackendId;
  render(input: LaunchBackendRenderInput): LaunchBackendPlan;
}
