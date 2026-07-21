/* eslint-disable max-lines */
// Tests the renderer-independent setup state machine and Pi-hosted command handoff.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createSetupCommand, preparePiSetupLaunch, runSetup } from '../../src/cli/commands/SetupCommand.js';
import type { AgentLaunchPlan } from '../../src/projection/Projection.js';
import { defaultCatalogSource } from '../../src/setup/DefaultCatalog.js';
import { applySetupSelection, discoverSetupAgentChoices, sanitizeAgentSlug } from '../../src/setup/Setup.js';

const temporaryRoots: string[] = [];

const createTree = (): { catalog: string; home: string; project: string; root: string } => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-setup-'));
  temporaryRoots.push(root);
  const home = join(root, 'home');
  const project = join(root, 'project');
  const catalog = join(root, 'default-profiles');
  mkdirSync(home, { recursive: true });
  mkdirSync(project, { recursive: true });
  write(
    join(catalog, 'agents', 'founder', 'agent.md'),
    '---\nname: founder\ndescription: Founder/operator profile.\n---\n\n# Founder\n',
  );
  write(
    join(catalog, 'agents', 'engineer', 'agent.md'),
    '---\nname: engineer\ndescription: Engineering profile.\n---\n\n# Engineer\n',
  );
  write(join(catalog, 'skills', 'planning', 'SKILL.md'), '---\nname: planning\n---\n');
  return { catalog, home, project, root };
};

const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

const selectionPathFromPlan = (plan: AgentLaunchPlan): string => {
  const extensionPath = plan.args[plan.args.indexOf('--extension') + 1];
  const extension = readFileSync(extensionPath, 'utf8');
  const encoded = /^const OUTFITTER_SETUP_RESULT_PATH = (.+);$/mu.exec(extension)?.[1];
  if (encoded === undefined) throw new Error('stamped setup result path not found');
  return JSON.parse(encoded) as string;
};

