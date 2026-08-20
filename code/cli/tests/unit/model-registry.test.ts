import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CompositionPlan } from '../../src/composer/Composition.js';
import { resolveModelRegistry } from '../../src/projection/ModelRegistry.js';
import { projectComposition } from '../../src/projection/ProjectHarness.js';
import type { EffectiveResourceSet, Layer } from '../../src/resolver/Resource.js';

const roots: string[] = [];
const root = (): string => {
  const path = mkdtempSync(join(tmpdir(), 'outfitter-models-'));
  roots.push(path);
  return path;
};
afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
});

const layer = (path: string, origin: Layer['origin'], label: string): Layer => ({ root: path, origin, label });
const set = (layers: readonly Layer[]): EffectiveResourceSet => ({
  layers,
  resources: new Map(),
  agentResources: new Map(),
});
const writeModels = (path: string, providers: Record<string, unknown>): void => {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'models.json'), JSON.stringify({ providers }));
};
const parsedProviders = (content: string): Record<string, { baseUrl: string }> =>
  (JSON.parse(content) as { providers: Record<string, { baseUrl: string }> }).providers;
const provider = (api: string, baseUrl: string, id: string, apiKey = '$COMPANY_AI_TOKEN') => ({
  api,
  baseUrl,
  apiKey,
  headers: { 'x-company': 'agents' },
  models: [{ id, reasoning: true, input: ['text'] }],
});
const plan = (model: string): CompositionPlan => ({
  agent: 'engineer',
  identity: { agentBody: 'Engineer.' },
  loadout: {
    skills: [],
    delegateSkills: [],
    subagents: [],
    mcp: [],
    mcpServers: {},
    extensions: [],
    plugins: [],
    model,
  },
  warnings: [],
});

// THIS TEST VALIDATES THE MODEL-REGISTRY LAYER-PRECEDENCE REQUIREMENT IN #321.
// YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
it('resolves a selected provider from the highest-precedence models.json layer', () => {
  const high = root();
  const low = root();
  writeModels(low, { company: provider('openai-completions', 'https://old.example/v1', 'coder') });
  writeModels(high, { company: provider('openai-responses', 'https://gateway.example/v1', 'coder') });
  const result = resolveModelRegistry(
    set([layer(high, 'global', 'user'), layer(low, 'source', 'catalog')]),
    'company/coder',
  );
  expect(result.errors).toEqual([]);
  expect(result.target).toMatchObject({
    provider: 'company',
    model: 'coder',
    api: 'openai-responses',
    baseUrl: 'https://gateway.example/v1',
    credentialVariable: 'COMPANY_AI_TOKEN',
    source: 'user',
  });
  expect(parsedProviders(result.content!).company?.baseUrl).toBe('https://gateway.example/v1');
});

// THIS TEST VALIDATES THE UNTRUSTED-CREDENTIAL REJECTION REQUIREMENT IN #321.
// YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
it('rejects literal credentials and credential commands from project or remote layers', () => {
  for (const [origin, key] of [
    ['workspace', 'secret-value'],
    ['source', '!read-secret'],
  ] as const) {
    const path = root();
    writeModels(path, { company: provider('openai-completions', 'https://gateway.example/v1', 'coder', key) });
    expect(resolveModelRegistry(set([layer(path, origin, origin)]), 'company/coder').errors.join('\n')).toContain(
      'literals and commands are rejected',
    );
  }
});

it('reports malformed registries and unresolved selections without executing catalog values', () => {
  const malformed = root();
  mkdirSync(malformed, { recursive: true });
  writeFileSync(join(malformed, 'models.json'), '{');
  expect(resolveModelRegistry(set([layer(malformed, 'source', 'broken')]), 'x').errors.join()).toContain(
    'not readable JSON',
  );

  const invalid = root();
  writeFileSync(join(invalid, 'models.json'), JSON.stringify({ providers: { broken: 1 } }));
  expect(resolveModelRegistry(set([layer(invalid, 'source', 'invalid')]), 'x').errors.join()).toContain(
    "provider 'broken' must be an object",
  );

  const absent = root();
  writeFileSync(join(absent, 'models.json'), JSON.stringify({ wrong: {} }));
  expect(resolveModelRegistry(set([layer(absent, 'source', 'absent')]), 'x').errors.join()).toContain(
    'must contain a providers object',
  );

  const variants = root();
  writeModels(variants, {
    noModels: { api: 'openai-completions', baseUrl: 'https://example' },
    one: { ...provider('openai-completions', 'https://one', 'same'), apiKey: '${TOKEN}' },
    two: provider('openai-completions', 'https://two', 'same'),
    missingApi: { baseUrl: 'https://example', models: [{ id: 'bad' }] },
    commandHeader: {
      ...provider('openai-completions', 'https://example', 'header'),
      apiKey: undefined,
      headers: { authorization: '!read-secret' },
    },
  });
  const registrySet = set([layer(variants, 'source', 'variants')]);
  expect(resolveModelRegistry(registrySet, undefined).content).toBeDefined();
  expect(resolveModelRegistry(registrySet, 'unknown').errors.join()).toContain('does not exist');
  expect(resolveModelRegistry(registrySet, 'same').errors.join()).toContain('ambiguous');
  expect(resolveModelRegistry(registrySet, 'missingApi/bad').errors.join()).toContain('api and baseUrl');
  expect(resolveModelRegistry(registrySet, 'commandHeader/header').errors.join()).toContain(
    'cannot execute a credential command',
  );
  expect(resolveModelRegistry(registrySet, 'one/same').target?.credentialVariable).toBe('TOKEN');
});

