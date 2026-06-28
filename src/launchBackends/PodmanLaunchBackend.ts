// Podman launch backend renderer.
import type { LaunchBackend } from './LaunchBackend.js';
import { renderDockerLikeBackend } from './ContainerRenderers.js';

export const createPodmanLaunchBackend = (): LaunchBackend => ({
  id: 'podman',
  render: (input) => renderDockerLikeBackend('podman', input),
});
