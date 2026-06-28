// Apple container CLI launch backend renderer.
import type { LaunchBackend } from './LaunchBackend.js';
import { renderAppleContainerBackend } from './ContainerRenderers.js';

export const createAppleContainerLaunchBackend = (): LaunchBackend => ({
  id: 'apple-container',
  render: renderAppleContainerBackend,
});