describe('model adapter projection', () => {
  it('materializes Pi models and selects the resolved provider and model', () => {
    const catalog = root();
    const runtime = root();
    writeModels(catalog, { company: provider('openai-completions', 'https://gateway.example/v1', 'coder') });
    const registry = resolveModelRegistry(set([layer(catalog, 'source', 'catalog')]), 'company/coder');
    const result = projectComposition(plan('company/coder'), {
      harness: 'pi',
      rootDirectory: runtime,
      homeDirectory: runtime,
      modelRegistry: registry,
    });
    expect(result.launch.args).toEqual(expect.arrayContaining(['--provider', 'company', '--model', 'coder']));
    expect(parsedProviders(readFileSync(join(runtime, 'models.json'), 'utf8')).company?.baseUrl).toBe(
      'https://gateway.example/v1',
    );
  });

  it('projects an Anthropic target through Claude native gateway controls', () => {
    const catalog = root();
    const runtime = root();
    writeModels(catalog, { company: provider('anthropic-messages', 'https://claude.example', 'sonnet') });
    const registry = resolveModelRegistry(set([layer(catalog, 'source', 'catalog')]), 'company/sonnet');
    const result = projectComposition(plan('company/sonnet'), {
      harness: 'claude',
      rootDirectory: runtime,
      homeDirectory: runtime,
      modelRegistry: registry,
    });
    expect(result.launch.args).toEqual(expect.arrayContaining(['--model', 'sonnet']));
    expect(result.launch.env).toMatchObject({ ANTHROPIC_BASE_URL: 'https://claude.example' });
    expect(result.launch.envReferences).toEqual({ ANTHROPIC_AUTH_TOKEN: 'COMPANY_AI_TOKEN' });
    expect(result.warnings).toEqual([]);
  });

  it('projects an OpenAI target through Codex native provider controls', () => {
    const catalog = root();
    const runtime = root();
    writeModels(catalog, { company: provider('openai-responses', 'https://codex.example/v1', 'gpt') });
    const registry = resolveModelRegistry(set([layer(catalog, 'source', 'catalog')]), 'company/gpt');
    const result = projectComposition(plan('company/gpt'), {
      harness: 'codex',
      rootDirectory: runtime,
      homeDirectory: runtime,
      modelRegistry: registry,
    });
    expect(result.launch.args).toEqual(
      expect.arrayContaining([
        '-c',
        'model_provider="company"',
        '-c',
        'model_providers.company.base_url="https://codex.example/v1"',
        '-m',
        'gpt',
      ]),
    );
    expect(result.warnings.join('\n')).not.toContain('model');
  });

  it('projects keyless OpenAI chat providers without fabricating a credential', () => {
    const catalog = root();
    const runtime = root();
    writeModels(catalog, {
      local: { api: 'openai-completions', baseUrl: 'http://localhost:11434/v1', models: [{ id: 'llama' }] },
    });
    const registry = resolveModelRegistry(set([layer(catalog, 'global', 'user')]), 'local/llama');
    const result = projectComposition(plan('local/llama'), {
      harness: 'codex',
      rootDirectory: runtime,
      homeDirectory: runtime,
      modelRegistry: registry,
    });
    expect(result.launch.args.join(' ')).toContain('wire_api="chat"');
    expect(result.launch.args.join(' ')).not.toContain('env_key');
  });

  it('surfaces registry errors and unsupported Claude dialects without a model fallback', () => {
    const runtime = root();
    const invalid = projectComposition(plan('company/gpt'), {
      harness: 'pi',
      rootDirectory: runtime,
      homeDirectory: runtime,
      modelRegistry: { warnings: [], errors: ['rejected registry'] },
    });
    expect(invalid.warnings.join()).toContain('rejected registry');
    expect(invalid.launch.args).not.toContain('--model');

    const catalog = root();
    writeModels(catalog, { company: provider('openai-responses', 'https://example/v1', 'gpt') });
    const registry = resolveModelRegistry(set([layer(catalog, 'global', 'user')]), 'company/gpt');
    const claude = projectComposition(plan('company/gpt'), {
      harness: 'claude',
      rootDirectory: root(),
      homeDirectory: runtime,
      modelRegistry: registry,
    });
    expect(claude.warnings.join()).toContain('claude adapter cannot project');
    expect(claude.launch.args).not.toContain('--model');
  });

  it('warns and suppresses endpoint fallback for unsupported dialects', () => {
    const catalog = root();
    const runtime = root();
    writeModels(catalog, { company: provider('anthropic-messages', 'https://claude.example', 'sonnet') });
    const registry = resolveModelRegistry(set([layer(catalog, 'source', 'catalog')]), 'company/sonnet');
    const result = projectComposition(plan('company/sonnet'), {
      harness: 'codex',
      rootDirectory: runtime,
      homeDirectory: runtime,
      modelRegistry: registry,
    });
    expect(result.warnings.join('\n')).toContain('cannot project');
    expect(result.launch.args).not.toContain('-m');
    expect(result.launch.args.join(' ')).not.toContain('model_providers');
  });
});
