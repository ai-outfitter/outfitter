// Tests shared adapter helper behavior.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  findUnsupportedControlNames,
  flagValue,
  genericControlNames,
  mergeAgentSpecificControls,
  repeatFlag,
} from '../../src/agents/AdapterProfileControls.js';
import {
  createDeclaredStatePaths,
  findProfileStateSource,
  resolveStateStrategy,
} from '../../src/agents/AdapterStatePaths.js';
import type { Profile, ProfileControls } from '../../src/profiles/Profile.js';
import type { StatePathDeclaration } from '../../src/compositeProfile/StatePersistence.js';

const createTemporaryRoot = (): string => mkdtempSync(join(tmpdir(), 'outfitter-adapter-helpers-'));

describe('adapter helper modules', () => {
  it('merges agent-specific controls and constructs argv fragments', () => {
    const controls: ProfileControls = {
      model: 'generic-model',
      environment: { BASE: '1' },
      claude: {
        model: undefined,
        thinking: 'high',
        environment: { CLAUDE: '1' },
      },
    };

    expect(genericControlNames.has('session_directory')).toBe(true);
    expect(mergeAgentSpecificControls(controls, 'claude')).toEqual({
      model: 'generic-model',
      environment: { BASE: '1', CLAUDE: '1' },
      claude: {
        model: undefined,
        thinking: 'high',
        environment: { CLAUDE: '1' },
      },
      thinking: 'high',
    });
    expect(flagValue('--model', 'sonnet')).toEqual(['--model', 'sonnet']);
    expect(flagValue('--model', undefined)).toEqual([]);
    expect(repeatFlag('--skill', ['a', 'b'])).toEqual(['--skill', 'a', '--skill', 'b']);
    expect(repeatFlag('--skill', undefined)).toEqual([]);
  });

  it('finds unsupported controls while normalizing aliases', () => {
    expect(
      findUnsupportedControlNames(
        { prompt_template: 'template', custom: true },
        new Set(['model']),
        genericControlNames,
      ),
    ).toEqual(['prompt_template', 'custom']);
    expect(
      findUnsupportedControlNames(
        { system_prompt: 'prompt', systemPrompt: 'prompt' },
        new Set(['systemPrompt']),
        genericControlNames,
      ),
    ).toEqual([]);
  });

  it('plans declared state paths and validates persistence strategies', () => {
    const declarations = {
      'settings.json': { defaultStrategy: 'symlink', allowedStrategies: ['symlink', 'warn'] },
      'cache/': { defaultStrategy: 'discard', allowedStrategies: ['symlink', 'discard'] },
      unknown: { defaultStrategy: 'warn', allowedStrategies: ['discard', 'warn'] },
    } as const satisfies Readonly<Record<string, StatePathDeclaration>>;
    const sourceCalls: string[] = [];
    const profile = {
      id: 'test',
      inherits: [],
      controls: {},
      statePersistence: { 'settings.json': 'warn' },
    } satisfies Profile;

    expect(
      createDeclaredStatePaths({
        adapterId: 'test',
        declarations,
        profile,
        resolveSourcePath(relativePath, directory) {
          sourceCalls.push(`${relativePath}:${directory}`);
          return `/state/${relativePath}`;
        },
      }),
    ).toEqual([
      { relativePath: 'settings.json', strategy: 'warn', directory: false, sourcePath: undefined },
      { relativePath: 'cache/', strategy: 'discard', directory: true, sourcePath: undefined },
      { relativePath: 'unknown', strategy: 'warn', directory: false, sourcePath: undefined },
    ]);
    expect(sourceCalls).toEqual([]);

    expect(
      createDeclaredStatePaths({
        adapterId: 'test',
        declarations,
        profile: { id: 'test', inherits: [], controls: {}, statePersistence: {} },
        resolveSourcePath(relativePath, directory) {
          return `/state/${relativePath}:${directory}`;
        },
      })[0],
    ).toEqual({
      relativePath: 'settings.json',
      strategy: 'symlink',
      directory: false,
      sourcePath: '/state/settings.json:false',
    });
    expect(resolveStateStrategy(profile, 'settings.json', declarations['settings.json'])).toBe('warn');
    expect(() =>
      createDeclaredStatePaths({
        adapterId: 'test',
        declarations,
        profile: { id: 'bad', inherits: [], controls: {}, statePersistence: { 'missing/': 'warn' } },
        resolveSourcePath: () => '/state',
      }),
    ).toThrow("state_persistence path 'missing/' is not declared by the test adapter");
    expect(() =>
      resolveStateStrategy({ id: 'bad', inherits: [], controls: {}, statePersistence: {} }, 'missing-default', {
        allowedStrategies: ['warn'],
      }),
    ).toThrow('missing state_persistence strategy');
    expect(() =>
      resolveStateStrategy(
        { id: 'bad', inherits: [], controls: {}, statePersistence: { 'settings.json': 'error' } },
        'settings.json',
        declarations['settings.json'],
      ),
    ).toThrow("state_persistence strategy 'error' is not allowed");
  });

  it('finds profile state sources by adapter and normalized path', () => {
    const root = createTemporaryRoot();
    const lower = join(root, 'lower');
    const higher = join(root, 'higher');
    const higherSettings = join(higher, 'cli_specific', 'pi', 'settings.json');
    const higherPlugins = join(higher, 'cli_specific', 'pi', 'plugins');
    mkdirSync(join(lower, 'cli_specific', 'pi'), { recursive: true });
    mkdirSync(higherPlugins, { recursive: true });
    writeFileSync(join(lower, 'cli_specific', 'pi', 'settings.json'), '{}\n');
    writeFileSync(higherSettings, '{}\n');

    expect(findProfileStateSource([lower, higher], 'pi', 'settings.json', false)).toBe(higherSettings);
    expect(findProfileStateSource([lower, higher], 'pi', 'plugins/', true)).toBe(higherPlugins);
    expect(findProfileStateSource([lower, higher], 'claude', 'settings.json', false)).toBeUndefined();
  });
});
