import { exec } from './exec.ts';
import type { AdapterId, EvalDefinition, RunMetrics } from './types.ts';

export interface AgentRunRequest {
  readonly definition: EvalDefinition;
  readonly profileId: string;
  readonly variantId: string;
  readonly workspace: string;
}

export interface AgentRunResult {
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly metrics: Partial<RunMetrics>;
}

const asNumberOrNull = (value: unknown): number | null => (typeof value === 'number' ? value : null);

/**
 * `claude -p --output-format json` prints a result object with usage and cost;
 * parse best-effort so a format change degrades to null metrics, not a failure.
 */
export const parseClaudeJsonMetrics = (stdout: string): Partial<RunMetrics> => {
  try {
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    const usage = (parsed['usage'] ?? {}) as Record<string, unknown>;
    return {
      tokens_in: asNumberOrNull(usage['input_tokens']),
      tokens_out: asNumberOrNull(usage['output_tokens']),
      turns: asNumberOrNull(parsed['num_turns']),
      cost_usd: asNumberOrNull(parsed['total_cost_usd']),
    };
  } catch {
    return {};
  }
};

const buildCommand = (request: AgentRunRequest): { command: string; args: readonly string[]; shell: boolean } => {
  const { definition, profileId } = request;
  const prompt = definition.workflow.prompt;

  if (definition.agent === 'mock') {
    if (definition.mock === undefined) {
      throw new Error(`eval ${definition.id}: mock agent requires "mock.command"`);
    }
    return { command: definition.mock.command, args: [], shell: true };
  }
  if (definition.launcher === 'outfitter') {
    return {
      command: 'outfitter',
      args: ['run', '--profile', profileId, '--agent', definition.agent, '--', '-p', prompt],
      shell: false,
    };
  }
  if (definition.agent === 'claude') {
    return { command: 'claude', args: ['-p', prompt, '--output-format', 'json'], shell: false };
  }
  return { command: 'pi', args: ['-p', prompt], shell: false };
};

export const runAgent = async (request: AgentRunRequest): Promise<AgentRunResult> => {
  const { definition } = request;
  const { command, args, shell } = buildCommand(request);
  const started = performance.now();
  const result = await exec({
    command,
    args,
    shell,
    cwd: request.workspace,
    timeoutMs: definition.workflow.timeout_seconds * 1000,
    env: {
      AGENTIC_EVAL_ID: definition.id,
      AGENTIC_EVAL_PROMPT: definition.workflow.prompt,
      AGENTIC_EVAL_PROFILE: request.profileId,
      AGENTIC_EVAL_VARIANT: request.variantId,
    },
  });
  const wallTimeSeconds = (performance.now() - started) / 1000;

  const adapterMetrics: Partial<RunMetrics> =
    definition.agent === 'claude' && definition.launcher === 'direct' ? parseClaudeJsonMetrics(result.stdout) : {};

  return {
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    stdout: result.stdout,
    stderr: result.stderr,
    metrics: { wall_time_seconds: Number(wallTimeSeconds.toFixed(3)), ...adapterMetrics },
  };
};

export const supportedAdapters: readonly AdapterId[] = ['pi', 'claude', 'mock'];
