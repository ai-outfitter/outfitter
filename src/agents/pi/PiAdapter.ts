// Provides the initial pi adapter launch-plan scaffold.
import type { AgentAdapter, AgentLaunchPlan } from '../AgentAdapter.js';
import type { Tack } from '../../tack/Tack.js';

export const createPiAdapter = (): AgentAdapter => ({
  id: 'pi',
  createLaunchPlan(tack: Tack): AgentLaunchPlan {
    return {
      command: 'pi',
      args: [],
      env: {
        PI_CODING_AGENT_DIR: tack.rootDirectory,
      },
    };
  },
});
