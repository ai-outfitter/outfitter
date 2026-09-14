// Tests the pi run boundary for local-path extensions: resolved launch flags, generated settings.json
// inheritance entries, warning and strict handling, and the no-cache-install guarantee.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { executeRunAgentCommand } from '../../src/cli/commands/RunAgentCommand.js';
import { executeDumpCommand } from '../../src/cli/commands/DumpCommand.js';
import type { AgentLaunchPlan } from '../../src/projection/Projection.js';
import type { PiInstallSpawner } from '../../src/extensions/PiExtensionCache.js';

const roots: string[] = [];
let previousExitCode: typeof process.exitCode;

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-local-run-'));
  roots.push(root);
  return root;
};

const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

interface CapturedLaunch {
  readonly plan: AgentLaunchPlan;
  readonly runtimeDir: string;
  readonly settings: unknown;
}

const captured: CapturedLaunch[] = [];

const launcher = (plan: AgentLaunchPlan): Promise<number> => {
  const runtimeDir = plan.env.PI_CODING_AGENT_DIR ?? '';
  captured.push({
    plan,
    runtimeDir,
    settings: (() => {
      try {
        return JSON.parse(readFileSync(join(runtimeDir, 'settings.json'), 'utf8')) as unknown;
      } catch {
        return undefined;
      }
    })(),
  });
  return Promise.resolve(0);
};

beforeEach(() => {
  previousExitCode = process.exitCode;
  captured.length = 0;
});

