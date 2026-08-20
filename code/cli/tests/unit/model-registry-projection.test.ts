import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { CompositionPlan } from '../../src/composer/Composition.js';
import { resolveModelRegistry } from '../../src/composer/Models.js';
import { projectComposition } from '../../src/projection/ProjectHarness.js';
import type { EffectiveResourceSet, Layer } from '../../src/resolver/Resource.js';

const temporary: string[] = [];
const root = (): string => {
  const path = mkdtempSync(join(tmpdir(), 'outfitter-models-'));
  temporary.push(path);
  return path;
};
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

const layer = (path: string, label: string, origin: Layer['origin']): Layer => ({ root: path, label, origin });
const writeModels = (path: string, document: unknown): void => {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'models.json'), JSON.stringify(document));
};
const resourceSet = (layers: readonly Layer[]): EffectiveResourceSet => ({
  layers,
  resources: new Map(),
  agentResources: new Map(),
});

const composition = (models: NonNullable<CompositionPlan['models']>): CompositionPlan => ({
  agent: 'luce',
  identity: { agentBody: 'Review the change.' },
  models,
  loadout: {
    skills: [],
    delegateSkills: [],
    subagents: [],
    mcp: [],
    mcpServers: {},
    extensions: [],
    plugins: [],
    model: 'gateway/luna',
  },
  warnings: [],
});

