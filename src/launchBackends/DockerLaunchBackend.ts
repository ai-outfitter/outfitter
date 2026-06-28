// Docker launch backend renderer.
import type { LaunchBackend } from './LaunchBackend.js';
import { renderDockerLikeBackend } from './ContainerRenderers.js';

export const createDockerLaunchBackend = (): LaunchBackend => ({
  id: 'docker',
  render: (input) => renderDockerLikeBackend('docker', input),
});
