// Tests that the served pi extension load directories project into the generated settings.json
// `packages:` array so fresh loaders inherit package-declared themes, skills, prompts, and
// extensions through pi's own package resolution, while launch args and the #407/#411
// `extensions:` entries stay unchanged.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { mapSpecifierToPiSource } from '../../src/extensions/PiExtensionCache.js';
import type { PiInstallSpawner } from '../../src/extensions/PiExtensionCache.js';
import { projectComposition } from '../../src/projection/ProjectHarness.js';
import type { CompositionPlan } from '../../src/composer/Composition.js';
import { executeRunAgentCommand } from '../../src/cli/commands/RunAgentCommand.js';
import type { AgentLaunchPlan } from '../../src/projection/Projection.js';

const roots: string[] = [];
let previousExitCode: typeof process.exitCode;
const temporaryDir = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
};
beforeEach(() => {
  previousExitCode = process.exitCode;
  capturedRuns.length = 0;
});
afterEach(() => {
  process.exitCode = previousExitCode;
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

const npmDir = (cache: string, name: string): string => join(cache, 'npm', 'node_modules', name);

/** Fake installer that creates a synthetic package (manifest plus declared entry files). */
const spawnerWriting = (packages: Readonly<Record<string, unknown>>): PiInstallSpawner => {
  return ({ source, cacheAgentDir }) => {
    const mapped = mapSpecifierToPiSource(source);
    if ('unsupported' in mapped) return Promise.resolve(0);
    const installDir = join(cacheAgentDir, ...mapped.installSegments);
    const manifest = packages[source] ?? { name: source.split(':').pop(), version: '1.0.0' };
    write(join(installDir, 'package.json'), JSON.stringify(manifest, null, 2));
    for (const entry of (manifest as { pi?: { extensions?: readonly string[] } }).pi?.extensions ?? []) {
      write(join(installDir, entry), 'export default () => {};');
    }
    return Promise.resolve(0);
  };
};

const compositionPlan = (extensions: readonly string[]): CompositionPlan => ({
  agent: 'dev',
  identity: { agentBody: 'Body.' },
  loadout: {
    skills: [],
    commands: [],
    delegateSkills: [],
    subagents: [],
    mcp: [],
    mcpServers: {},
    extensions,
    extensionDeclarations: extensions.map((specifier) => ({ specifier })),
    plugins: [],
  },
  warnings: [],
});

describe('projectComposition packages projection merge', () => {
  it('merges load dirs below overlay-delivered packages and dedupes, first occurrence winning', () => {
    const root = temporaryDir('outfitter-pkgres-');
    write(join(root, 'settings.json'), JSON.stringify({ quietStartup: true, packages: ['/overlay/pkg', '/served/a'] }));
    projectComposition(compositionPlan(['npm:one']), {
      harness: 'pi',
      rootDirectory: root,
      homeDirectory: root,
      extensionPackageDirs: ['/served/a', '/served/b', '/served/a'],
    });
    const settings = JSON.parse(readFileSync(join(root, 'settings.json'), 'utf8')) as {
      packages?: string[];
    };
    expect(settings.packages).toEqual(['/overlay/pkg', '/served/a', '/served/b']);
  });

  it('creates settings.json when missing and keeps other keys', () => {
    const root = temporaryDir('outfitter-pkgres-');
    write(join(root, 'settings.json'), JSON.stringify({ quietStartup: true }));
    projectComposition(compositionPlan([]), {
      harness: 'pi',
      rootDirectory: root,
      homeDirectory: root,
      extensionPackageDirs: ['/served/a'],
    });
    expect(JSON.parse(readFileSync(join(root, 'settings.json'), 'utf8'))).toEqual({
      quietStartup: true,
      packages: ['/served/a'],
    });
  });

  it('leaves an unparseable, non-object, or non-array-packages settings.json untouched', () => {
    for (const content of ['{not json', '["not-an-object"]']) {
      const root = temporaryDir('outfitter-pkgres-');
      write(join(root, 'settings.json'), content);
      projectComposition(compositionPlan([]), {
        harness: 'pi',
        rootDirectory: root,
        homeDirectory: root,
        extensionPackageDirs: ['/served/a'],
      });
      expect(readFileSync(join(root, 'settings.json'), 'utf8')).toBe(content);
    }
    const badPackages = temporaryDir('outfitter-pkgres-');
    write(join(badPackages, 'settings.json'), JSON.stringify({ quietStartup: true, packages: { oops: true } }));
    projectComposition(compositionPlan([]), {
      harness: 'pi',
      rootDirectory: badPackages,
      homeDirectory: badPackages,
      extensionPackageDirs: ['/served/a'],
    });
    // A document pi's runtime defaults can parse may gain defaults, but the packages value itself
    // must survive untouched.
    expect(
      (JSON.parse(readFileSync(join(badPackages, 'settings.json'), 'utf8')) as { packages?: unknown }).packages,
    ).toEqual({ oops: true });
  });

  it('adds no packages key when there are no load dirs', () => {
    const root = temporaryDir('outfitter-pkgres-');
    projectComposition(compositionPlan([]), {
      harness: 'pi',
      rootDirectory: root,
      homeDirectory: root,
    });
    expect(JSON.parse(readFileSync(join(root, 'settings.json'), 'utf8'))).toEqual({ quietStartup: true });
  });

  it('keeps the launch argv free of per-resource flags and identical with and without the projection', () => {
    const root = temporaryDir('outfitter-pkgres-');
    const loadDir = npmDir(root, 'one');
    const projected = projectComposition(compositionPlan(['npm:one']), {
      harness: 'pi',
      rootDirectory: root,
      homeDirectory: root,
      extensionPackageDirs: [loadDir],
      extensionLoadDirs: [loadDir],
    });
    const unprojected = projectComposition(compositionPlan(['npm:one']), {
      harness: 'pi',
      rootDirectory: root,
      homeDirectory: root,
      extensionLoadDirs: [loadDir],
    });
    expect(projected.launch.args).toEqual(unprojected.launch.args);
    expect(projected.launch.args.join(' ')).not.toContain('--theme');
    expect(projected.launch.args.join(' ')).not.toContain('--prompt-template');
  });
});

interface CapturedRun {
  readonly plan: AgentLaunchPlan;
  readonly runtimeDir: string;
  readonly settings?: unknown;
}

const capturedRuns: CapturedRun[] = [];
const capturingLauncher = (plan: AgentLaunchPlan): Promise<number> => {
  const runtimeDir = plan.env.PI_CODING_AGENT_DIR ?? '';
  const settingsPath = join(runtimeDir, 'settings.json');
  capturedRuns.push({
    plan,
    runtimeDir,
    settings: existsSync(settingsPath) ? (JSON.parse(readFileSync(settingsPath, 'utf8')) as unknown) : undefined,
  });
  return Promise.resolve(0);
};

const runTree = (): { root: string; home: string; project: string; xdg: string } => {
  const root = temporaryDir('outfitter-run-');
  const home = join(root, 'home');
  const project = join(root, 'project');
  const xdg = join(root, 'xdg');
  write(join(project, '.agents', 'system-prompt.md'), 'BASE PROMPT');
  write(join(project, '.agents', 'agents', 'dev', 'agent.md'), '---\nname: dev\n---\n\nBody.\n');
  return { root, home, project, xdg };
};

describe('run path package-resource inheritance', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.3.29).
  // Served pi extension load directories must be projected into the generated pi settings.json
  // packages array so fresh loaders inherit package-declared resources, with launch args unchanged.
  it('projects a cached npm package root into settings.json packages on install and on an offline cache hit', async () => {
    const { home, project, xdg } = runTree();
    write(
      join(project, '.agents', 'agents', 'dev', 'agent.md'),
      '---\nname: dev\nextensions: ["npm:pi-fixture"]\n---\n\nBody.\n',
    );
    const previousXdg = process.env.XDG_CACHE_HOME;
    process.env.XDG_CACHE_HOME = xdg;
    try {
      const result = await executeRunAgentCommand({
        homeDirectory: home,
        projectDirectory: project,
        agent: 'dev',
        harness: 'pi',
        launcher: capturingLauncher,
        extensionInstallSpawner: spawnerWriting({
          'npm:pi-fixture': { name: 'pi-fixture', pi: { extensions: ['./index.ts'] } },
        }),
        extensionNpmLatest: () => undefined,
      });

      expect(result.exitCode).toBe(0);
      const installDir = npmDir(join(xdg, 'outfitter', 'pi-extensions'), 'pi-fixture');
      expect(capturedRuns[0].settings).toEqual({
        quietStartup: true,
        extensions: [join(installDir, 'index.ts')],
        packages: [installDir],
      });

      // Cache hit: no reinstall, byte-identical packages projection.
      let spawned = 0;
      capturedRuns.length = 0;
      const second = await executeRunAgentCommand({
        homeDirectory: home,
        projectDirectory: project,
        agent: 'dev',
        harness: 'pi',
        launcher: capturingLauncher,
        extensionInstallSpawner: () => {
          spawned += 1;
          return Promise.resolve(0);
        },
        extensionNpmLatest: () => undefined,
      });
      expect(spawned).toBe(0);
      expect(second.exitCode).toBe(0);
      expect(capturedRuns[0].settings).toEqual({
        quietStartup: true,
        extensions: [join(installDir, 'index.ts')],
        packages: [installDir],
      });
    } finally {
      if (previousXdg === undefined) delete process.env.XDG_CACHE_HOME;
      else process.env.XDG_CACHE_HOME = previousXdg;
    }
  });

  it('projects git checkouts and local-path packages with manifests in declared order', async () => {
    const { home, project, xdg } = runTree();
    // A local-path package (#411) whose manifest declares themes, skills, and prompts: Outfitter
    // projects the verified package root without reading the manifest — pi resolves the kinds.
    const localPkg = join(project, '.agents', 'local-pkg');
    write(
      join(localPkg, 'package.json'),
      JSON.stringify({ name: 'local-pkg', pi: { themes: ['./themes'], skills: ['./skills'] } }, null, 2),
    );
    write(join(localPkg, 'themes', 'forge.json'), JSON.stringify({ name: 'forge' }));
    write(join(localPkg, 'skills', 'sample', 'SKILL.md'), '---\nname: sample\n---\nBody.\n');
    write(
      join(project, '.agents', 'agents', 'dev', 'agent.md'),
      '---\nname: dev\nextensions: ["git:github.com/fixture/pkg", "./local-pkg"]\n---\n\nBody.\n',
    );
    const previousXdg = process.env.XDG_CACHE_HOME;
    process.env.XDG_CACHE_HOME = xdg;
    try {
      const result = await executeRunAgentCommand({
        homeDirectory: home,
        projectDirectory: project,
        agent: 'dev',
        harness: 'pi',
        launcher: capturingLauncher,
        extensionInstallSpawner: spawnerWriting({
          'git:github.com/fixture/pkg': { name: 'pkg', pi: { extensions: ['./index.ts'] } },
        }),
        extensionNpmLatest: () => undefined,
      });

      expect(result.exitCode).toBe(0);
      const gitDir = join(xdg, 'outfitter', 'pi-extensions', 'git', 'github.com', 'fixture', 'pkg');
      // Git checkouts gain packages inheritance without gaining extensions entries (#407's
      // npm-only policy); the local path is its own extensions entry (#411).
      expect(capturedRuns[0].settings).toEqual({
        quietStartup: true,
        extensions: [localPkg],
        packages: [gitDir, localPkg],
      });
    } finally {
      if (previousXdg === undefined) delete process.env.XDG_CACHE_HOME;
      else process.env.XDG_CACHE_HOME = previousXdg;
    }
  });

  it('projects no packages array for non-pi harnesses', async () => {
    const { home, project } = runTree();
    write(
      join(project, '.agents', 'agents', 'dev', 'agent.md'),
      '---\nname: dev\nextensions: ["npm:pi-fixture"]\n---\n\nBody.\n',
    );
    const claudeLauncher = (plan: AgentLaunchPlan): Promise<number> => {
      const runtimeDir = plan.env.CLAUDE_CONFIG_DIR ?? '';
      const settingsPath = join(runtimeDir, 'settings.json');
      capturedRuns.push({
        plan,
        runtimeDir,
        settings: existsSync(settingsPath) ? (JSON.parse(readFileSync(settingsPath, 'utf8')) as unknown) : undefined,
      });
      return Promise.resolve(0);
    };
    const result = await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'dev',
      harness: 'claude',
      isolated: true,
      launcher: claudeLauncher,
    });
    expect(result.exitCode).toBe(0);
    const settings = capturedRuns[0].settings as { packages?: string[] } | undefined;
    expect(settings?.packages).toBeUndefined();
  });
});
