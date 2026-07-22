// Declares runtime behavior and published status for every cross-harness composition concept.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { expect } from 'vitest';

import { attachPiRuntimeExtension } from '../../src/cli/commands/PiRuntimeLaunch.js';
import type { CompositionPlan } from '../../src/composer/Composition.js';
import type { ResolvedResource, ResourceKind } from '../../src/resolver/Resource.js';
import type { ConformanceFixturePaths, ConformanceRow } from './ConformanceSpec.js';

const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

const resource = (
  paths: ConformanceFixturePaths,
  kind: ResourceKind,
  slug: string,
  relativePath: string,
): ResolvedResource => ({
  kind,
  slug,
  winner: {
    kind,
    slug,
    path: join(paths.projectDirectory, '.agents', relativePath),
    layer: { root: join(paths.projectDirectory, '.agents'), origin: 'workspace', label: 'workspace' },
  },
  shadowed: [],
});

export const baseComposition = (overrides: Partial<CompositionPlan['loadout']> = {}): CompositionPlan => ({
  agent: 'conformance',
  identity: { systemPrompt: 'SYSTEM', sharedContext: 'SHARED', agentBody: 'AGENT' },
  loadout: {
    skills: [],
    subagents: [],
    mcp: [],
    extensions: [],
    plugins: [],
    ...overrides,
  },
  warnings: [],
});

const deferred = (documentedStatus: 'Supported' | 'Partial' | 'Roadmap' | 'Future', justification: string) => ({
  status: 'deferred' as const,
  documentedStatus,
  justification,
});

const unsupported = (
  documentedStatus: 'Supported' | 'Partial' | 'Roadmap',
  element: string,
  value:
    Partial<CompositionPlan['loadout']> | ((paths: ConformanceFixturePaths) => Partial<CompositionPlan['loadout']>),
  agentFrontmatter: string,
  setupStrictFixture?: (paths: ConformanceFixturePaths) => void,
) => ({
  status: 'unsupported' as const,
  documentedStatus,
  element,
  composition: (paths: ConformanceFixturePaths) => baseComposition(typeof value === 'function' ? value(paths) : value),
  agentFrontmatter,
  setupStrictFixture,
});