describe('canonical models.json resolution and projection', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.9.1, OFTR-006.9.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('merges layered providers and normalizes the selected provider/model target', () => {
    const catalog = root();
    const workspace = root();
    writeModels(catalog, {
      providers: {
        gateway: {
          name: 'Company gateway',
          api: 'anthropic-messages',
          baseUrl: 'https://models.example.test',
          apiKey: '$COMPANY_MODELS_TOKEN',
          models: [{ id: 'luna', reasoning: true }, { id: 'sol' }],
        },
      },
    });
    writeModels(workspace, {
      providers: {
        gateway: {
          headers: { 'X-Tenant': 'engineering' },
          models: [{ id: 'luna', reasoning: false, input: ['text', 'image'] }],
        },
      },
    });
    const warnings: string[] = [];
    const errors: string[] = [];
    const models = resolveModelRegistry(
      resourceSet([layer(workspace, 'workspace', 'workspace'), layer(catalog, 'catalog', 'source')]),
      'gateway/luna',
      warnings,
      errors,
    );

    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    expect(models.providerSources).toEqual({ gateway: 'workspace' });
    expect(models.target).toEqual({
      providerId: 'gateway',
      modelId: 'luna',
      providerName: 'Company gateway',
      api: 'anthropic-messages',
      baseUrl: 'https://models.example.test',
      credentialVariable: 'COMPANY_MODELS_TOKEN',
      requiredHeaders: { 'X-Tenant': 'engineering' },
      capabilities: { reasoning: false, input: ['text', 'image'] },
      source: 'workspace',
    });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.9.3, OFTR-006.9.4, OFTR-006.9.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('projects one canonical target to Pi, Claude, and Codex native controls', () => {
    const catalog = root();
    writeModels(catalog, {
      providers: {
        gateway: {
          name: 'Company gateway',
          api: 'anthropic-messages',
          baseUrl: 'https://models.example.test',
          apiKey: '$COMPANY_MODELS_TOKEN',
          headers: { 'X-Tenant': 'engineering', 'X-Request-Key': '$REQUEST_KEY' },
          models: [{ id: 'luna', reasoning: true }],
        },
      },
    });
    const errors: string[] = [];
    const models = resolveModelRegistry(resourceSet([layer(catalog, 'catalog', 'source')]), 'gateway/luna', [], errors);
    expect(errors).toEqual([]);
    const plan = composition(models);

    const piRoot = root();
    const pi = projectComposition(plan, { harness: 'pi', rootDirectory: piRoot, homeDirectory: piRoot });
    expect(pi.launch.args).toEqual(expect.arrayContaining(['--provider', 'gateway', '--model', 'luna']));
    expect(JSON.parse(readFileSync(join(piRoot, 'models.json'), 'utf8'))).toEqual(models.document);

    const claudeRoot = root();
    const claude = projectComposition(plan, {
      harness: 'claude',
      rootDirectory: claudeRoot,
      homeDirectory: claudeRoot,
      processEnvironment: { COMPANY_MODELS_TOKEN: 'secret-at-runtime', REQUEST_KEY: 'request-at-runtime' },
    });
    expect(claude.launch.args).toEqual(expect.arrayContaining(['--model', 'luna']));
    expect(claude.launch.env).toMatchObject({
      ANTHROPIC_BASE_URL: 'https://models.example.test',
      ANTHROPIC_AUTH_TOKEN: 'secret-at-runtime',
      ANTHROPIC_CUSTOM_HEADERS: 'X-Tenant: engineering\nX-Request-Key: request-at-runtime',
    });

    const codexModels = {
      ...models,
      target: { ...models.target!, api: 'openai-responses' },
    };
    const codexRoot = root();
    const codex = projectComposition(composition(codexModels), {
      harness: 'codex',
      rootDirectory: codexRoot,
      homeDirectory: codexRoot,
    });
    expect(codex.launch.args).toEqual(expect.arrayContaining(['-m', 'luna']));
    expect(codex.launch.args.join(' ')).toContain('model_providers.gateway.base_url="https://models.example.test"');
    expect(codex.launch.args.join(' ')).toContain('model_providers.gateway.env_key="COMPANY_MODELS_TOKEN"');
    expect(codex.launch.args.join(' ')).toContain('model_providers.gateway.wire_api="responses"');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.9.6, OFTR-006.9.7).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('warns and suppresses model identity when an adapter cannot preserve the endpoint', () => {
    const target = {
      providerId: 'gateway',
      modelId: 'luna',
      api: 'anthropic-messages',
      baseUrl: 'https://models.example.test',
      requiredHeaders: {},
      capabilities: {},
      source: 'catalog',
    };
    const plan = composition({ configured: true, document: { providers: {} }, target });
    const codexRoot = root();
    const codex = projectComposition(plan, { harness: 'codex', rootDirectory: codexRoot, homeDirectory: codexRoot });

    expect(codex.warnings).toContainEqual(expect.stringContaining("cannot project model 'gateway/luna'"));
    expect(codex.launch.args).not.toContain('luna');
    expect(codex.launch.args.join(' ')).not.toContain('models.example.test');
  });

  it('reports malformed registries and unresolved selections without throwing', () => {
    const invalidJson = root();
    writeFileSync(join(invalidJson, 'models.json'), '{');
    const invalidShape = root();
    writeModels(invalidShape, { notProviders: true });
    const malformed = root();
    writeModels(malformed, {
      providers: {
        scalar: true,
        noCredential: { api: 'openai-responses', baseUrl: 'https://example.test', models: 'not-an-array' },
        nonStringCredential: { apiKey: 42, headers: [] },
        invalidHeaders: {
          apiKey: '$VALID',
          headers: { count: 3, Authorization: 'literal-secret', 'X-Safe': '$SAFE_HEADER' },
          models: [{ id: 'known' }],
        },
      },
    });
    const warnings: string[] = [];
    const errors: string[] = [];
    const set = resourceSet([
      layer(invalidJson, 'invalid-json', 'workspace'),
      layer(invalidShape, 'invalid-shape', 'global'),
      layer(malformed, 'malformed', 'source'),
    ]);
    resolveModelRegistry(set, 'invalidHeaders/known', warnings, errors);

    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('not readable JSON'),
        expect.stringContaining("must contain an object-valued 'providers' map"),
        expect.stringContaining("provider 'scalar'"),
      ]),
    );
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('non-string apiKey'),
        expect.stringContaining('non-object headers'),
        expect.stringContaining("header 'count' must be a string"),
        expect.stringContaining('literal Authorization header'),
        expect.stringContaining('must declare string api and baseUrl'),
      ]),
    );

    for (const selected of ['not-qualified', 'missing/model', 'invalidHeaders/missing', 'noCredential/model']) {
      const selectionErrors: string[] = [];
      resolveModelRegistry(resourceSet([layer(malformed, 'malformed', 'source')]), selected, [], selectionErrors);
      expect(selectionErrors.length).toBeGreaterThan(0);
    }
  });

  it('skips a models.json symlink that escapes its layer', () => {
    const catalog = root();
    const outside = join(root(), 'outside-models.json');
    writeFileSync(outside, JSON.stringify({ providers: {} }));
    symlinkSync(outside, join(catalog, 'models.json'));
    const warnings: string[] = [];
    resolveModelRegistry(resourceSet([layer(catalog, 'catalog', 'source')]), undefined, warnings, []);
    expect(warnings).toEqual([expect.stringContaining('resolves outside its resource layer')]);
  });

  it('covers adapter diagnostics for missing runtime values and unsupported native forms', () => {
    const baseTarget = {
      providerId: 'gateway',
      modelId: 'luna',
      api: 'anthropic-messages',
      baseUrl: 'https://models.example.test',
      credentialVariable: 'MISSING_TOKEN',
      requiredHeaders: { 'X-First': 'one', 'X-Second': 'two', 'X-Missing': '$MISSING_HEADER' },
      capabilities: {},
      source: 'catalog',
    };
    const claudeRoot = root();
    const claude = projectComposition(composition({ configured: true, document: {}, target: baseTarget }), {
      harness: 'claude',
      rootDirectory: claudeRoot,
      homeDirectory: claudeRoot,
    });
    expect(claude.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("environment variable 'MISSING_TOKEN'"),
        expect.stringContaining("environment variable 'MISSING_HEADER'"),
      ]),
    );

    const unsupportedClaude = projectComposition(
      composition({ configured: true, document: {}, target: { ...baseTarget, api: 'openai-responses' } }),
      { harness: 'claude', rootDirectory: root(), homeDirectory: root() },
    );
    expect(unsupportedClaude.warnings).toContainEqual(expect.stringContaining('cannot project model'));

    const codex = projectComposition(
      composition({
        configured: true,
        document: {},
        target: {
          ...baseTarget,
          providerName: undefined,
          api: 'openai-responses',
          credentialVariable: undefined,
          requiredHeaders: {},
        },
      }),
      { harness: 'codex', rootDirectory: root(), homeDirectory: root() },
    );
    expect(codex.launch.args.join(' ')).toContain('wire_api="responses"');

    const unsupportedCodex = projectComposition(
      composition({
        configured: true,
        document: {},
        target: { ...baseTarget, api: 'openai-completions' },
      }),
      { harness: 'codex', rootDirectory: root(), homeDirectory: root() },
    );
    expect(unsupportedCodex.warnings).toContainEqual(expect.stringContaining('cannot project model'));
    expect(unsupportedCodex.launch.args).not.toContain('luna');

    const invalidProvider = projectComposition(
      composition({
        configured: true,
        document: {},
        target: { ...baseTarget, providerId: 'not.valid', api: 'openai-responses' },
      }),
      { harness: 'codex', rootDirectory: root(), homeDirectory: root() },
    );
    expect(invalidProvider.warnings).toContainEqual(expect.stringContaining("provider id 'not.valid'"));
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.9.7).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('rejects literal and command-sourced catalog credentials', () => {
    const catalog = root();
    writeModels(catalog, {
      providers: {
        literal: { apiKey: 'do-not-commit-me', models: [] },
        command: { apiKey: '$SAFE_REFERENCE', credentialCommand: 'print-token', models: [] },
      },
    });
    const errors: string[] = [];
    resolveModelRegistry(resourceSet([layer(catalog, 'catalog', 'source')]), undefined, [], errors);
    expect(errors).toEqual([
      expect.stringContaining("provider 'literal'"),
      expect.stringContaining("forbidden credential command 'credentialCommand'"),
    ]);
  });
});
