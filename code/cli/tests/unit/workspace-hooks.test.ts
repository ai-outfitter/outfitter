// Tests workspace-only portable hook discovery, immutable snapshots, dispatch, and adapters.
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

import type { CompositionPlan } from '../../src/composer/Composition.js';
import { compose } from '../../src/composer/Composer.js';
import { readWorkspaceHooks } from '../../src/hooks/WorkspaceHook.js';
import { projectComposition } from '../../src/projection/ProjectHarness.js';
import { discoverLayers } from '../../src/resolver/Layer.js';
import { resolveResources } from '../../src/resolver/Resolver.js';
import { validateSchema } from '../../src/validation/SchemaValidator.js';

const roots: string[] = [];
const root = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'outfitter-workspace-hooks-'));
  roots.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of roots.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const write = (path: string, content: string, mode?: number): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  if (mode !== undefined) chmodSync(path, mode);
};

const hookManifest = (name: string, command = './scripts/check.mjs', args: readonly string[] = []): string =>
  [
    'version: 1',
    `name: ${name}`,
    `description: ${name} checks the workspace.`,
    'events:',
    '  stop:',
    `    command: ${command}`,
    `    args: ${JSON.stringify(args)}`,
    '    timeout_seconds: 30',
    '',
  ].join('\n');

const addHook = (project: string, slug: string, script = '#!/usr/bin/env node\nprocess.exit(0);\n'): string => {
  const directory = join(project, '.agents', 'hooks', slug);
  write(join(directory, 'hook.yml'), hookManifest(slug));
  write(join(directory, 'scripts', 'check.mjs'), script, 0o755);
  return directory;
};

const composition = (snapshot: ReturnType<typeof readWorkspaceHooks>): CompositionPlan => ({
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
  },
  workspaceHooks: snapshot,
  warnings: [],
});

