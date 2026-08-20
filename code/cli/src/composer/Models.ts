// Resolves the layered Pi models.json registry into a harness-neutral selected model target.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { escapesRoots } from '../dump/Containment.js';
import type { EffectiveResourceSet, Layer } from '../resolver/Resource.js';

export interface ModelTarget {
  readonly providerId: string;
  readonly modelId: string;
  readonly providerName?: string;
  readonly api: string;
  readonly baseUrl: string;
  readonly credentialVariable?: string;
  readonly requiredHeaders: Readonly<Record<string, string>>;
  readonly capabilities: Readonly<Record<string, unknown>>;
  readonly source: string;
}

export interface EffectiveModelRegistry {
  readonly document: Readonly<Record<string, unknown>>;
  /** Winning layer label for every effective provider definition. */
  readonly providerSources?: Readonly<Record<string, string>>;
  readonly target?: ModelTarget;
  readonly configured: boolean;
}

type JsonRecord = Record<string, unknown>;
interface ProviderEntry {
  readonly definition: JsonRecord;
  readonly layer: Layer;
}

const asRecord = (value: unknown): JsonRecord | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : undefined;

const modelsById = (value: unknown): Map<string, JsonRecord> => {
  const models = new Map<string, JsonRecord>();
  if (!Array.isArray(value)) return models;
  for (const item of value) {
    const model = asRecord(item);
    if (model !== undefined && typeof model.id === 'string') models.set(model.id, model);
  }
  return models;
};

const mergeProvider = (lower: JsonRecord | undefined, higher: JsonRecord): JsonRecord => {
  if (lower === undefined) return higher;
  const models = modelsById(lower.models);
  for (const [id, model] of modelsById(higher.models)) {
    models.set(id, { ...models.get(id), ...model });
  }
  return {
    ...lower,
    ...higher,
    ...(models.size === 0 ? {} : { models: [...models.values()] }),
  };
};

const readProviders = (path: string, warnings: string[]): JsonRecord => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (error) {
    warnings.push(`Model registry '${path}' is not readable JSON: ${String(error)}`);
    return {};
  }
  const providers = asRecord(asRecord(parsed)?.providers);
  if (providers === undefined) {
    warnings.push(`Model registry '${path}' must contain an object-valued 'providers' map.`);
    return {};
  }
  return providers;
};

const credentialReference = (
  providerId: string,
  provider: JsonRecord,
  source: string,
  errors: string[],
): string | undefined => {
  for (const key of ['apiKeyCommand', 'credentialCommand', 'authCommand']) {
    if (key in provider)
      errors.push(`Model provider '${providerId}' from '${source}' declares forbidden credential command '${key}'.`);
  }
  if (provider.apiKey === undefined) return undefined;
  if (typeof provider.apiKey !== 'string') {
    errors.push(`Model provider '${providerId}' from '${source}' has a non-string apiKey; use '$ENV_VARIABLE'.`);
    return undefined;
  }
  const match = /^\$([A-Za-z_][A-Za-z0-9_]*)$/u.exec(provider.apiKey);
  if (match === null) {
    errors.push(`Model provider '${providerId}' from '${source}' contains a literal credential; use '$ENV_VARIABLE'.`);
    return undefined;
  }
  return match[1];
};

const headersFrom = (
  providerId: string,
  provider: JsonRecord,
  source: string,
  errors: string[],
): Readonly<Record<string, string>> => {
  if (provider.headers === undefined) return {};
  const headers = asRecord(provider.headers);
  if (headers === undefined) {
    errors.push(`Model provider '${providerId}' from '${source}' has non-object headers.`);
    return {};
  }
  const selected: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value !== 'string') {
      errors.push(`Model provider '${providerId}' from '${source}' header '${name}' must be a string.`);
      continue;
    }
    if (name.toLowerCase() === 'authorization' && !/^\$[A-Za-z_][A-Za-z0-9_]*$/u.test(value)) {
      errors.push(
        `Model provider '${providerId}' from '${source}' contains a literal Authorization header; use '$ENV_VARIABLE'.`,
      );
      continue;
    }
    selected[name] = value;
  }
  return selected;
};

const normalizeTarget = (
  selectedModel: string | undefined,
  providers: ReadonlyMap<string, ProviderEntry>,
  configured: boolean,
  errors: string[],
): ModelTarget | undefined => {
  if (selectedModel === undefined || !configured) return undefined;
  const separator = selectedModel.indexOf('/');
  if (separator < 1 || separator === selectedModel.length - 1) {
    errors.push(`Selected model '${selectedModel}' must use the provider/model form when models.json is configured.`);
    return undefined;
  }
  const providerId = selectedModel.slice(0, separator);
  const modelId = selectedModel.slice(separator + 1);
  const entry = providers.get(providerId);
  if (entry === undefined) {
    errors.push(`Selected model '${selectedModel}' references unknown provider '${providerId}'.`);
    return undefined;
  }
  const model = modelsById(entry.definition.models).get(modelId);
  if (model === undefined) {
    errors.push(`Selected model '${selectedModel}' is not declared by provider '${providerId}'.`);
    return undefined;
  }
  const api = entry.definition.api;
  const baseUrl = entry.definition.baseUrl;
  if (typeof api !== 'string' || typeof baseUrl !== 'string') {
    errors.push(
      `Model provider '${providerId}' from '${entry.layer.label}' must declare string api and baseUrl values.`,
    );
    return undefined;
  }
  return {
    providerId,
    modelId,
    providerName: typeof entry.definition.name === 'string' ? entry.definition.name : undefined,
    api,
    baseUrl,
    credentialVariable: credentialReference(providerId, entry.definition, entry.layer.label, []),
    requiredHeaders: headersFrom(providerId, entry.definition, entry.layer.label, []),
    capabilities: Object.fromEntries(Object.entries(model).filter(([key]) => !['id', 'name'].includes(key))),
    source: entry.layer.label,
  };
};

export const resolveModelRegistry = (
  set: EffectiveResourceSet,
  selectedModel: string | undefined,
  warnings: string[],
  errors: string[],
): EffectiveModelRegistry => {
  const providers = new Map<string, ProviderEntry>();
  let configured = false;
  for (const layer of [...set.layers].reverse()) {
    const path = join(layer.root, 'models.json');
    if (!existsSync(path)) continue;
    configured = true;
    if (escapesRoots(path, [layer.root])) {
      warnings.push(`Model registry '${path}' resolves outside its resource layer and was skipped.`);
      continue;
    }
    for (const [providerId, value] of Object.entries(readProviders(path, warnings))) {
      const provider = asRecord(value);
      if (provider === undefined) {
        warnings.push(`Model provider '${providerId}' from '${layer.label}' must be an object.`);
        continue;
      }
      // Validate every declaration before precedence merging: a shadowed catalog entry still must
      // not contain a literal secret or executable credential source.
      credentialReference(providerId, provider, layer.label, errors);
      headersFrom(providerId, provider, layer.label, errors);
      providers.set(providerId, {
        definition: mergeProvider(providers.get(providerId)?.definition, provider),
        layer,
      });
    }
  }

  const document = { providers: Object.fromEntries([...providers].map(([id, entry]) => [id, entry.definition])) };
  return {
    document,
    providerSources: Object.fromEntries([...providers].map(([id, entry]) => [id, entry.layer.label])),
    target: normalizeTarget(selectedModel, providers, configured, errors),
    configured,
  };
};
