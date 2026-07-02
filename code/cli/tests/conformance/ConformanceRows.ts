// Declares the conformance rows: for each generic control in the vocabulary, a
// fixture profile plus the expected outcome per adapter (supported, roadmap, or
// not applicable). The runner in conformance.test.ts executes every declaration
// against every registered adapter.
import { mkdirSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';

import { expect } from 'vitest';

import {
  flagValuesOf,
  type ConformanceFixturePaths,
  type ConformanceRow,
  type ConformanceSupportedOutcome,
} from './ConformanceSpec.js';

const writeFixtureFile = (filePath: string, content: string): void => {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
};

const mcpFragment = JSON.stringify({ mcpServers: { conformance: { command: 'conformance-server' } } });

const setupMcpFragment =
  (adapterId: string) =>
  (paths: ConformanceFixturePaths): void => {
    writeFixtureFile(join(paths.profileFolder, 'cli_specific', adapterId, '.mcp.json'), `${mcpFragment}\n`);
  };

const assertMergedMcpFile = ({ plan, paths }: ConformanceSupportedOutcome): void => {
  const mcpFile = plan.compositeProfile.files.find((file) => file.relativePath === '.mcp.json');
  expect(mcpFile).toBeDefined();
  expect(mcpFile?.outputPath).toBe(join(paths.compositeRootDirectory, '.mcp.json'));
  expect(mcpFile?.strategy).toBe('merge');
  const parsed = JSON.parse(mcpFile?.content ?? '{}') as {
    mcpServers?: Record<string, { command?: string }>;
  };
  expect(parsed.mcpServers?.conformance?.command).toBe('conformance-server');
};

// Every relative path an adapter declares must materialize as a composite state
// path; symlink-strategy paths must resolve a concrete source. This assertion is
// adapter-generic, so any future adapter is held to the same contract.
const assertDeclaredStatePaths = ({ adapter, plan }: ConformanceSupportedOutcome): void => {
  const declarations = Object.keys(adapter.statePaths ?? {}).filter((relativePath) => relativePath !== 'unknown');
  expect(declarations.length).toBeGreaterThan(0);

  for (const relativePath of declarations) {
    const statePath = plan.compositeProfile.statePaths.find((candidate) => candidate.relativePath === relativePath);
    expect(statePath, `state path '${relativePath}' missing for adapter '${adapter.id}'`).toBeDefined();

    if (statePath?.strategy === 'symlink') {
      expect(statePath.sourcePath, `state path '${relativePath}' has no source for '${adapter.id}'`).toBeDefined();
    }
  }
};

export const conformanceRows: readonly ConformanceRow[] = [
  {
    id: 'model',
    description: 'generic model selection maps to the native model flag',
    expectations: {
      pi: {
        status: 'supported',
        controls: () => ({ model: 'conformance-model' }),
        assert: ({ launchPlan }) => expect(flagValuesOf(launchPlan.args, '--model')).toEqual(['conformance-model']),
      },
      claude: {
        status: 'supported',
        controls: () => ({ model: 'conformance-model' }),
        assert: ({ launchPlan }) => expect(flagValuesOf(launchPlan.args, '--model')).toEqual(['conformance-model']),
      },
    },
  },
  {
    id: 'provider',
    description: 'generic provider selection',
    expectations: {
      pi: {
        status: 'supported',
        controls: () => ({ provider: 'conformance-provider' }),
        assert: ({ launchPlan }) =>
          expect(flagValuesOf(launchPlan.args, '--provider')).toEqual(['conformance-provider']),
      },
      claude: { status: 'roadmap', controls: { provider: 'conformance-provider' }, warnsAbout: 'provider' },
    },
  },
  {
    id: 'thinking',
    description: 'generic thinking level maps to the native reasoning flag',
    expectations: {
      pi: {
        status: 'supported',
        controls: () => ({ thinking: 'high' }),
        assert: ({ launchPlan }) => expect(flagValuesOf(launchPlan.args, '--thinking')).toEqual(['high']),
      },
      claude: {
        status: 'supported',
        controls: () => ({ thinking: 'medium' }),
        // The documented table: off/minimal/low → low, medium/high/xhigh/max map
        // one-to-one, and unknown levels pass through unchanged.
        assert: ({ adapter, plan, launchPlan }) => {
          expect(flagValuesOf(launchPlan.args, '--effort')).toEqual(['medium']);
          const effortFor = (thinking: string): readonly string[] =>
            flagValuesOf(
              adapter.createLaunchPlan(plan.compositeProfile, {
                id: 'conformance-thinking',
                inherits: [],
                controls: { thinking },
              }).args,
              '--effort',
            );
          expect(effortFor('off')).toEqual(['low']);
          expect(effortFor('minimal')).toEqual(['low']);
          expect(effortFor('low')).toEqual(['low']);
          expect(effortFor('high')).toEqual(['high']);
          expect(effortFor('xhigh')).toEqual(['xhigh']);
          expect(effortFor('max')).toEqual(['max']);
          expect(effortFor('claude-native-level')).toEqual(['claude-native-level']);
        },
      },
    },
  },
  {
    id: 'environment',
    description: 'profile environment variables reach the launch environment',
    expectations: {
      pi: {
        status: 'supported',
        controls: () => ({ environment: { CONFORMANCE_ENV: 'on' } }),
        assert: ({ launchPlan }) => expect(launchPlan.env.CONFORMANCE_ENV).toBe('on'),
      },
      claude: {
        status: 'supported',
        controls: () => ({ environment: { CONFORMANCE_ENV: 'on' } }),
        assert: ({ launchPlan }) => expect(launchPlan.env.CONFORMANCE_ENV).toBe('on'),
      },
    },
  },
  {
    id: 'args',
    description: 'profile-declared extra CLI arguments are appended to the launch argv',
    expectations: {
      pi: {
        status: 'supported',
        controls: () => ({ args: ['--no-themes'] }),
        assert: ({ launchPlan }) => expect(launchPlan.args).toContain('--no-themes'),
      },
      claude: {
        status: 'supported',
        controls: () => ({ args: ['--permission-mode', 'plan'] }),
        assert: ({ launchPlan }) => expect(flagValuesOf(launchPlan.args, '--permission-mode')).toEqual(['plan']),
      },
    },
  },
  {
    id: 'pass_through_args',
    description: 'unrecognized CLI arguments are forwarded unmodified after profile args',
    expectations: {
      pi: {
        status: 'supported',
        passThroughArgs: ['--conformance-pass-through'],
        assert: ({ launchPlan }) => expect(launchPlan.args.at(-1)).toBe('--conformance-pass-through'),
      },
      claude: {
        status: 'supported',
        passThroughArgs: ['--conformance-pass-through'],
        assert: ({ launchPlan }) => expect(launchPlan.args.at(-1)).toBe('--conformance-pass-through'),
      },
    },
  },
  {
    id: 'agent_config_directory',
    description: 'the agent config directory is pointed at the composite profile root',
    expectations: {
      pi: {
        status: 'supported',
        assert: ({ launchPlan, plan }) =>
          expect(launchPlan.env.PI_CODING_AGENT_DIR).toBe(plan.compositeProfile.rootDirectory),
      },
      claude: {
        status: 'supported',
        assert: ({ launchPlan, plan }) =>
          expect(launchPlan.env.CLAUDE_CONFIG_DIR).toBe(plan.compositeProfile.rootDirectory),
      },
    },
  },
  {
    id: 'session_directory',
    description: 'generic session directory selection places session state',
    expectations: {
      pi: {
        status: 'supported',
        controls: (paths) => ({ sessionDirectory: join(paths.rootDirectory, 'sessions') }),
        assert: ({ launchPlan, paths }) =>
          expect(flagValuesOf(launchPlan.args, '--session-dir')).toEqual([join(paths.rootDirectory, 'sessions')]),
      },
      claude: {
        // Claude has no session-dir flag; session state under `projects/` is
        // symlinked from the selected directory instead.
        status: 'supported',
        controls: (paths) => ({ sessionDirectory: join(paths.rootDirectory, 'sessions') }),
        assert: ({ plan, paths }) =>
          expect(
            plan.compositeProfile.statePaths.find((statePath) => statePath.relativePath === 'projects/'),
          ).toMatchObject({ strategy: 'symlink', sourcePath: join(paths.rootDirectory, 'sessions') }),
      },
    },
  },
  {
    id: 'extensions',
    description: 'generic extension selections map to the native plugin mechanism',
    expectations: {
      pi: {
        status: 'supported',
        controls: () => ({ extensions: ['conformance-extension'] }),
        assert: ({ launchPlan }) =>
          expect(flagValuesOf(launchPlan.args, '--extension')).toEqual(['conformance-extension']),
      },
      claude: {
        status: 'supported',
        controls: () => ({ extensions: ['conformance-plugin'] }),
        assert: ({ launchPlan }) =>
          expect(flagValuesOf(launchPlan.args, '--plugin-dir')).toEqual(['conformance-plugin']),
      },
    },
  },
  {
    id: 'skills',
    description: 'generic skill selections reach the agent',
    expectations: {
      pi: {
        status: 'supported',
        setup: (paths) =>
          writeFixtureFile(join(paths.profileFolder, 'skills', 'conformance-skill', 'SKILL.md'), '# skill\n'),
        controls: (paths) => ({ skills: [join(paths.profileFolder, 'skills', 'conformance-skill')] }),
        assert: ({ launchPlan, paths }) =>
          expect(flagValuesOf(launchPlan.args, '--skill')).toContain(
            join(paths.profileFolder, 'skills', 'conformance-skill'),
          ),
      },
      claude: {
        // Claude has no skill flag; skills are materialized as per-skill symlinks
        // inside the profiled config directory's `skills/`.
        status: 'supported',
        setup: (paths) =>
          writeFixtureFile(join(paths.profileFolder, 'skills', 'conformance-skill', 'SKILL.md'), '# skill\n'),
        controls: () => ({ skills: ['conformance-skill'] }),
        assert: ({ plan, paths }) =>
          expect(
            plan.compositeProfile.statePaths.find(
              (statePath) => statePath.relativePath === 'skills/conformance-skill/',
            ),
          ).toMatchObject({
            strategy: 'symlink',
            sourcePath: join(paths.profileFolder, 'skills', 'conformance-skill'),
          }),
      },
    },
  },
  {
    id: 'prompt_template',
    description: 'generic prompt template selection',
    expectations: {
      pi: {
        status: 'supported',
        controls: () => ({ promptTemplate: 'conformance-template' }),
        assert: ({ launchPlan }) =>
          expect(flagValuesOf(launchPlan.args, '--prompt-template')).toEqual(['conformance-template']),
      },
      claude: {
        status: 'roadmap',
        controls: { prompt_template: 'conformance-template' },
        warnsAbout: 'prompt_template',
      },
    },
  },
  {
    id: 'native_commands',
    description: 'native command/prompt directories are profiled into the config directory',
    expectations: {
      pi: {
        status: 'not-applicable',
        justification:
          'Pi selects prompt templates with the native --prompt-template flag (covered by the prompt_template row); it has no commands/ directory inside the agent config dir for Outfitter to profile.',
      },
      claude: {
        status: 'supported',
        setup: (paths) =>
          writeFixtureFile(join(paths.profileFolder, 'cli_specific', 'claude', 'commands', 'review.md'), '# review\n'),
        assert: ({ plan, paths }) =>
          expect(
            plan.compositeProfile.statePaths.find((statePath) => statePath.relativePath === 'commands/'),
          ).toMatchObject({
            strategy: 'symlink',
            sourcePath: join(paths.profileFolder, 'cli_specific', 'claude', 'commands'),
          }),
      },
    },
  },
  {
    id: 'system_prompt',
    description: 'generic system prompt maps to the native flag',
    expectations: {
      pi: {
        status: 'supported',
        controls: () => ({ systemPrompt: 'conformance system prompt' }),
        assert: ({ launchPlan }) =>
          expect(flagValuesOf(launchPlan.args, '--system-prompt')).toEqual(['conformance system prompt']),
      },
      claude: {
        status: 'supported',
        controls: () => ({ systemPrompt: 'conformance system prompt' }),
        assert: ({ launchPlan }) =>
          expect(flagValuesOf(launchPlan.args, '--system-prompt')).toEqual(['conformance system prompt']),
      },
    },
  },
  {
    id: 'append_system_prompt',
    description: 'generic appended system prompt maps to the native flag',
    expectations: {
      pi: {
        status: 'supported',
        controls: () => ({ appendSystemPrompt: 'conformance appended prompt' }),
        assert: ({ launchPlan }) =>
          expect(flagValuesOf(launchPlan.args, '--append-system-prompt')).toEqual(['conformance appended prompt']),
      },
      claude: {
        status: 'supported',
        controls: () => ({ appendSystemPrompt: 'conformance appended prompt' }),
        assert: ({ launchPlan }) =>
          expect(flagValuesOf(launchPlan.args, '--append-system-prompt')).toEqual(['conformance appended prompt']),
      },
    },
  },
  {
    id: 'deepwork',
    description: 'DeepWork job selection is exposed to the agent runtime',
    expectations: {
      pi: {
        status: 'supported',
        setup: (paths) =>
          writeFixtureFile(
            join(paths.rootDirectory, 'profile-source', 'deepwork', 'jobs', 'conformance_triage', 'job.yml'),
            'name: conformance_triage\n',
          ),
        controls: () => ({ deepwork: { jobs: ['conformance_triage'] } }),
        profileLayers: (paths, profile) => [
          {
            profile,
            profilePath: join(paths.profileFolder, 'profile.yml'),
            sourceRootPath: join(paths.rootDirectory, 'profile-source'),
          },
        ],
        assert: ({ launchPlan, paths }) =>
          expect(launchPlan.env.DEEPWORK_ADDITIONAL_JOBS_FOLDERS?.split(delimiter)).toContain(
            join(paths.rootDirectory, 'profile-source', 'deepwork', 'jobs'),
          ),
      },
      claude: {
        status: 'roadmap',
        controls: { deepwork: { jobs: ['conformance_triage'] } },
        warnsAbout: 'deepwork',
      },
    },
  },
  {
    id: 'mcp',
    description: 'cli_specific MCP config fragments are merged into a composite config',
    expectations: {
      pi: {
        status: 'supported',
        setup: setupMcpFragment('pi'),
        // Pi discovers the merged `.mcp.json` inside its profiled agent directory.
        assert: assertMergedMcpFile,
      },
      claude: {
        status: 'supported',
        setup: setupMcpFragment('claude'),
        // Claude does not read `.mcp.json` from CLAUDE_CONFIG_DIR, so the merged
        // config must also be loaded explicitly through --mcp-config.
        assert: (outcome) => {
          assertMergedMcpFile(outcome);
          expect(flagValuesOf(outcome.launchPlan.args, '--mcp-config')).toEqual([
            join(outcome.paths.compositeRootDirectory, '.mcp.json'),
          ]);
        },
      },
    },
  },
  {
    id: 'state_paths',
    description: 'every adapter-declared state path materializes in the composite profile',
    expectations: {
      pi: { status: 'supported', assert: assertDeclaredStatePaths },
      claude: { status: 'supported', assert: assertDeclaredStatePaths },
    },
  },
  {
    id: 'tool_availability',
    description: 'tool enable/disable filtering',
    expectations: {
      pi: { status: 'roadmap', controls: { tools: ['Bash'] }, warnsAbout: 'tools' },
      claude: { status: 'roadmap', controls: { tools: ['Bash'] }, warnsAbout: 'tools' },
    },
  },
  {
    id: 'context_files',
    description: 'automatically loaded project/profile context files',
    expectations: {
      pi: { status: 'roadmap', controls: { context_files: ['./AGENTS.md'] }, warnsAbout: 'context_files' },
      claude: { status: 'roadmap', controls: { context_files: ['./AGENTS.md'] }, warnsAbout: 'context_files' },
    },
  },
  {
    id: 'theme',
    description: 'terminal UI theme and presentation settings',
    expectations: {
      pi: { status: 'roadmap', controls: { theme: 'dark' }, warnsAbout: 'theme' },
      claude: { status: 'roadmap', controls: { theme: 'dark' }, warnsAbout: 'theme' },
    },
  },
  {
    id: 'project_override_policy',
    description: 'whether project-local agent configuration is allowed',
    expectations: {
      pi: {
        status: 'roadmap',
        controls: { project_override_policy: 'ignore' },
        warnsAbout: 'project_override_policy',
      },
      claude: {
        status: 'roadmap',
        controls: { project_override_policy: 'ignore' },
        warnsAbout: 'project_override_policy',
      },
    },
  },
  {
    id: 'working_directory',
    description: 'the directory the inner agent CLI is launched from',
    expectations: {
      pi: { status: 'roadmap', controls: { working_directory: './src' }, warnsAbout: 'working_directory' },
      claude: { status: 'roadmap', controls: { working_directory: './src' }, warnsAbout: 'working_directory' },
    },
  },
  {
    id: 'bootstrap_hook',
    description: 'an early-startup customization hook',
    expectations: {
      pi: {
        // Pi bootstrap behavior is delivered as an explicit bootstrap extension.
        status: 'supported',
        controls: () => ({ pi: { extensions: ['conformance-bootstrap-extension'] } }),
        assert: ({ launchPlan }) =>
          expect(flagValuesOf(launchPlan.args, '--extension')).toContain('conformance-bootstrap-extension'),
      },
      claude: {
        status: 'roadmap',
        controls: { bootstrap_hook: 'conformance-bootstrap-extension' },
        warnsAbout: 'bootstrap_hook',
      },
    },
  },
];