describe('workspace hook schema and discovery', () => {
  // THIS TEST VALIDATES HARD REQUIREMENTS (OFTR-012.1 AND OFTR-012.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('discovers only root workspace hooks in slug order and snapshots package bytes', () => {
    const project = root();
    addHook(project, 'z-last');
    const first = addHook(project, 'a-first');
    write(join(project, '.agents', 'agents', 'engineer', 'hooks', 'ignored', 'hook.yml'), hookManifest('ignored'));
    write(join(project, '.agents', 'hooks', 'a-first', 'data', 'message.txt'), 'before');

    const snapshot = readWorkspaceHooks(project);
    write(join(first, 'data', 'message.txt'), 'after');

    expect(snapshot.workspaceDirectory).toBe(project);
    expect(snapshot.hooks.map((hook) => hook.slug)).toEqual(['a-first', 'z-last']);
    expect(snapshot.hooks[0]?.files.map((file) => file.path)).toEqual([
      'data/message.txt',
      'hook.yml',
      'scripts/check.mjs',
    ]);
    expect(Buffer.from(snapshot.hooks[0].files[0].content).toString()).toBe('before');
  });

  it('treats an absent workspace hook directory as empty', () => {
    const project = root();
    expect(readWorkspaceHooks(project)).toEqual({ workspaceDirectory: project, hooks: [] });
  });

  it('validates the v1 manifest schema', () => {
    expect(
      validateSchema('workspace-hook', {
        version: 1,
        name: 'check',
        description: 'Checks.',
        events: { stop: { command: './check', args: [], timeout_seconds: 1 } },
      }).valid,
    ).toBe(true);
    expect(validateSchema('workspace-hook', { version: 2 }).valid).toBe(false);
  });

  // THIS TEST VALIDATES HARD REQUIREMENTS (OFTR-012.2 AND OFTR-012.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('rejects symlinks, invalid paths, missing commands, and non-executable commands', () => {
    const linkedRoot = root();
    const physical = join(linkedRoot, 'physical');
    mkdirSync(physical);
    mkdirSync(join(linkedRoot, '.agents'));
    symlinkSync(physical, join(linkedRoot, '.agents', 'hooks'));
    expect(() => readWorkspaceHooks(linkedRoot)).toThrow(/must not be a symlink/u);

    const linkedPackage = root();
    const packageDirectory = addHook(linkedPackage, 'linked-file');
    write(join(packageDirectory, 'real'), 'x');
    symlinkSync(join(packageDirectory, 'real'), join(packageDirectory, 'link'));
    expect(() => readWorkspaceHooks(linkedPackage)).toThrow(/must not be a symlink/u);

    const escaping = root();
    const escapingDirectory = addHook(escaping, 'escaping');
    write(join(escapingDirectory, 'hook.yml'), hookManifest('escaping', './../outside'));
    expect(() => readWorkspaceHooks(escaping)).toThrow(/must stay inside/u);

    const missing = root();
    const missingDirectory = addHook(missing, 'missing');
    write(join(missingDirectory, 'hook.yml'), hookManifest('missing', './scripts/absent'));
    expect(() => readWorkspaceHooks(missing)).toThrow(/must name a regular file/u);

    const notExecutable = root();
    addHook(notExecutable, 'not-executable');
    chmodSync(join(notExecutable, '.agents', 'hooks', 'not-executable', 'scripts', 'check.mjs'), 0o644);
    expect(() => readWorkspaceHooks(notExecutable)).toThrow(/must be executable/u);
  });

  it('rejects malformed manifests, name mismatches, and invalid root entries', () => {
    const malformed = root();
    const malformedDirectory = addHook(malformed, 'malformed');
    write(join(malformedDirectory, 'hook.yml'), 'version: [unterminated\n');
    expect(() => readWorkspaceHooks(malformed)).toThrow(/Invalid workspace hook/u);

    const schemaInvalid = root();
    const invalidDirectory = addHook(schemaInvalid, 'invalid');
    write(join(invalidDirectory, 'hook.yml'), 'version: 1\nname: invalid\ndescription: x\nevents:\n  stop: {}\n');
    expect(() => readWorkspaceHooks(schemaInvalid)).toThrow(/required property/u);

    const mismatch = root();
    const mismatchDirectory = addHook(mismatch, 'directory-name');
    write(join(mismatchDirectory, 'hook.yml'), hookManifest('other-name'));
    expect(() => readWorkspaceHooks(mismatch)).toThrow(/must match its directory/u);

    const badSlug = root();
    write(join(badSlug, '.agents', 'hooks', 'BAD', 'hook.yml'), hookManifest('bad'));
    expect(() => readWorkspaceHooks(badSlug)).toThrow(/Invalid workspace hook slug/u);

    const fileEntry = root();
    write(join(fileEntry, '.agents', 'hooks', 'not-a-package'), 'x');
    expect(() => readWorkspaceHooks(fileEntry)).toThrow(/must be a directory/u);

    const fileRoot = root();
    write(join(fileRoot, '.agents', 'hooks'), 'x');
    expect(() => readWorkspaceHooks(fileRoot)).toThrow(/must be a directory/u);

    const linkedManifest = root();
    const linkedManifestDirectory = addHook(linkedManifest, 'linked-manifest');
    const physicalManifest = join(linkedManifestDirectory, 'physical.yml');
    write(physicalManifest, hookManifest('linked-manifest'));
    rmSync(join(linkedManifestDirectory, 'hook.yml'));
    symlinkSync(physicalManifest, join(linkedManifestDirectory, 'hook.yml'));
    expect(() => readWorkspaceHooks(linkedManifest)).toThrow(/must not be a symlink/u);

    const missingManifest = root();
    const missingManifestDirectory = addHook(missingManifest, 'missing-manifest');
    rmSync(join(missingManifestDirectory, 'hook.yml'));
    expect(() => readWorkspaceHooks(missingManifest)).toThrow(/must be a regular file/u);
  });

  it('returns hook validation failures as composition errors', () => {
    const project = root();
    write(join(project, '.agents', 'agents', 'engineer', 'agent.md'), '---\nname: engineer\n---\n\nBody.\n');
    write(join(project, '.agents', 'hooks', 'bad', 'hook.yml'), 'bad: true\n');
    const layers = discoverLayers({ homeDirectory: join(project, 'home'), projectDirectory: project, settings: {} });
    const result = compose(resolveResources(layers.layers), 'engineer', { projectDirectory: project });
    expect(result.plan).toBeUndefined();
    expect(result.errors.join(' ')).toContain('Invalid workspace hook');
  });
});

