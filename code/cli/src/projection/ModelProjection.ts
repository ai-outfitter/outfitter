// Projects one normalized models.json target without changing its provider endpoint or identity.
import type { CompositionPlan } from '../composer/Composition.js';
import type { ModelTarget } from '../composer/Models.js';
import type { Harness } from '../settings/Settings.js';
import type { ProjectionInput } from './Projection.js';

export interface ProjectedModel {
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly warnings: readonly string[];
}

const tomlString = (value: string): string => JSON.stringify(value);
const tomlInlineTable = (value: Readonly<Record<string, string>>): string =>
  `{ ${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${tomlString(key)} = ${tomlString(item)}`)
    .join(', ')} }`;
const override = (key: string, value: string): readonly string[] => ['-c', `${key}=${value}`];
const environmentReference = (value: string): string | undefined => /^\$([A-Za-z_][A-Za-z0-9_]*)$/u.exec(value)?.[1];

const legacyModel = (composition: CompositionPlan, harness: Harness): ProjectedModel => ({
  args:
    composition.loadout.model === undefined ? [] : [harness === 'codex' ? '-m' : '--model', composition.loadout.model],
  env: {},
  warnings: [],
});

const projectPi = (target: ModelTarget): ProjectedModel => ({
  args: ['--provider', target.providerId, '--model', target.modelId],
  env: {},
  warnings: [],
});

const resolveClaudeHeader = (
  name: string,
  value: string,
  environment: Readonly<Record<string, string | undefined>>,
  warnings: string[],
): string | undefined => {
  const reference = environmentReference(value);
  if (reference === undefined) return `${name}: ${value}`;
  const resolved = environment[reference];
  if (resolved === undefined) {
    warnings.push(`claude model header '${name}' requires environment variable '${reference}', but it is not set.`);
    return undefined;
  }
  return `${name}: ${resolved}`;
};

const projectClaude = (target: ModelTarget, input: ProjectionInput): ProjectedModel => {
  if (target.api !== 'anthropic-messages') {
    return {
      args: [],
      env: {},
      warnings: [
        `claude adapter cannot project model '${target.providerId}/${target.modelId}' from '${target.source}' with API dialect '${target.api}'.`,
      ],
    };
  }
  const environment = input.processEnvironment ?? {};
  const warnings: string[] = [];
  const env: Record<string, string> = { ANTHROPIC_BASE_URL: target.baseUrl };
  if (target.credentialVariable !== undefined) {
    const credential = environment[target.credentialVariable];
    if (credential === undefined) {
      warnings.push(
        `claude model '${target.providerId}/${target.modelId}' requires environment variable '${target.credentialVariable}', but it is not set.`,
      );
    } else env.ANTHROPIC_AUTH_TOKEN = credential;
  }
  const headers = Object.entries(target.requiredHeaders)
    .map(([name, value]) => resolveClaudeHeader(name, value, environment, warnings))
    .filter((header): header is string => header !== undefined);
  if (headers.length > 0) env.ANTHROPIC_CUSTOM_HEADERS = headers.join('\n');
  return { args: ['--model', target.modelId], env, warnings };
};

const codexWireApi = (api: string): string | undefined => {
  if (api === 'openai-responses') return 'responses';
  return undefined;
};

const codexHeaderArgs = (target: ModelTarget, prefix: string): readonly string[] => {
  const literalHeaders: Record<string, string> = {};
  const environmentHeaders: Record<string, string> = {};
  for (const [name, value] of Object.entries(target.requiredHeaders)) {
    const reference = environmentReference(value);
    if (reference === undefined) literalHeaders[name] = value;
    else environmentHeaders[name] = reference;
  }
  return [
    ...(Object.keys(literalHeaders).length === 0
      ? []
      : override(`${prefix}.http_headers`, tomlInlineTable(literalHeaders))),
    ...(Object.keys(environmentHeaders).length === 0
      ? []
      : override(`${prefix}.env_http_headers`, tomlInlineTable(environmentHeaders))),
  ];
};

const projectCodex = (target: ModelTarget): ProjectedModel => {
  const wireApi = codexWireApi(target.api);
  if (wireApi === undefined) {
    return {
      args: [],
      env: {},
      warnings: [
        `codex adapter cannot project model '${target.providerId}/${target.modelId}' from '${target.source}' with API dialect '${target.api}'.`,
      ],
    };
  }
  if (!/^[A-Za-z0-9_-]+$/u.test(target.providerId)) {
    return {
      args: [],
      env: {},
      warnings: [
        `codex adapter cannot project provider id '${target.providerId}' from '${target.source}'; use letters, numbers, '_' or '-'.`,
      ],
    };
  }
  const prefix = `model_providers.${target.providerId}`;
  const args = [
    ...override('model_provider', tomlString(target.providerId)),
    ...override(`${prefix}.name`, tomlString(target.providerName ?? target.providerId)),
    ...override(`${prefix}.base_url`, tomlString(target.baseUrl)),
    ...override(`${prefix}.wire_api`, tomlString(wireApi)),
  ];
  if (target.credentialVariable !== undefined) {
    args.push(...override(`${prefix}.env_key`, tomlString(target.credentialVariable)));
  }
  args.push(...codexHeaderArgs(target, prefix), '-m', target.modelId);
  return { args, env: {}, warnings: [] };
};

export const projectModel = (composition: CompositionPlan, input: ProjectionInput): ProjectedModel => {
  const target = composition.models?.target;
  if (target === undefined) return legacyModel(composition, input.harness);
  switch (input.harness) {
    case 'pi':
      return projectPi(target);
    case 'claude':
      return projectClaude(target, input);
    case 'codex':
      return projectCodex(target);
  }
};