afterEach(() => {
  process.exitCode = previousExitCode;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A tree whose workspace agent declares one relative local extension next to its layer root. */
const treeWithRelativeExtension = (): { home: string; project: string; extensionDir: string } => {
  const root = createTemporaryRoot();
  const home = join(root, 'home');
  const project = join(root, 'project');
  const extensionDir = join(project, '.agents', 'exts', 'helper');
  write(join(extensionDir, 'index.ts'), 'export default () => {};');
  write(
    join(project, '.agents', 'agents', 'engineer', 'agent.md'),
    '---\nname: engineer\nextensions: ["./exts/helper"]\n---\n\n# Engineer\n',
  );
  return { home, project, extensionDir };
};

const runPi = (input: {
  home: string;
  project: string;
  agent?: string;
  strict?: boolean;
  installSpawner?: PiInstallSpawner;
  npmLatest?: () => undefined;
}) =>
  executeRunAgentCommand({
    homeDirectory: input.home,
    projectDirectory: input.project,
    agent: input.agent ?? 'engineer',
    harness: 'pi',
    strict: input.strict,
    ...(input.installSpawner === undefined ? {} : { extensionInstallSpawner: input.installSpawner }),
    ...(input.npmLatest === undefined ? {} : { extensionNpmLatest: input.npmLatest }),
    launcher,
  });

const extensionArgsOf = (plan: AgentLaunchPlan): readonly string[] => {
  const args: string[] = [];
  for (const [index, arg] of plan.args.entries()) {
    // The Outfitter runtime UI extension is attached after projection and is not part of the loadout.
    if (arg === '--extension' && !plan.args[index + 1].endsWith('outfitter-runtime-extension.js')) {
      args.push(plan.args[index + 1]);
    }
  }
  return args;
};

describe('pi run with local-path extensions', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.28).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('resolves a relative extension against the declaring layer root into launch flags and settings entries', async () => {
    const { home, project, extensionDir } = treeWithRelativeExtension();
    const result = await runPi({ home, project });

    expect(result.exitCode).toBe(0);
    expect(extensionArgsOf(captured[0].plan)).toEqual([extensionDir]);
    expect(captured[0].settings).toEqual(expect.objectContaining({ extensions: [extensionDir] }));
    expect(result.messages).toEqual([]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.28).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('expands a home extension against the run home directory', async () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    const extensionDir = join(home, 'exts', 'helper');
    write(join(extensionDir, 'index.ts'), 'export default () => {};');
    write(
      join(project, '.agents', 'agents', 'engineer', 'agent.md'),
      '---\nname: engineer\nextensions: ["~/exts/helper"]\n---\n\n# Engineer\n',
    );

    await runPi({ home, project });

    expect(extensionArgsOf(captured[0].plan)).toEqual([extensionDir]);
    expect(captured[0].settings).toEqual(expect.objectContaining({ extensions: [extensionDir] }));
  });

  it('serves a single-file extension target like a directory target', async () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    const extensionFile = join(project, '.agents', 'exts', 'single.ts');
    write(extensionFile, 'export default () => {};');
    write(
      join(project, '.agents', 'agents', 'engineer', 'agent.md'),
      '---\nname: engineer\nextensions: ["./exts/single.ts"]\n---\n\n# Engineer\n',
    );

    await runPi({ home, project });

    expect(extensionArgsOf(captured[0].plan)).toEqual([extensionFile]);
    expect(captured[0].settings).toEqual(expect.objectContaining({ extensions: [extensionFile] }));
  });

  it('never touches the extension cache for local-only loadouts, even online', async () => {
    const { home, project } = treeWithRelativeExtension();
    let installCalls = 0;
    const result = await runPi({
      home,
      project,
      installSpawner: () => {
        installCalls += 1;
        return Promise.resolve(0);
      },
    });

    expect(result.exitCode).toBe(0);
    expect(installCalls).toBe(0);
  });

  it('warns and skips a missing local extension while still serving its siblings', async () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    const presentDir = join(project, '.agents', 'exts', 'present');
    write(join(presentDir, 'index.ts'), 'export default () => {};');
    write(
      join(project, '.agents', 'agents', 'engineer', 'agent.md'),
      '---\nname: engineer\nextensions: ["./exts/gone", "./exts/present"]\n---\n\n# Engineer\n',
    );

    const result = await runPi({ home, project });

    expect(result.exitCode).toBe(0);
    expect(extensionArgsOf(captured[0].plan)).toEqual([presentDir]);
    expect(captured[0].settings).toEqual(expect.objectContaining({ extensions: [presentDir] }));
    expect(result.messages.join('\n')).toContain('./exts/gone');
  });

  it('makes a missing local extension fatal under --strict', async () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    write(
      join(project, '.agents', 'agents', 'engineer', 'agent.md'),
      '---\nname: engineer\nextensions: ["./exts/gone"]\n---\n\n# Engineer\n',
    );

    const result = await runPi({ home, project, strict: true });

    expect(result.exitCode).toBe(1);
    expect(result.messages.join('\n')).toContain('./exts/gone');
    expect(captured).toEqual([]);
  });

  it('interleaves cached remote and local extensions in declared loadout order', async () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    const localDir = join(project, '.agents', 'exts', 'helper');
    write(join(localDir, 'index.ts'), 'export default () => {};');
    write(
      join(project, '.agents', 'agents', 'engineer', 'agent.md'),
      '---\nname: engineer\nextensions: [npm:pkg, "./exts/helper"]\n---\n\n# Engineer\n',
    );
    const cache = join(home, '.cache', 'outfitter', 'pi-extensions');
    const installDir = join(cache, 'npm', 'node_modules', 'pkg');
    const result = await runPi({
      home,
      project,
      installSpawner: ({ source, cacheAgentDir }) => {
        const name = source.slice('npm:'.length).replace(/@[^@/]+$/u, '');
        write(
          join(cacheAgentDir, 'npm', 'node_modules', name, 'package.json'),
          JSON.stringify({ name, version: '1.0.0' }),
        );
        write(join(cacheAgentDir, 'npm', 'node_modules', name, 'index.ts'), 'export default () => {};');
        return Promise.resolve(0);
      },
      npmLatest: () => undefined,
    });

    expect(result.exitCode).toBe(0);
    expect(extensionArgsOf(captured[0].plan)).toEqual([installDir, localDir]);
    // Overlay-declared entries keep their order first; the loadout entries follow in declared order.
    expect(captured[0].settings).toEqual(
      expect.objectContaining({ extensions: [join(installDir, 'index.ts'), localDir] }),
    );
  });

  it('resolves an inherited relative extension against the declaring parent layer, not the child layer', async () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    write(
      join(project, '.agents', 'agents', 'parent', 'agent.md'),
      '---\nname: parent\nextensions: ["./exts/shared"]\n---\n\nParent.\n',
    );
    const parentExtensionDir = join(project, '.agents', 'exts', 'shared');
    write(join(parentExtensionDir, 'index.ts'), 'export default () => {};');
    write(
      join(home, '.agents', 'agents', 'child', 'agent.md'),
      '---\nname: child\ninherits: parent\nextensions: ["./exts/own"]\n---\n\nChild.\n',
    );
    const childExtensionDir = join(home, '.agents', 'exts', 'own');
    write(join(childExtensionDir, 'index.ts'), 'export default () => {};');

    await runPi({ home, project, agent: 'child' });

    expect(extensionArgsOf(captured[0].plan)).toEqual([parentExtensionDir, childExtensionDir]);
  });

  it('fails the run when a config.json overlay declares a bare extension name', async () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    write(join(project, '.agents', 'agents', 'engineer', 'agent.md'), '---\nname: engineer\n---\n\n# Engineer\n');
    write(join(project, '.agents', 'agents', 'engineer', 'config.json'), JSON.stringify({ extensions: ['helper'] }));

    const result = await runPi({ home, project });

    expect(result.exitCode).toBe(1);
    expect(result.messages.join('\n')).toContain('helper');
  });

  it('rejects a relative path in settings-layer agent_defaults extensions at the settings boundary', async () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    write(join(project, '.agents', 'settings.yml'), 'agent_defaults:\n  extensions: ["./relative/ext"]\n');
    write(join(project, '.agents', 'agents', 'engineer', 'agent.md'), '---\nname: engineer\n---\n\n# Engineer\n');

    await expect(runPi({ home, project })).rejects.toThrow('must match pattern');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.28).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('dumps local-path extensions as declared, never as resolved machine paths', () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    write(join(project, '.agents', 'exts', 'helper', 'index.ts'), 'export default () => {};');
    const declared = '---\nname: engineer\nextensions: ["./exts/helper", "~/exts/home", "/opt/abs"]\n---\n\nBody.\n';
    write(join(project, '.agents', 'agents', 'engineer', 'agent.md'), declared);
    const out = join(root, 'dump');

    const result = executeDumpCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'engineer',
      out,
    });

    expect(result.ok).toBe(true);
    // Declarations stay verbatim (portable config); no resolved absolute path may leak anywhere.
    expect(readFileSync(join(out, '.agents', 'agents', 'engineer', 'agent.md'), 'utf8')).toBe(declared);
    const metadata = readFileSync(join(out, '.agents', '.outfitter', 'composition.json'), 'utf8');
    expect(metadata).not.toContain(root);
  });
});
