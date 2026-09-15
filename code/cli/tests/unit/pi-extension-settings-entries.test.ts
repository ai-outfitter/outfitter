// Tests that cached npm pi extensions resolve manifest entry files and that the pi projection
// materializes them into the generated settings.json so fresh loaders inherit them.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ensurePiExtensions, mapSpecifierToPiSource } from '../../src/extensions/PiExtensionCache.js';
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

const writeManifest = (dir: string, manifest: unknown): void => {
  write(join(dir, 'package.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest, null, 2));
};

const npmDir = (cache: string, name: string): string => join(cache, 'npm', 'node_modules', name);

/** Fake installer that creates a synthetic package at the specifier's cache path. */
const spawnerWriting = (packages: Readonly<Record<string, unknown>>): PiInstallSpawner => {
  return ({ source, cacheAgentDir }) => {
    const mapped = mapSpecifierToPiSource(source);
    if ('unsupported' in mapped) return Promise.resolve(0);
    const installDir = join(cacheAgentDir, ...mapped.installSegments);
    const manifest = packages[source];
    writeManifest(installDir, manifest ?? { name: source.slice('npm:'.length), version: '1.0.0' });
    for (const entry of (manifest as { pi?: { extensions?: readonly string[] } })?.pi?.extensions ?? []) {
      const entryPath = join(installDir, entry);
      if (entryPath.startsWith(installDir)) write(entryPath, 'export default () => {};');
    }
    return Promise.resolve(0);
  };
};

describe('ensurePiExtensions npm entry resolution', () => {
  it('resolves manifest-declared entries in manifest order for scoped and plain packages', async () => {
    const cache = temporaryDir('outfitter-entries-');
    const result = await ensurePiExtensions(['npm:@scope/name', 'npm:plain'], {
      cacheAgentDir: cache,
      offline: false,
      npmLatest: () => undefined, // install from the bare specifier; entry resolution is under test
      spawn: spawnerWriting({
        'npm:@scope/name': { name: '@scope/name', pi: { extensions: ['./ext/a.ts', './ext/b.ts'] } },
        'npm:plain': { name: 'plain', pi: { extensions: ['index.ts'] } },
      }),
    });
    expect(result.warnings).toEqual([]);
    expect(result.settingsEntries[npmDir(cache, '@scope/name')]).toEqual([
      join(npmDir(cache, '@scope/name'), 'ext/a.ts'),
      join(npmDir(cache, '@scope/name'), 'ext/b.ts'),
    ]);
    expect(result.settingsEntries[npmDir(cache, 'plain')]).toEqual([join(npmDir(cache, 'plain'), 'index.ts')]);
  });

  it('falls back to the index entry when the manifest declares no pi.extensions, without warning', async () => {
    const cache = temporaryDir('outfitter-entries-');
    const spawn = spawnerWriting({});
    write(join(npmDir(cache, 'pi-nolo'), 'index.ts'), 'export default () => {};');
    const result = await ensurePiExtensions(['npm:pi-nolo'], { cacheAgentDir: cache, offline: true, spawn });
    expect(result.warnings).toEqual([]);
    expect(result.settingsEntries[npmDir(cache, 'pi-nolo')]).toEqual([join(npmDir(cache, 'pi-nolo'), 'index.ts')]);
  });

  it('falls back to index.js when only index.js exists', async () => {
    const cache = temporaryDir('outfitter-entries-');
    write(join(npmDir(cache, 'pi-nolo'), 'index.js'), 'export default () => {};');
    const result = await ensurePiExtensions(['npm:pi-nolo'], { cacheAgentDir: cache, offline: true });
    expect(result.warnings).toEqual([]);
    expect(result.settingsEntries[npmDir(cache, 'pi-nolo')]).toEqual([join(npmDir(cache, 'pi-nolo'), 'index.js')]);
  });

  it('warns and resolves nothing for an invalid manifest with no index fallback', async () => {
    const cache = temporaryDir('outfitter-entries-');
    writeManifest(npmDir(cache, 'pi-nolo'), '{not json');
    const result = await ensurePiExtensions(['npm:pi-nolo'], { cacheAgentDir: cache, offline: true });
    expect(result.loadDirs).toEqual([npmDir(cache, 'pi-nolo')]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("extension 'npm:pi-nolo'");
    expect(result.settingsEntries[npmDir(cache, 'pi-nolo')]).toEqual([]);
  });

  it('skips declared entries missing from disk, like pi skips them, keeping the existing ones', async () => {
    const cache = temporaryDir('outfitter-entries-');
    write(join(npmDir(cache, 'pi-nolo'), 'real.ts'), 'export default () => {};');
    writeManifest(npmDir(cache, 'pi-nolo'), { name: 'pi-nolo', pi: { extensions: ['./gone.ts', './real.ts'] } });
    const result = await ensurePiExtensions(['npm:pi-nolo'], { cacheAgentDir: cache, offline: true });
    expect(result.warnings).toEqual([]);
    expect(result.settingsEntries[npmDir(cache, 'pi-nolo')]).toEqual([join(npmDir(cache, 'pi-nolo'), 'real.ts')]);
  });

  it('falls back to the index entry when every declared entry is missing from disk', async () => {
    const cache = temporaryDir('outfitter-entries-');
    write(join(npmDir(cache, 'pi-nolo'), 'index.ts'), 'export default () => {};');
    writeManifest(npmDir(cache, 'pi-nolo'), { name: 'pi-nolo', pi: { extensions: ['./gone.ts'] } });
    const result = await ensurePiExtensions(['npm:pi-nolo'], { cacheAgentDir: cache, offline: true });
    expect(result.warnings).toEqual([]);
    expect(result.settingsEntries[npmDir(cache, 'pi-nolo')]).toEqual([join(npmDir(cache, 'pi-nolo'), 'index.ts')]);
  });

  it('drops an entry escaping the install directory with a warning and keeps the contained ones', async () => {
    const cache = temporaryDir('outfitter-entries-');
    write(join(npmDir(cache, 'pi-nolo'), 'inside.ts'), 'export default () => {};');
    write(join(cache, 'escape.ts'), 'export default () => {};');
    writeManifest(npmDir(cache, 'pi-nolo'), {
      name: 'pi-nolo',
      pi: { extensions: ['../escape.ts', './inside.ts'] },
    });
    const result = await ensurePiExtensions(['npm:pi-nolo'], { cacheAgentDir: cache, offline: true });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('outside the install directory');
    expect(result.settingsEntries[npmDir(cache, 'pi-nolo')]).toEqual([join(npmDir(cache, 'pi-nolo'), 'inside.ts')]);
  });

  it('skips non-string manifest entries and falls back like pi', async () => {
    const cache = temporaryDir('outfitter-entries-');
    writeManifest(npmDir(cache, 'pi-nolo'), { name: 'pi-nolo', pi: { extensions: [42, './real.ts'] } });
    const result = await ensurePiExtensions(['npm:pi-nolo'], { cacheAgentDir: cache, offline: true });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('no resolvable entry files');
    expect(result.settingsEntries[npmDir(cache, 'pi-nolo')]).toEqual([]);
  });

  it('does not resolve entries for git-cached extensions', async () => {
    const cache = temporaryDir('outfitter-entries-');
    const deepwork = join(cache, 'git', 'github.com', 'ai-outfitter', 'deepwork');
    writeManifest(deepwork, { name: 'deepwork', pi: { extensions: ['./index.ts'] } });
    write(join(deepwork, 'index.ts'), 'export default () => {};');
    const result = await ensurePiExtensions(['git:github.com/ai-outfitter/deepwork'], {
      cacheAgentDir: cache,
      offline: true,
    });
    expect(result.warnings).toEqual([]);
    expect(result.settingsEntries[deepwork]).toBeUndefined();
  });
  it('resolves entries offline from an already-cached install without spawning the installer', async () => {
    const cache = temporaryDir('outfitter-entries-');
    let spawned = 0;
    const result = await ensurePiExtensions(['npm:pi-nolo'], {
      cacheAgentDir: cache,
      offline: true,
      spawn: () => {
        spawned += 1;
        return Promise.resolve(0);
      },
    });
    expect(spawned).toBe(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('cannot be installed offline');
    expect(result.loadDirs).toEqual([]);
    expect(Object.keys(result.settingsEntries)).toEqual([]);
  });
});

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

describe('projectComposition npm extension settings entries', () => {
  it('merges entries below existing settings.json extensions and dedupes, first occurrence winning', () => {
    const root = temporaryDir('outfitter-proj-');
    write(
      join(root, 'settings.json'),
      JSON.stringify({ quietStartup: true, extensions: ['/overlay/ext.ts', '/cached/one.ts'] }),
    );
    const projection = projectComposition(compositionPlan(['npm:one', 'npm:two']), {
      harness: 'pi',
      rootDirectory: root,
      homeDirectory: root,
      extensionSettingsEntries: ['/cached/one.ts', '/cached/two.ts', '/cached/one.ts'],
    });
    expect(projection.warnings).toEqual([]);
    const settings = JSON.parse(readFileSync(join(root, 'settings.json'), 'utf8')) as {
      extensions?: string[];
      quietStartup?: boolean;
    };
    expect(settings.extensions).toEqual(['/overlay/ext.ts', '/cached/one.ts', '/cached/two.ts']);
    expect(settings.quietStartup).toBe(true);
  });

  it('creates settings.json when missing and leaves an unparseable one untouched', () => {
    const created = temporaryDir('outfitter-proj-');
    projectComposition(compositionPlan([]), {
      harness: 'pi',
      rootDirectory: created,
      homeDirectory: created,
      extensionSettingsEntries: ['/cached/one.ts'],
    });
    expect(JSON.parse(readFileSync(join(created, 'settings.json'), 'utf8'))).toEqual({
      quietStartup: true,
      extensions: ['/cached/one.ts'],
    });

    const broken = temporaryDir('outfitter-proj-');
    write(join(broken, 'settings.json'), '{not json');
    projectComposition(compositionPlan([]), {
      harness: 'pi',
      rootDirectory: broken,
      homeDirectory: broken,
      extensionSettingsEntries: ['/cached/one.ts'],
    });
    expect(readFileSync(join(broken, 'settings.json'), 'utf8')).toBe('{not json');
  });

  it('adds no extensions key and changes nothing when there are no entries', () => {
    const root = temporaryDir('outfitter-proj-');
    projectComposition(compositionPlan([]), {
      harness: 'pi',
      rootDirectory: root,
      homeDirectory: root,
    });
    expect(JSON.parse(readFileSync(join(root, 'settings.json'), 'utf8'))).toEqual({ quietStartup: true });
  });

  it('leaves a non-object settings.json untouched', () => {
    const root = temporaryDir('outfitter-proj-');
    write(join(root, 'settings.json'), '["not-an-object"]');
    projectComposition(compositionPlan([]), {
      harness: 'pi',
      rootDirectory: root,
      homeDirectory: root,
      extensionSettingsEntries: ['/cached/one.ts'],
    });
    expect(readFileSync(join(root, 'settings.json'), 'utf8')).toBe('["not-an-object"]');
  });

  it('leaves settings.json untouched when its extensions key is not a string array', () => {
    for (const badExtensions of [{ oops: true }, [42, 'ok']]) {
      const root = temporaryDir('outfitter-proj-');
      write(join(root, 'settings.json'), JSON.stringify({ extensions: badExtensions }));
      projectComposition(compositionPlan([]), {
        harness: 'pi',
        rootDirectory: root,
        homeDirectory: root,
        extensionSettingsEntries: ['/cached/one.ts'],
      });
      expect(JSON.parse(readFileSync(join(root, 'settings.json'), 'utf8'))).toEqual({
        quietStartup: true,
        extensions: badExtensions,
      });
    }
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

describe('run path npm extension settings inheritance', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.3.24).
  // Cached npm extension entry files must be materialized into the generated pi settings.json
  // extensions array so fresh loaders (child sessions) inherit them, while launch args stay unchanged.
  it('materializes npm entries into settings.json alongside unchanged --extension launch flags', async () => {
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
      const args = capturedRuns[0].plan.args;
      expect(args[args.indexOf(installDir) - 1]).toBe('--extension');
      expect(capturedRuns[0].settings).toEqual({
        quietStartup: true,
        extensions: [join(installDir, 'index.ts')],
        packages: [installDir],
      });

      // Second run reuses the cache offline-equivalently: no reinstall, same materialized entries.
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

  it('keeps a manifest with no resolvable entries warning-only outside strict mode and fatal under --strict', async () => {
    const { home, project } = runTree();
    write(
      join(project, '.agents', 'agents', 'dev', 'agent.md'),
      '---\nname: dev\nextensions: ["npm:pi-empty"]\n---\n\nBody.\n',
    );
    const common = {
      homeDirectory: home,
      projectDirectory: project,
      agent: 'dev',
      harness: 'pi',
      launcher: capturingLauncher,
      extensionInstallSpawner: spawnerWriting({}),
      extensionNpmLatest: () => undefined,
    } as const;
    const normal = await executeRunAgentCommand(common);
    expect(normal.exitCode).toBe(0);
    expect(normal.messages.join(' ')).toContain("extension 'npm:pi-empty'");
    expect(capturedRuns[0].settings).toEqual({
      quietStartup: true,
      packages: [join(home, '.cache', 'outfitter', 'pi-extensions', 'npm', 'node_modules', 'pi-empty')],
    });

    capturedRuns.length = 0;
    const strict = await executeRunAgentCommand({ ...common, strict: true });
    expect(strict.exitCode).toBe(1);
    expect(strict.messages.join(' ')).toContain("extension 'npm:pi-empty'");
  });

  it('does not write settings entries for non-pi harnesses', async () => {
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
    expect(capturedRuns[0].plan.args.join(' ')).not.toContain('--extension');
    const settings = capturedRuns[0].settings as { extensions?: string[] } | undefined;
    expect(settings?.extensions).toBeUndefined();
  });
});