export const conformanceRows: readonly ConformanceRow[] = [
  {
    id: 'agent_config_directory',
    description: 'the harness config directory points at the runtime projection root',
    expectations: {
      pi: {
        status: 'supported',
        documentedStatus: 'Supported',
        assert: ({ projection, paths }) =>
          expect(projection.launch.env.PI_CODING_AGENT_DIR).toBe(paths.projectionDirectory),
      },
      claude: {
        status: 'supported',
        documentedStatus: 'Supported',
        assert: ({ projection, paths }) =>
          expect(projection.launch.env.CLAUDE_CONFIG_DIR).toBe(paths.projectionDirectory),
      },
    },
  },
  {
    id: 'session_directory',
    description: 'harness session state is declared inside the runtime projection',
    expectations: {
      pi: {
        status: 'supported',
        documentedStatus: 'Supported',
        assert: ({ projection }) =>
          expect(projection.statePaths).toContainEqual({ relativePath: 'sessions', kind: 'directory' }),
      },
      claude: {
        status: 'supported',
        documentedStatus: 'Supported',
        assert: ({ projection }) =>
          expect(projection.statePaths).toContainEqual({ relativePath: 'projects', kind: 'directory' }),
      },
    },
  },
  {
    id: 'identity',
    description: 'composed identity is materialized and passed through native prompt flags',
    expectations: {
      pi: {
        status: 'supported',
        documentedStatus: 'Supported',
        assert: ({ projection }) => {
          const systemPath = projection.launch.args[projection.launch.args.indexOf('--system-prompt') + 1];
          expect(readFileSync(systemPath, 'utf8')).toBe('SYSTEM');
          expect(projection.launch.args.filter((arg) => arg === '--append-system-prompt')).toHaveLength(2);
        },
      },
      claude: {
        status: 'supported',
        documentedStatus: 'Supported',
        assert: ({ projection }) => {
          const systemPath = projection.launch.args[projection.launch.args.indexOf('--system-prompt') + 1];
          expect(readFileSync(systemPath, 'utf8')).toBe('SYSTEM');
          expect(projection.launch.args.filter((arg) => arg === '--append-system-prompt')).toHaveLength(2);
        },
      },
    },
  },
  {
    id: 'subagents',
    description: 'selected delegates are either projected or reported unsupported',
    expectations: {
      pi: unsupported(
        'Supported',
        'subagents',
        (paths) => ({ subagents: [resource(paths, 'agent', 'reviewer', 'agents/reviewer/agent.md')] }),
        'subagents: [reviewer]',
        (paths) =>
          write(
            join(paths.projectDirectory, '.agents', 'agents', 'reviewer', 'agent.md'),
            '---\nname: reviewer\n---\n',
          ),
      ),
      claude: unsupported(
        'Supported',
        'subagents',
        (paths) => ({ subagents: [resource(paths, 'agent', 'reviewer', 'agents/reviewer/agent.md')] }),
        'subagents: [reviewer]',
        (paths) =>
          write(
            join(paths.projectDirectory, '.agents', 'agents', 'reviewer', 'agent.md'),
            '---\nname: reviewer\n---\n',
          ),
      ),
    },
  },
  {
    id: 'skills',
    description: 'selected skills are materialized for each harness',
    expectations: {
      pi: {
        status: 'supported',
        documentedStatus: 'Supported',
        composition: (paths) => {
          write(join(paths.projectDirectory, '.agents', 'skills', 'wiki', 'SKILL.md'), 'WIKI');
          return baseComposition({ skills: [resource(paths, 'skill', 'wiki', 'skills/wiki/SKILL.md')] });
        },
        assert: ({ projection, paths }) => {
          expect(projection.launch.args).toEqual(expect.arrayContaining(['--skill', 'wiki']));
          expect(readFileSync(join(paths.projectionDirectory, 'skills', 'wiki', 'SKILL.md'), 'utf8')).toBe('WIKI');
        },
      },
      claude: {
        status: 'supported',
        documentedStatus: 'Partial',
        composition: (paths) => {
          write(join(paths.projectDirectory, '.agents', 'skills', 'wiki', 'SKILL.md'), 'WIKI');
          return baseComposition({ skills: [resource(paths, 'skill', 'wiki', 'skills/wiki/SKILL.md')] });
        },
        assert: ({ projection, paths }) => {
          expect(projection.launch.args).not.toContain('--skill');
          expect(readFileSync(join(paths.projectionDirectory, 'skills', 'wiki', 'SKILL.md'), 'utf8')).toBe('WIKI');
        },
      },
    },
  },
  {
    id: 'commands',
    description: 'command resources are reserved in the protocol but not yet carried by CompositionPlan',
    expectations: {
      pi: deferred('Supported', 'Command projection returns with the fuller RFC #165 projection surface.'),
      claude: deferred('Partial', 'Command projection returns with the fuller RFC #165 projection surface.'),
    },
  },
  {
    id: 'knowledge',
    description: 'knowledge resources are reserved in the protocol but not yet carried by CompositionPlan',
    expectations: {
      pi: deferred('Supported', 'Knowledge projection returns with the fuller RFC #165 projection surface.'),
      claude: deferred('Partial', 'Knowledge projection returns with the fuller RFC #165 projection surface.'),
    },
  },
  {
    id: 'model',
    description: 'model selection maps to the native model flag',
    expectations: {
      pi: {
        status: 'supported',
        documentedStatus: 'Supported',
        composition: () => baseComposition({ model: 'conformance-model' }),
        assert: ({ projection }) =>
          expect(projection.launch.args).toEqual(expect.arrayContaining(['--model', 'conformance-model'])),
      },
      claude: {
        status: 'supported',
        documentedStatus: 'Partial',
        composition: () => baseComposition({ model: 'conformance-model' }),
        assert: ({ projection }) =>
          expect(projection.launch.args).toEqual(expect.arrayContaining(['--model', 'conformance-model'])),
      },
    },
  },
  {
    id: 'thinking',
    description: 'reasoning level maps to the harness-specific flag',
    expectations: {
      pi: {
        status: 'supported',
        documentedStatus: 'Supported',
        composition: () => baseComposition({ thinking: 'high' }),
        assert: ({ projection }) =>
          expect(projection.launch.args).toEqual(expect.arrayContaining(['--thinking', 'high'])),
      },
      claude: {
        status: 'supported',
        documentedStatus: 'Partial',
        composition: () => baseComposition({ thinking: 'high' }),
        assert: ({ projection }) =>
          expect(projection.launch.args).toEqual(expect.arrayContaining(['--effort', 'high'])),
      },
    },
  },
  {
    id: 'mcp',
    description: 'MCP selections are reported until config projection lands',
    expectations: {
      pi: unsupported('Supported', 'mcp', { mcp: ['github'] }, 'mcp: [github]'),
      claude: unsupported('Supported', 'mcp', { mcp: ['github'] }, 'mcp: [github]'),
    },
  },
  {
    id: 'extensions',
    description: 'Pi loads resolved extension directories while Claude reports extensions unsupported',
    expectations: {
      pi: {
        status: 'supported',
        documentedStatus: 'Supported',
        composition: () => baseComposition({ extensions: ['git:github.com/o/r'] }),
        extensionLoadDirs: (paths) => [join(paths.rootDirectory, 'extension-cache')],
        assert: ({ projection, paths }) =>
          expect(projection.launch.args).toEqual(
            expect.arrayContaining(['--extension', join(paths.rootDirectory, 'extension-cache')]),
          ),
      },
      claude: unsupported(
        'Roadmap',
        'extensions',
        { extensions: ['git:github.com/o/r'] },
        'extensions: ["git:github.com/o/r"]',
      ),
    },
  },
  {
    id: 'plugins',
    description: 'plugin selections are reported until native projection lands',
    expectations: {
      pi: unsupported('Supported', 'plugins', { plugins: ['example'] }, 'plugins: [example]'),
      claude: unsupported('Roadmap', 'plugins', { plugins: ['example'] }, 'plugins: [example]'),
    },
  },
  {
    id: 'environment',
    description: 'credential environment remains outside persisted CompositionPlan data',
    expectations: {
      pi: deferred('Supported', 'Credentials are injected at the launch boundary, not persisted in CompositionPlan.'),
      claude: deferred(
        'Supported',
        'Credentials are injected at the launch boundary, not persisted in CompositionPlan.',
      ),
    },
  },
  {
    id: 'tasks',
    description: 'tasks and bake are deferred to their own RFC',
    expectations: {
      pi: deferred('Future', 'Tasks and bake are explicitly deferred to a separate RFC.'),
      claude: deferred('Future', 'Tasks and bake are explicitly deferred to a separate RFC.'),
    },
  },
  {
    id: 'deepwork',
    description: 'DeepWork selection is not yet carried by CompositionPlan',
    expectations: {
      pi: deferred('Supported', 'DeepWork returns with the fuller RFC #165 loadout projection.'),
      claude: deferred('Roadmap', 'DeepWork returns with the fuller RFC #165 loadout projection.'),
    },
  },
  {
    id: 'hooks',
    description: 'protocol hooks are reserved but not represented yet',
    expectations: {
      pi: deferred('Partial', 'No protocol hooks entity exists yet.'),
      claude: deferred('Partial', 'No protocol hooks entity exists yet.'),
    },
  },
  {
    id: 'tool_availability',
    description: 'tool filters are reported unsupported by both current projections',
    expectations: {
      pi: unsupported('Roadmap', 'tools', { tools: { allow: ['read'] } }, 'tools: { allow: [read] }'),
      claude: unsupported('Roadmap', 'tools', { tools: { allow: ['read'] } }, 'tools: { allow: [read] }'),
    },
  },
  {
    id: 'theme',
    description: 'theme selection is not yet part of CompositionPlan',
    expectations: {
      pi: deferred('Roadmap', 'Theme selection is not yet part of CompositionPlan.'),
      claude: deferred('Roadmap', 'Theme selection is not yet part of CompositionPlan.'),
    },
  },
  {
    id: 'working_directory',
    description: 'working-directory selection is not yet part of CompositionPlan',
    expectations: {
      pi: deferred('Roadmap', 'Working-directory selection is not yet part of CompositionPlan.'),
      claude: deferred('Roadmap', 'Working-directory selection is not yet part of CompositionPlan.'),
    },
  },
  {
    id: 'pass_through_args',
    description: 'unrecognized arguments are appended without rewriting',
    expectations: {
      pi: {
        status: 'supported',
        documentedStatus: 'Supported',
        passThroughArgs: ['--conformance-pass-through'],
        assert: ({ projection }) => expect(projection.launch.args.at(-1)).toBe('--conformance-pass-through'),
      },
      claude: {
        status: 'supported',
        documentedStatus: 'Supported',
        passThroughArgs: ['--conformance-pass-through'],
        assert: ({ projection }) => expect(projection.launch.args.at(-1)).toBe('--conformance-pass-through'),
      },
    },
  },
  {
    id: 'bootstrap_hook',
    description: 'Pi receives the runtime bootstrap extension while Claude has no equivalent yet',
    expectations: {
      pi: {
        status: 'supported',
        documentedStatus: 'Supported',
        assert: ({ projection }) => {
          const attached = attachPiRuntimeExtension(projection.launch);
          expect(attached.args[0]).toBe('--extension');
          expect(attached.args[1]).toContain('outfitter-runtime-extension.js');
        },
      },
      claude: deferred('Roadmap', 'Claude has no projected bootstrap hook yet.'),
    },
  },
  {
    id: 'state_paths',
    description: 'each harness declares its writable runtime state surface',
    expectations: {
      pi: {
        status: 'supported',
        documentedStatus: 'Supported',
        assert: ({ projection }) => expect(projection.statePaths.length).toBeGreaterThan(0),
      },
      claude: {
        status: 'supported',
        documentedStatus: 'Supported',
        assert: ({ projection }) => expect(projection.statePaths.length).toBeGreaterThan(0),
      },
    },
  },
];