describe('workspace hook projection and dispatch', () => {
  // THIS TEST VALIDATES HARD REQUIREMENTS (OFTR-012.4, OFTR-012.5, AND OFTR-012.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('runs snapshot commands as argv with normalized stdin and returns continuation reasons', () => {
    const project = root();
    addHook(
      project,
      'capture',
      [
        '#!/usr/bin/env node',
        "import { readFileSync } from 'node:fs';",
        "const payload = JSON.parse(readFileSync(0, 'utf8'));",
        'process.stdout.write(JSON.stringify(payload));',
        'process.exit(2);',
        '',
      ].join('\n'),
    );
    const projectionRoot = root();
    projectComposition(composition(readWorkspaceHooks(project)), {
      harness: 'claude',
      rootDirectory: projectionRoot,
      homeDirectory: root(),
    });
    const dispatcher = join(projectionRoot, '.outfitter', 'workspace-hooks', 'dispatcher.mjs');
    const result = spawnSync(process.execPath, [dispatcher, '--harness', 'claude', '--event', 'stop'], {
      input: JSON.stringify({ stop_hook_active: false }),
      encoding: 'utf8',
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Workspace hook 'capture' requested continuation");
    expect(result.stderr).toContain(`"workspace":"${project}"`);
    expect(result.stderr).toContain('"continuation":{"active":false,"supported":true}');
    expect(result.stderr).toContain('"hook":{"slug":"capture","name":"capture"}');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-012.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('fails open when a Claude hook requests a second continuation', () => {
    const project = root();
    addHook(
      project,
      'capture',
      [
        '#!/usr/bin/env node',
        "import { readFileSync } from 'node:fs';",
        "process.stdout.write(readFileSync(0, 'utf8'));",
        'process.exit(2);',
        '',
      ].join('\n'),
    );
    const projectionRoot = root();
    projectComposition(composition(readWorkspaceHooks(project)), {
      harness: 'claude',
      rootDirectory: projectionRoot,
      homeDirectory: root(),
    });
    const dispatcher = join(projectionRoot, '.outfitter', 'workspace-hooks', 'dispatcher.mjs');
    const result = spawnSync(process.execPath, [dispatcher, '--harness', 'claude', '--event', 'stop'], {
      input: JSON.stringify({ stop_hook_active: true }),
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('stopping to prevent a loop');
    expect(result.stderr).toContain('"continuation":{"active":true,"supported":true}');
    expect(result.stderr).not.toContain("Workspace hook 'capture' requested continuation:");
  });

  it('warns and fails open for ordinary failure and timeout', () => {
    const project = root();
    addHook(project, 'failed', '#!/usr/bin/env node\nprocess.stderr.write("bad\\n"); process.exit(1);\n');
    const snapshot = readWorkspaceHooks(project);
    const timedSnapshot = {
      ...snapshot,
      hooks: snapshot.hooks.map((hook) => ({
        ...hook,
        events: { stop: { ...hook.events.stop!, timeoutSeconds: 0.001 } },
      })),
    };
    const projectionRoot = root();
    projectComposition(composition(timedSnapshot), {
      harness: 'pi',
      rootDirectory: projectionRoot,
      homeDirectory: root(),
    });
    const dispatcher = join(projectionRoot, '.outfitter', 'workspace-hooks', 'dispatcher.mjs');
    const result = spawnSync(
      process.execPath,
      [dispatcher, '--harness', 'pi', '--event', 'stop', '--native-event-json', '{}'],
      { encoding: 'utf8' },
    );
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("Warning: workspace hook 'failed' failed");
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-012.7).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('projects Claude hooks into only the temporary inherited plugin or isolated settings', () => {
    const project = root();
    addHook(project, 'check');
    const snapshot = readWorkspaceHooks(project);
    const inheritedRoot = root();
    const inherited = projectComposition(composition(snapshot), {
      harness: 'claude',
      rootDirectory: inheritedRoot,
      homeDirectory: root(),
    });
    const inheritedHooks = JSON.parse(readFileSync(join(inheritedRoot, 'hooks', 'hooks.json'), 'utf8')) as {
      hooks: { Stop: { hooks: { command: string }[] }[] };
    };
    expect(inheritedHooks.hooks.Stop[0].hooks[0].command).toContain('$CLAUDE_PLUGIN_ROOT');
    expect(inherited.launch.args).toEqual(expect.arrayContaining(['--plugin-dir', inheritedRoot]));

    const isolatedRoot = root();
    write(
      join(isolatedRoot, 'settings.json'),
      JSON.stringify({
        preserved: true,
        hooks: {
          SessionStart: [{ hooks: [{ type: 'command', command: 'existing-start' }] }],
          Stop: [{ hooks: [{ type: 'command', command: 'existing-stop' }] }],
        },
      }),
    );
    const isolated = projectComposition(composition(snapshot), {
      harness: 'claude',
      rootDirectory: isolatedRoot,
      homeDirectory: root(),
      isolation: 'isolated',
    });
    const isolatedSettings = JSON.parse(readFileSync(join(isolatedRoot, 'settings.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(isolatedSettings.preserved).toBe(true);
    expect(isolatedSettings.hooks).toMatchObject({
      SessionStart: [{ hooks: [{ command: 'existing-start' }] }],
      Stop: [{ hooks: [{ command: 'existing-stop' }] }, { hooks: [{ type: 'command' }] }],
    });
    expect(isolated.launch.env.CLAUDE_CONFIG_DIR).toBe(isolatedRoot);

    const invalidSettingsRoot = root();
    write(join(invalidSettingsRoot, 'settings.json'), '{not json');
    projectComposition(composition(snapshot), {
      harness: 'claude',
      rootDirectory: invalidSettingsRoot,
      homeDirectory: root(),
      isolation: 'isolated',
    });
    const repairedSettings = JSON.parse(readFileSync(join(invalidSettingsRoot, 'settings.json'), 'utf8')) as {
      hooks?: { Stop?: unknown };
    };
    expect(Array.isArray(repairedSettings.hooks?.Stop)).toBe(true);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-012.8).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('projects a Pi extension that carries continuation state and prevents a second continuation', () => {
    const project = root();
    addHook(project, 'check');
    const projectionRoot = root();
    const projection = projectComposition(composition(readWorkspaceHooks(project)), {
      harness: 'pi',
      rootDirectory: projectionRoot,
      homeDirectory: root(),
    });
    const extensionPath = projection.launch.args[1];
    const extension = readFileSync(extensionPath, 'utf8');
    expect(projection.launch.args.slice(0, 2)).toEqual(['--extension', extensionPath]);
    expect(extension).toContain("pi.on('agent_end'");
    expect(extension).toContain("pi.sendUserMessage(reason, { deliverAs: 'followUp' })");
    expect(extension).toContain('requested continuation twice');
  });

  it('delivers Pi hook warnings through the channel the active run mode actually renders', async () => {
    const project = root();
    addHook(project, 'check');
    const projectionRoot = root();
    const projection = projectComposition(composition(readWorkspaceHooks(project)), {
      harness: 'pi',
      rootDirectory: projectionRoot,
      homeDirectory: root(),
    });
    const module = (await import(pathToFileURL(projection.launch.args[1]).href)) as {
      default: (api: unknown) => void;
    };

    // pi loads the extension in-process. A TUI owns the terminal and renders notify() while a raw
    // stderr write lands inside the frame; a headless run has the opposite pair, because its
    // fallback notify() is a no-op. The OFTR-012.6.2 loop warning must survive either way, so
    // drive the same two-turn refusal through both run modes.
    const refuseSecondContinuation = async (
      hasUI: boolean,
    ): Promise<{ readonly notified: string; readonly written: string; readonly followUps: number }> => {
      const notified: string[] = [];
      const written: string[] = [];
      let followUps = 0;
      let handler: ((event: unknown, ctx: unknown) => Promise<void>) | undefined;
      module.default({
        on: (_event: string, registered: (event: unknown, ctx: unknown) => Promise<void>) => {
          handler = registered;
        },
        exec: () => Promise.resolve({ stdout: '', stderr: '', code: 2, killed: false }),
        sendUserMessage: () => {
          followUps += 1;
        },
      });
      const ctx = { hasUI, ui: { notify: (message: string) => notified.push(message) } };

      const originalWrite = process.stderr.write.bind(process.stderr);
      process.stderr.write = (chunk: string) => {
        written.push(String(chunk));
        return true;
      };
      try {
        await handler!({}, ctx);
        await handler!({}, ctx);
      } finally {
        process.stderr.write = originalWrite;
      }
      return { notified: notified.join(' '), written: written.join(' '), followUps };
    };

    const rendered = await refuseSecondContinuation(true);
    expect(rendered.followUps).toBe(1);
    expect(rendered.notified).toContain('requested continuation twice');
    expect(rendered.written).not.toContain('requested continuation twice');

    const headless = await refuseSecondContinuation(false);
    expect(headless.followUps).toBe(1);
    expect(headless.written).toContain('requested continuation twice');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-012.9).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('leaves Codex configuration unchanged and reports the verified compatibility limit', () => {
    const project = root();
    addHook(project, 'check');
    const projection = projectComposition(composition(readWorkspaceHooks(project)), {
      harness: 'codex',
      rootDirectory: root(),
      homeDirectory: root(),
      passThroughArgs: ['exec', 'work'],
    });
    expect(projection.launch.args).toEqual(['exec', 'work']);
    expect(projection.warnings.join(' ')).toContain('cannot safely project workspace stop hooks');
    expect(projection.warnings.join(' ')).toContain('notify hooks cannot request continuation');
  });

  it('does nothing when a composition has no workspace hooks', () => {
    const noSnapshot = { ...composition({ workspaceDirectory: root(), hooks: [] }), workspaceHooks: undefined };
    const emptySnapshot = composition({ workspaceDirectory: root(), hooks: [] });
    for (const plan of [noSnapshot, emptySnapshot]) {
      const projectionRoot = root();
      const projection = projectComposition(plan, {
        harness: 'pi',
        rootDirectory: projectionRoot,
        homeDirectory: root(),
      });
      expect(projection.warnings).toEqual([]);
      expect(existsSync(join(projectionRoot, '.outfitter', 'workspace-hooks'))).toBe(false);
    }
  });

  it('keeps the dispatcher generic when a future snapshot has no stop handler', () => {
    const workspaceDirectory = root();
    const plan = composition({
      workspaceDirectory,
      hooks: [
        {
          slug: 'future-event',
          name: 'future-event',
          description: 'A future event.',
          events: {},
          files: [],
        },
      ],
    });
    const projectionRoot = root();
    projectComposition(plan, {
      harness: 'claude',
      rootDirectory: projectionRoot,
      homeDirectory: root(),
    });
    const dispatcher = readFileSync(join(projectionRoot, '.outfitter', 'workspace-hooks', 'dispatcher.mjs'), 'utf8');
    expect(dispatcher).toContain(`"workspace":"${workspaceDirectory}"`);
    expect(dispatcher).toContain('"hooks":[]');
  });
});
