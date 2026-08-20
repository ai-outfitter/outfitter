/* eslint-disable complexity -- registry parsing keeps complete per-layer diagnostics in one pass. */
// Resolves the canonical .agents/models.json registry into harness-neutral model targets.
import { existsSync, readFileSync } from 'node:fs';
import type { EffectiveResourceSet, Layer } from '../resolver/Resource.js';

export type ModelApi = 'anthropic-messages' | 'openai-completions' | 'openai-responses' | 'google-generative-ai';

export interface ModelTarget {
  readonly provider: string;
  readonly model: string;
  readonly api: ModelApi;
  readonly baseUrl: string;
  readonly credentialVariable?: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly capabilities: Readonly<Record<string, unknown>>;
  readonly source: string;
}

export interface EffectiveModelRegistry {
  readonly content?: string;
  readonly target?: ModelTarget;
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
}

type RecordValue = Readonly<Record<string, unknown>>;
interface ProviderEntry {
  readonly value: RecordValue;
  readonly layer: Layer;
}

const record = (value: unknown): RecordValue | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as RecordValue) : undefined;
const stringRecord = (value: unknown): Readonly<Record<string, string>> => {
  const object = record(value);
  return object === undefined
    ? {}
    : Object.fromEntries(
        Object.entries(object).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      );
};
const isModelApi = (value: unknown): value is ModelApi =>
  typeof value === 'string' &&
  ['anthropic-messages', 'openai-completions', 'openai-responses', 'google-generative-ai'].includes(value);

const credentialVariable = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  return /^\$[A-Z_][A-Z0-9_]*$/.test(value)
    ? value.slice(1)
    : /^\$\{[A-Z_][A-Z0-9_]*\}$/.test(value)
      ? value.slice(2, -1)
      : undefined;
};

/** Provider definitions merge by provider id; the highest-precedence layer supplies each id. */
// Registry parsing deliberately keeps diagnostics in one pass so every malformed layer is reported.
export const resolveModelRegistry = (
  set: EffectiveResourceSet,
  selection: string | undefined,
): EffectiveModelRegistry => {
  const providers = new Map<string, ProviderEntry>();
  const warnings: string[] = [];
  const errors: string[] = [];

  for (const layer of [...set.layers].reverse()) {
    const path = `${layer.root}/models.json`;
    if (!existsSync(path)) continue;
    let document: unknown;
    try {
      document = JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      errors.push(`${layer.label} models.json is not readable JSON: ${String(error)}`);
      continue;
    }
    const definitions = record(record(document)?.providers);
    if (definitions === undefined) {
      errors.push(`${layer.label} models.json must contain a providers object.`);
      continue;
    }
    for (const [id, value] of Object.entries(definitions)) {
      const provider = record(value);
      if (provider === undefined) errors.push(`${layer.label} models.json provider '${id}' must be an object.`);
      else providers.set(id, { value: provider, layer });
    }
  }

  if (providers.size === 0) return { warnings, errors };

  // Emit a flattened native Pi registry so layer precedence is identical in all harnesses.
  const content = `${JSON.stringify({ providers: Object.fromEntries([...providers].map(([id, entry]) => [id, entry.value])) }, null, 2)}\n`;
  if (selection === undefined) return { content, warnings, errors };

  const matches: { provider: string; model: RecordValue; entry: ProviderEntry }[] = [];
  for (const [provider, entry] of providers) {
    const models = Array.isArray(entry.value.models) ? entry.value.models : [];
    for (const candidate of models) {
      const model = record(candidate);
      if (
        model !== undefined &&
        typeof model.id === 'string' &&
        (selection === model.id || selection === `${provider}/${model.id}`)
      )
        matches.push({ provider, model, entry });
    }
  }
  if (matches.length !== 1) {
    const detail = matches.length === 0 ? 'does not exist' : 'is ambiguous; select provider/model';
    errors.push(`model '${selection}' ${detail} in the effective models.json registry.`);
    return { content, warnings, errors };
  }

  const match = matches[0];
  const api = match.model.api ?? match.entry.value.api;
  const baseUrl = match.entry.value.baseUrl;
  if (!isModelApi(api) || typeof baseUrl !== 'string') {
    errors.push(`model '${selection}' from ${match.entry.layer.label} must resolve an api and baseUrl.`);
    return { content, warnings, errors };
  }

  const apiKey = match.entry.value.apiKey;
  const untrusted = match.entry.layer.origin === 'workspace' || match.entry.layer.origin === 'source';
  if (untrusted && typeof apiKey === 'string' && credentialVariable(apiKey) === undefined)
    errors.push(
      `provider '${match.provider}' from ${match.entry.layer.label} must use an environment variable reference for apiKey; literals and commands are rejected.`,
    );
  const headers = stringRecord(match.entry.value.headers);
  if (untrusted && Object.values(headers).some((value) => value.startsWith('!')))
    errors.push(
      `provider '${match.provider}' from ${match.entry.layer.label} cannot execute a credential command in headers.`,
    );

  const capabilities = {
    ...record(match.entry.value.compat),
    ...record(match.model.compat),
    reasoning: match.model.reasoning,
    input: match.model.input,
  };
  const target: ModelTarget = {
    provider: match.provider,
    model: match.model.id,
    api,
    baseUrl,
    credentialVariable: credentialVariable(apiKey),
    headers,
    capabilities,
    source: match.entry.layer.label,
  };
  return { content, target, warnings, errors };
};
