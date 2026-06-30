// Provides supported agent adapter lookup for run command selection.
import type { AgentAdapter } from './AgentAdapter.js';
import { createClaudeAdapter } from './claude/ClaudeAdapter.js';
import { createPiAdapter } from './pi/PiAdapter.js';

export type SupportedAgentId = 'pi' | 'claude';

export const defaultAgentId: SupportedAgentId = 'pi';

export const supportedAgentIds = [defaultAgentId, 'claude'] as const satisfies readonly SupportedAgentId[];

export const isSupportedAgentId = (agentId: string): agentId is SupportedAgentId =>
  supportedAgentIds.includes(agentId as SupportedAgentId);

export const createAgentAdapter = (agentId: string | undefined): AgentAdapter => {
  const selectedAgentId = agentId ?? defaultAgentId;

  switch (selectedAgentId) {
    case 'pi':
      return createPiAdapter();
    case 'claude':
      return createClaudeAdapter();
    default:
      throw new Error(`Unknown agent '${selectedAgentId}'. Expected one of: ${supportedAgentIds.join(', ')}.`);
  }
};