let previousExitCode: typeof process.exitCode;
beforeEach(() => {
  previousExitCode = process.exitCode;
});
afterEach(() => {
  // The post-setup profile launch may set process.exitCode when a catalog agent is not resolvable
  // in the test's isolated home; keep that from leaking into the runner's exit status.
  process.exitCode = previousExitCode;
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('setup state machine', () => {
  it('discovers the default Outfitter catalog with display metadata', () => {
    const { catalog } = createTree();
    expect(discoverSetupAgentChoices({ defaultCatalogRoot: catalog })).toEqual([
      { id: 'founder', label: 'Founder', description: 'Founder/operator profile.' },
      { id: 'engineer', label: 'Engineer', description: 'Engineering profile.' },
    ]);
    expect(discoverSetupAgentChoices({})).toEqual([]);
  });

  it('keeps a non-comment # in frontmatter metadata (e.g. C#) but strips a real inline comment', () => {
    const { catalog } = createTree();
    write(
      join(catalog, 'agents', 'polyglot', 'agent.md'),
      '---\nname: polyglot\nlabel: C# and F# # trailing note\ndescription: Handles C# code.\n---\n',
    );
    const choice = discoverSetupAgentChoices({ defaultCatalogRoot: catalog }).find((entry) => entry.id === 'polyglot');
    expect(choice).toEqual({ id: 'polyglot', label: 'C# and F#', description: 'Handles C# code.' });
  });

  it('skips malformed catalog entries and derives fallback metadata', () => {
    const { catalog } = createTree();
    write(join(catalog, 'agents', 'bare', 'agent.md'), '---\nname: bare\n---\n');
    write(join(catalog, 'agents', 'heading', 'agent.md'), '---\nname: heading\n---\n\n# Heading Label\n');
    write(join(catalog, 'agents', 'implicit', 'agent.md'), '---\ndescription: Implicit name.\n---\n');
    write(join(catalog, 'agents', 'mismatch', 'agent.md'), '---\nname: other\n---\n');
    mkdirSync(join(catalog, 'agents', 'directory-file', 'agent.md'), { recursive: true });
    expect(discoverSetupAgentChoices({ defaultCatalogRoot: join(catalog, 'missing') })).toEqual([]);
    const choices = discoverSetupAgentChoices({ defaultCatalogRoot: catalog });
    expect(choices).toEqual(
      expect.arrayContaining([
        { id: 'bare', label: 'bare', description: 'Outfitter profile from the default catalog.' },
        { id: 'heading', label: 'Heading Label', description: 'Outfitter profile from the default catalog.' },
        { id: 'implicit', label: 'implicit', description: 'Implicit name.' },
      ]),
    );
    expect(choices.some((choice) => choice.id === 'mismatch')).toBe(false);
  });

  it('pins the canonical default catalog and saves the selected profile and CLI agent', () => {
    const { catalog, home, project } = createTree();
    const availableAgents = discoverSetupAgentChoices({ defaultCatalogRoot: catalog });
    const result = applySetupSelection({
      homeDirectory: home,
      projectDirectory: project,
      defaultCatalogRoot: catalog,
      availableAgents,
      selection: { setupMode: 'default', agentId: 'founder', harness: 'pi', target: 'home' },
    });

    expect(readFileSync(join(home, '.agents', 'settings.yml'), 'utf8')).toBe(
      `default_agent: founder\ndefault_harness: pi\nsources:\n  - github: ${defaultCatalogSource.github}\n` +
        `    ref: ${defaultCatalogSource.ref}\n`,
    );
    expect(existsSync(join(home, '.agents', 'catalogs'))).toBe(false);
    expect(result.defaultAgent).toBe('founder');
  });

  it('updates defaults and replaces a stale default-catalog pin exactly once', () => {
    const { catalog, home, project } = createTree();
    write(
      join(home, '.agents', 'settings.yml'),
      'default_agent: engineer\ndefault_harness: claude\nsources:\n  - path: ./personal\n' +
        '  - github: ai-outfitter/default-profiles\n    ref: old\n    path: profiles\n' +
        'startup:\n  ascii_art: false\n',
    );
    const availableAgents = discoverSetupAgentChoices({ defaultCatalogRoot: catalog });
    const input = {
      homeDirectory: home,
      projectDirectory: project,
      defaultCatalogRoot: catalog,
      availableAgents,
      selection: { setupMode: 'default', agentId: 'founder', harness: 'pi', target: 'home' } as const,
    };
    applySetupSelection(input);
    applySetupSelection(input);
    const settings = readFileSync(join(home, '.agents', 'settings.yml'), 'utf8');
    expect(settings).toContain('default_agent: founder');
    expect(settings).toContain('default_harness: pi');
    expect(settings).toContain(
      `  - path: ./personal\n  - github: ${defaultCatalogSource.github}\n    ref: ${defaultCatalogSource.ref}\nstartup:`,
    );
    expect(settings.match(/github: ai-outfitter\/default-profiles/gu)).toHaveLength(1);
    expect(settings).not.toContain('path: profiles');
  });

  it('adds the pinned default source to an existing source list', () => {
    const { catalog, home, project } = createTree();
    write(join(home, '.agents', 'settings.yml'), 'sources:\n  - path: ./personal\n');
    applySetupSelection({
      homeDirectory: home,
      projectDirectory: project,
      defaultCatalogRoot: catalog,
      availableAgents: discoverSetupAgentChoices({ defaultCatalogRoot: catalog }),
      selection: { setupMode: 'default', agentId: 'founder', harness: 'pi', target: 'home' },
    });
    expect(readFileSync(join(home, '.agents', 'settings.yml'), 'utf8')).toContain(
      `sources:\n  - github: ${defaultCatalogSource.github}\n    ref: ${defaultCatalogSource.ref}\n  - path: ./personal`,
    );
  });

  it('adds the immutable ref to an unpinned canonical source', () => {
    const { catalog, home, project } = createTree();
    write(join(home, '.agents', 'settings.yml'), `sources:\n  - github: ${defaultCatalogSource.github}\n`);
    applySetupSelection({
      homeDirectory: home,
      projectDirectory: project,
      defaultCatalogRoot: catalog,
      availableAgents: discoverSetupAgentChoices({ defaultCatalogRoot: catalog }),
      selection: { setupMode: 'default', agentId: 'founder', harness: 'pi', target: 'home' },
    });
    expect(readFileSync(join(home, '.agents', 'settings.yml'), 'utf8')).toContain(
      `github: ${defaultCatalogSource.github}\n    ref: ${defaultCatalogSource.ref}`,
    );
  });

  it('creates a custom profile at the selected target and preserves unrelated settings', () => {
    const { catalog, home, project } = createTree();
    write(join(project, '.agents', 'settings.yml'), 'startup:\n  ascii_art: false\n');
    const result = applySetupSelection({
      homeDirectory: home,
      projectDirectory: project,
      defaultCatalogRoot: catalog,
      availableAgents: [],
      selection: {
        setupMode: 'create',
        agentId: 'my-profile',
        agentLabel: 'My Profile',
        harness: 'claude',
        target: 'project',
      },
    });

    expect(readFileSync(join(project, '.agents', 'agents', 'my-profile', 'agent.md'), 'utf8')).toContain(
      '# My Profile',
    );
    const settings = readFileSync(join(project, '.agents', 'settings.yml'), 'utf8');
    expect(settings).toContain('ascii_art: false');
    expect(settings).toContain('default_agent: my-profile');
    expect(settings).toContain('default_harness: claude');
    expect(result.updated).toEqual([join(project, '.agents', 'settings.yml')]);
  });

  it('preserves a custom profile that already exists while selecting it', () => {
    const { home, project } = createTree();
    const agentPath = join(home, '.agents', 'agents', 'founder', 'agent.md');
    write(agentPath, 'USER OWNED');
    applySetupSelection({
      homeDirectory: home,
      projectDirectory: project,
      availableAgents: [],
      selection: { setupMode: 'create', agentId: 'founder', harness: 'pi', target: 'home' },
    });
    expect(readFileSync(agentPath, 'utf8')).toBe('USER OWNED');
    expect(readFileSync(join(home, '.agents', 'settings.yml'), 'utf8')).toContain('default_agent: founder');
  });

  it('persists the original different-catalog outcome with the selected CLI agent', () => {
    const { home, project } = createTree();
    applySetupSelection({
      homeDirectory: home,
      projectDirectory: project,
      availableAgents: [],
      selection: {
        setupMode: 'catalog',
        github: 'acme/outfitter-config',
        ref: 'main',
        settingsPath: 'settings.yml',
        harness: 'claude',
        target: 'project',
      },
    });
    expect(readFileSync(join(project, '.agents', 'settings.yml'), 'utf8')).toBe(
      'default_harness: claude\nremote_settings:\n  - github: acme/outfitter-config\n    ref: main\n    path: settings.yml\n',
    );
  });

  it('enables private catalogs in home settings for home and project installs', () => {
    const { home, project } = createTree();
    const catalogSelection = {
      setupMode: 'catalog' as const,
      github: 'company/private-profiles',
      ref: 'main',
      settingsPath: 'settings.yml',
      harness: 'pi' as const,
      privateCatalogsEnabled: true,
    };
    applySetupSelection({
      homeDirectory: home,
      projectDirectory: project,
      availableAgents: [],
      selection: { ...catalogSelection, privateCatalogAccepted: true, target: 'home' },
    });
    expect(readFileSync(join(home, '.agents', 'settings.yml'), 'utf8')).toContain('private_catalogs: true');

    write(join(home, '.agents', 'settings.yml'), 'enterprise:\n  private_catalogs: false\ncustom: kept\n');
    applySetupSelection({
      homeDirectory: home,
      projectDirectory: project,
      availableAgents: [],
      selection: { ...catalogSelection, privateCatalogAccepted: true, target: 'project' },
    });
    expect(readFileSync(join(home, '.agents', 'settings.yml'), 'utf8')).toContain('private_catalogs: true');
    expect(readFileSync(join(home, '.agents', 'settings.yml'), 'utf8')).toContain('custom: kept');
    expect(readFileSync(join(project, '.agents', 'settings.yml'), 'utf8')).toContain('company/private-profiles');

    write(join(home, '.agents', 'settings.yml'), 'enterprise:\n  private_catalogs: true\n');
    applySetupSelection({
      homeDirectory: home,
      projectDirectory: project,
      availableAgents: [],
      selection: { ...catalogSelection, privateCatalogAccepted: true, target: 'project' },
    });
    expect(readFileSync(join(home, '.agents', 'settings.yml'), 'utf8')).toContain('private_catalogs: true');
  });

  it('creates home enterprise settings for a private project catalog and appends to unrelated settings', () => {
    const first = createTree();
    const selection = {
      setupMode: 'catalog' as const,
      github: 'company/private-profiles',
      ref: 'main',
      settingsPath: 'settings.yml',
      harness: 'pi' as const,
      privateCatalogAccepted: true,
      privateCatalogsEnabled: true,
      target: 'project' as const,
    };
    applySetupSelection({
      homeDirectory: first.home,
      projectDirectory: first.project,
      availableAgents: [],
      selection,
    });
    expect(readFileSync(join(first.home, '.agents', 'settings.yml'), 'utf8')).toBe(
      'enterprise:\n  private_catalogs: true\n',
    );

    const second = createTree();
    write(join(second.home, '.agents', 'settings.yml'), 'custom: kept\n');
    applySetupSelection({
      homeDirectory: second.home,
      projectDirectory: second.project,
      availableAgents: [],
      selection,
    });
    expect(readFileSync(join(second.home, '.agents', 'settings.yml'), 'utf8')).toBe(
      'custom: kept\nenterprise:\n  private_catalogs: true\n',
    );
  });

  it('rolls back a private home change when the project settings write fails', () => {
    const { home, project } = createTree();
    write(join(home, '.agents', 'settings.yml'), 'enterprise:\n  private_catalogs: false\n');
    mkdirSync(join(project, '.agents', 'settings.yml'), { recursive: true });
    expect(() =>
      applySetupSelection({
        homeDirectory: home,
        projectDirectory: project,
        availableAgents: [],
        selection: {
          setupMode: 'catalog',
          github: 'company/private-profiles',
          ref: 'main',
          settingsPath: 'settings.yml',
          harness: 'pi',
          privateCatalogAccepted: true,
          privateCatalogsEnabled: true,
          target: 'project',
        },
      }),
    ).toThrow();
    expect(readFileSync(join(home, '.agents', 'settings.yml'), 'utf8')).toContain('private_catalogs: false');
  });

  it('removes newly created private home settings when the project write fails', () => {
    const { home, project } = createTree();
    mkdirSync(join(project, '.agents', 'settings.yml'), { recursive: true });
    expect(() =>
      applySetupSelection({
        homeDirectory: home,
        projectDirectory: project,
        availableAgents: [],
        selection: {
          setupMode: 'catalog',
          github: 'company/private-profiles',
          ref: 'main',
          settingsPath: 'settings.yml',
          harness: 'pi',
          privateCatalogAccepted: true,
          privateCatalogsEnabled: true,
          target: 'project',
        },
      }),
    ).toThrow();
    expect(existsSync(join(home, '.agents', 'settings.yml'))).toBe(false);
  });

  it('persists a provided setup source with the selected CLI agent', () => {
    const { home, project } = createTree();
    applySetupSelection({
      homeDirectory: home,
      projectDirectory: project,
      availableAgents: [],
      selection: {
        setupMode: 'source',
        sourceUri: 'https://example.test/catalog.git',
        harness: 'pi',
        target: 'home',
      },
    });
    expect(readFileSync(join(home, '.agents', 'settings.yml'), 'utf8')).toBe(
      'default_harness: pi\nremote_settings:\n  - uri: "https://example.test/catalog.git"\n    path: settings.yml\n',
    );
  });

  it('rejects invalid handoffs before writing', () => {
    const { catalog, home, project } = createTree();
    const availableAgents = discoverSetupAgentChoices({ defaultCatalogRoot: catalog });
    const base = { homeDirectory: home, projectDirectory: project, availableAgents, defaultCatalogRoot: catalog };
    expect(() =>
      applySetupSelection({
        ...base,
        selection: { setupMode: 'default', agentId: 'missing', harness: 'pi', target: 'home' },
      }),
    ).toThrow(/unavailable agent/);
    expect(() =>
      applySetupSelection({
        homeDirectory: home,
        projectDirectory: project,
        availableAgents: [{ id: 'founder', label: 'Founder', description: 'Founder.' }],
        selection: { setupMode: 'default', agentId: 'founder', harness: 'pi', target: 'home' },
      }),
    ).toThrow(/catalog is unavailable/);
    expect(() =>
      applySetupSelection({
        ...base,
        selection: { setupMode: 'create', agentId: 'bad id', harness: 'pi', target: 'home' },
      }),
    ).toThrow(/invalid agent id/);
    // Validation runs on the exact id that gets written, so schema-invalid slugs (underscores, dots)
    // are rejected up front rather than written as an unresolvable agent.
    for (const agentId of ['bad_id', 'my.profile', 'my--profile']) {
      expect(() =>
        applySetupSelection({ ...base, selection: { setupMode: 'create', agentId, harness: 'pi', target: 'home' } }),
      ).toThrow(/invalid agent id/);
    }
    expect(() =>
      applySetupSelection({
        ...base,
        selection: { setupMode: 'create', agentId: 'okay', harness: 'codex' as 'pi', target: 'home' },
      }),
    ).toThrow(/unsupported harness/);
    for (const selection of [
      { setupMode: 'catalog', github: 'bad', ref: 'main', settingsPath: 'settings.yml', harness: 'pi', target: 'home' },
      { setupMode: 'catalog', github: 'ok/repo', ref: '', settingsPath: 'settings.yml', harness: 'pi', target: 'home' },
      { setupMode: 'catalog', github: 'ok/repo', ref: 'main', settingsPath: '../bad', harness: 'pi', target: 'home' },
      { setupMode: 'source', sourceUri: '', harness: 'pi', target: 'home' },
    ] as const) {
      expect(() => applySetupSelection({ ...base, selection })).toThrow(/invalid/);
    }
    expect(existsSync(join(home, '.agents'))).toBe(false);
  });

  it('rolls back files created by a failed custom-profile write', () => {
    const { home, project } = createTree();
    mkdirSync(join(home, '.agents', 'settings.yml'), { recursive: true });
    expect(() =>
      applySetupSelection({
        homeDirectory: home,
        projectDirectory: project,
        availableAgents: [],
        selection: { setupMode: 'create', agentId: 'new-profile', harness: 'pi', target: 'home' },
      }),
    ).toThrow();
    expect(existsSync(join(home, '.agents', 'agents', 'new-profile', 'agent.md'))).toBe(false);
  });

  it('does not copy or mutate the bootstrapped default catalog when settings cannot be written', () => {
    const { catalog, home, project } = createTree();
    mkdirSync(join(home, '.agents', 'settings.yml'), { recursive: true });
    const availableAgents = discoverSetupAgentChoices({ defaultCatalogRoot: catalog });
    expect(() =>
      applySetupSelection({
        homeDirectory: home,
        projectDirectory: project,
        defaultCatalogRoot: catalog,
        availableAgents,
        selection: { setupMode: 'default', agentId: 'founder', harness: 'pi', target: 'home' },
      }),
    ).toThrow();
    expect(existsSync(join(home, '.agents', 'catalogs'))).toBe(false);
    expect(existsSync(join(catalog, 'agents', 'founder', 'agent.md'))).toBe(true);
  });

  it('normalizes setup names into schema-valid slugs', () => {
    expect(sanitizeAgentSlug('  My Profile  ')).toBe('my-profile');
    expect(sanitizeAgentSlug('foo--bar__baz')).toBe('foo-bar-baz');
    expect(sanitizeAgentSlug('!!!')).toBe('assistant');
  });
});

describe('Pi setup launch', () => {
  it('stamps an isolated model-free extension containing the original setup wording', () => {
    const { home, project, root } = createTree();
    const availableAgents = [{ id: 'founder', label: 'Founder', description: 'Founder profile.' }];
    const launch = preparePiSetupLaunch({
      homeDirectory: home,
      projectDirectory: project,
      setupDirectory: root,
      availableAgents,
    });
    expect(launch.plan.args).toEqual(
      expect.arrayContaining(['--no-session', '--offline', '--no-tools', '--extension']),
    );
    const extensionPath = launch.plan.args[launch.plan.args.indexOf('--extension') + 1];
    const extension = readFileSync(extensionPath, 'utf8');
    expect(extension).toContain('Use the default Outfitter profile catalog');
    expect(extension).toContain('Create your own profile');
    expect(extension).toContain('Provide a different catalog to import');
    expect(extension).toContain('Which CLI agent should Outfitter use by default?');
    expect(extension).not.toContain('Starter agent');
    expect(extension).not.toContain('__OUTFITTER_');
    expect(extension).not.toContain('/login');
  });

  it('stamps the current default marker and an optional provided source', () => {
    const { home, project, root } = createTree();
    write(join(home, '.agents', 'settings.yml'), 'default_agent: engineer\n');
    const launch = preparePiSetupLaunch({
      homeDirectory: home,
      projectDirectory: project,
      setupDirectory: root,
      availableAgents: [],
      setupSourceUri: 'https://example.test/catalog.git',
    });
    const extensionPath = launch.plan.args[launch.plan.args.indexOf('--extension') + 1];
    const extension = readFileSync(extensionPath, 'utf8');
    expect(extension).toContain('const OUTFITTER_CURRENT_DEFAULT = "engineer";');
    expect(extension).toContain('const OUTFITTER_SETUP_SOURCE_URI = "https://example.test/catalog.git";');
  });

  it('runs the Pi walkthrough and applies a custom-profile handoff', async () => {
    const { catalog, home, project } = createTree();
    const result = await runSetup({
      homeDirectory: home,
      projectDirectory: project,
      defaultCatalogBootstrap: () => catalog,
      interactive: true,
      launcher: (plan) => {
        writeFileSync(
          selectionPathFromPlan(plan),
          JSON.stringify({
            setupMode: 'create',
            agentId: 'walkthrough',
            agentLabel: 'Walkthrough',
            harness: 'claude',
            target: 'project',
          }),
        );
        return Promise.resolve(0);
      },
    });
    expect(result?.defaultAgent).toBe('walkthrough');
    expect(existsSync(join(project, '.agents', 'agents', 'walkthrough', 'agent.md'))).toBe(true);
  });

  it('bypasses default-catalog bootstrap for the original provided-source path', async () => {
    const { home, project } = createTree();
    let bootstrapCalls = 0;
    const result = await runSetup({
      homeDirectory: home,
      projectDirectory: project,
      setupSourceUri: 'https://example.test/catalog.git',
      defaultCatalogBootstrap: () => {
        bootstrapCalls += 1;
        throw new Error('must not bootstrap');
      },
      interactive: true,
      launcher: (plan) => {
        writeFileSync(
          selectionPathFromPlan(plan),
          JSON.stringify({
            setupMode: 'source',
            sourceUri: 'https://example.test/catalog.git',
            harness: 'pi',
            target: 'home',
          }),
        );
        return Promise.resolve(0);
      },
    });
    expect(bootstrapCalls).toBe(0);
    expect(result?.defaultAgent).toBeUndefined();
    expect(readFileSync(join(home, '.agents', 'settings.yml'), 'utf8')).toContain(
      'uri: "https://example.test/catalog.git"',
    );
  });

  it('does not launch or write outside an interactive terminal', async () => {
    const { home, project } = createTree();
    let launched = false;
    const result = await runSetup({
      homeDirectory: home,
      projectDirectory: project,
      interactive: false,
      launcher: () => {
        launched = true;
        return Promise.resolve(0);
      },
    });
    expect(result).toBeUndefined();
    expect(launched).toBe(false);
    expect(existsSync(join(home, '.agents'))).toBe(false);
  });

  it('fails before launching or writing when the pinned default catalog is unavailable', async () => {
    const { home, project } = createTree();
    let launched = false;
    await expect(
      runSetup({
        homeDirectory: home,
        projectDirectory: project,
        defaultCatalogBootstrap: () => {
          throw new Error('pinned catalog unavailable');
        },
        interactive: true,
        launcher: () => {
          launched = true;
          return Promise.resolve(0);
        },
      }),
    ).rejects.toThrow(/pinned catalog unavailable/u);
    expect(launched).toBe(false);
    expect(existsSync(join(home, '.agents'))).toBe(false);
  });

  it('returns no result on cancellation and rejects invalid or failed walkthroughs', async () => {
    const { catalog, home, project } = createTree();
    await expect(
      runSetup({
        homeDirectory: home,
        projectDirectory: project,
        defaultCatalogBootstrap: () => catalog,
        interactive: true,
        launcher: () => Promise.resolve(0),
      }),
    ).resolves.toBeUndefined();
    await expect(
      runSetup({
        homeDirectory: home,
        projectDirectory: project,
        defaultCatalogBootstrap: () => catalog,
        interactive: true,
        launcher: () => Promise.resolve(7),
      }),
    ).rejects.toThrow(/exited with code 7/);
  });

  it.each([
    null,
    {},
    { setupMode: 'unknown', harness: 'pi', target: 'home' },
    { setupMode: 'default', agentId: 'founder', harness: 'codex', target: 'home' },
    { setupMode: 'default', harness: 'pi', target: 'home' },
    { setupMode: 'catalog', ref: 'main', settingsPath: 'settings.yml', harness: 'pi', target: 'home' },
    { setupMode: 'catalog', github: 'ok/repo', settingsPath: 'settings.yml', harness: 'pi', target: 'home' },
    { setupMode: 'catalog', github: 'ok/repo', ref: 'main', harness: 'pi', target: 'home' },
    { setupMode: 'source', harness: 'pi', target: 'home' },
    { setupMode: 'source', sourceUri: 'x', harness: 'pi', target: 'machine' },
  ])('rejects an invalid Pi handoff: %j', async (handoff) => {
    const { catalog, home, project } = createTree();
    await expect(
      runSetup({
        homeDirectory: home,
        projectDirectory: project,
        defaultCatalogBootstrap: () => catalog,
        interactive: true,
        launcher: (plan) => {
          writeFileSync(selectionPathFromPlan(plan), JSON.stringify(handoff));
          return Promise.resolve(0);
        },
      }),
    ).rejects.toThrow(/invalid selection/);
  });

  it('drives the command object through the same walkthrough implementation', async () => {
    const { catalog, home, project } = createTree();
    const lines: string[] = [];
    const program = new Command();
    createSetupCommand({
      homeDirectory: home,
      projectDirectory: project,
      defaultCatalogBootstrap: () => catalog,
      interactive: true,
      launcher: (plan) => {
        writeFileSync(
          selectionPathFromPlan(plan),
          JSON.stringify({ setupMode: 'default', agentId: 'founder', harness: 'pi', target: 'home' }),
        );
        return Promise.resolve(0);
      },
      // A no-op run launcher keeps the post-setup profile launch from spawning real pi in the test.
      runLauncher: () => Promise.resolve(0),
      writeLine: (message) => lines.push(message),
    }).register(program);
    await program.parseAsync(['node', 'outfitter', 'setup']);
    expect(lines.join('\n')).toContain("Default agent 'founder'");
    expect(readFileSync(join(home, '.agents', 'settings.yml'), 'utf8')).toContain(
      `github: ${defaultCatalogSource.github}\n    ref: ${defaultCatalogSource.ref}`,
    );
    expect(existsSync(join(home, '.agents', 'catalogs'))).toBe(false);
  });

  it('auto-starts the selected profile in pi after an explicit setup', async () => {
    const { catalog, home, project } = createTree();
    const lines: string[] = [];
    const runLaunches: string[] = [];
    const program = new Command();
    createSetupCommand({
      homeDirectory: home,
      projectDirectory: project,
      defaultCatalogBootstrap: () => catalog,
      interactive: true,
      // Create a local profile so the post-setup re-resolve finds it without a catalog fetch.
      launcher: (plan) => {
        writeFileSync(
          selectionPathFromPlan(plan),
          JSON.stringify({
            setupMode: 'create',
            agentId: 'myagent',
            agentLabel: 'My Agent',
            harness: 'pi',
            target: 'home',
          }),
        );
        return Promise.resolve(0);
      },
      runLauncher: (plan) => {
        runLaunches.push(plan.command);
        return Promise.resolve(0);
      },
      writeLine: (message) => lines.push(message),
    }).register(program);
    await program.parseAsync(['node', 'outfitter', 'setup']);
    expect(lines.join('\n')).toContain("Starting 'myagent' in pi");
    expect(runLaunches).toEqual(['pi']); // setup auto-started the selected profile
  });

  it('does not auto-launch a catalog setup that still needs a sync', async () => {
    const { catalog, home, project } = createTree();
    const lines: string[] = [];
    const runLaunches: string[] = [];
    const program = new Command();
    createSetupCommand({
      homeDirectory: home,
      projectDirectory: project,
      defaultCatalogBootstrap: () => catalog,
      interactive: true,
      launcher: (plan) => {
        writeFileSync(
          selectionPathFromPlan(plan),
          JSON.stringify({
            setupMode: 'catalog',
            github: 'acme/config',
            ref: 'main',
            settingsPath: 'settings.yml',
            harness: 'pi',
            target: 'home',
          }),
        );
        return Promise.resolve(0);
      },
      runLauncher: (plan) => {
        runLaunches.push(plan.command);
        return Promise.resolve(0);
      },
      writeLine: (message) => lines.push(message),
    }).register(program);
    await program.parseAsync(['node', 'outfitter', 'setup']);
    expect(lines.join('\n')).not.toContain('Starting');
    expect(runLaunches).toEqual([]); // catalog setup reports next-launch instead of launching
  });

  it('reports a cancelled command without writing settings', async () => {
    const { catalog, home, project } = createTree();
    const lines: string[] = [];
    const program = new Command();
    createSetupCommand({
      homeDirectory: home,
      projectDirectory: project,
      defaultCatalogBootstrap: () => catalog,
      interactive: true,
      launcher: () => Promise.resolve(0),
      writeLine: (message) => lines.push(message),
    }).register(program);
    await program.parseAsync(['node', 'outfitter', 'setup']);
    expect(lines.join('\n')).toContain('made no changes');
    expect(existsSync(join(home, '.agents'))).toBe(false);
  });
});
