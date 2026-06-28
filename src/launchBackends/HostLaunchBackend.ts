// Host launch backend that preserves native agent execution.
import type { LaunchBackend } from './LaunchBackend.js';
import { renderHostBackend } from './ContainerRenderers.js';

export const createHostLaunchBackend = (): LaunchBackend => ({
  id: 'host',
  render: renderHostBackend,
});
