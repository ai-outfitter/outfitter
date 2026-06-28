// Resolves launch backends for the run command without bloating RunCommand.
import type { AgentLaunchPlan } from '../../agents/AgentAdapter.js';
import type { AgentCompositeProfilePlan } from '../../agents/AgentAdapter.js';
import { selectContainerControls, selectRequestedLaunchBackend } from '../../launchBackends/ContainerControls.js';
import type { LaunchBackendId, LaunchBackendPlan } from '../../launchBackends/LaunchBackend.js';
import {
  createLaunchBackend,
  type LaunchBackendResolverDependencies,
} from '../../launchBackends/LaunchBackendRegistry.js';
import type { Profile } from '../../profiles/Profile.js';
import type { Settings } from '../../settings/Settings.js';

export interface RunLaunchBackendInput {
  readonly cliLaunchBackend?: LaunchBackendId;
  readonly agentId: string;
  readonly profile: Profile;
  readonly settings: Settings;
  readonly compositeProfilePlan: AgentCompositeProfilePlan;
  readonly profileFolders: readonly string[];
  readonly projectDirectory: string;
  readonly cacheDirectory: string;
  readonly innerLaunchPlan: AgentLaunchPlan;
  readonly resolver?: LaunchBackendResolverDependencies;
  readonly stdinIsTty: boolean;
  readonly stdoutIsTty: boolean;
}

export const createRunLaunchBackendPlan = (
  input: RunLaunchBackendInput,
): { readonly backendPlan: LaunchBackendPlan; readonly image?: string } => {
  const containerControls = selectContainerControls(input.profile, input.agentId);
  const requestedBackend = selectRequestedLaunchBackend(input.cliLaunchBackend, containerControls, input.settings);
  const backend = createLaunchBackend(requestedBackend, input.resolver);

  return {
    image: containerControls.image,
    backendPlan: backend.render({
      innerLaunchPlan: input.innerLaunchPlan,
      container: containerControls,
      compositeProfile: input.compositeProfilePlan.compositeProfile,
      profileFolders: input.profileFolders,
      projectDirectory: input.projectDirectory,
      cacheDirectory: input.cacheDirectory,
      statePaths: input.compositeProfilePlan.compositeProfile.statePaths,
      /* v8 ignore next -- settings merger supplies the default empty policy during run command execution. */
      envPassthroughAllowed: input.settings.containerPolicy?.envPassthrough ?? [],
      stdinIsTty: input.stdinIsTty,
      stdoutIsTty: input.stdoutIsTty,
    }),
  };
};
