// Tests the local-path extension specifier grammar, declaring-layer provenance in composition,
// and the run-boundary resolution that merges local paths with the cached remote extension flow.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  extensionSpecifierDefect,
  isLocalExtensionSpecifier,
  resolveLocalExtensionPath,
  resolvePiExtensionLoadout,
} from '../../src/extensions/PiLocalExtensions.js';
import { compose } from '../../src/composer/Composer.js';
import { extensionsShapeDefect } from '../../src/resolver/AgentDefinition.js';
import { discoverLayers } from '../../src/resolver/Layer.js';
import { resolveResources } from '../../src/resolver/Resolver.js';
import { discoverSettingsLoadPlan, loadSettings } from '../../src/settings/SettingsLoader.js';
import { validateSchema } from '../../src/validation/SchemaValidator.js';

const roots: string[] = [];
const temporaryDir = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

const resolveSet = (home: string, project: string) =>
  resolveResources(discoverLayers({ homeDirectory: home, projectDirectory: project, settings: {} }).layers);

describe('extension specifier grammar', () => {
  it('classifies the four local path forms and not remote or bare forms', () => {
    expect(isLocalExtensionSpecifier('./helper')).toBe(true);
    expect(isLocalExtensionSpecifier('../helper')).toBe(true);
    expect(isLocalExtensionSpecifier('~/helper')).toBe(true);
    expect(isLocalExtensionSpecifier('/opt/helper')).toBe(true);
    expect(isLocalExtensionSpecifier('npm:pkg')).toBe(false);
    expect(isLocalExtensionSpecifier('git:github.com/o/r')).toBe(false);
    expect(isLocalExtensionSpecifier('helper')).toBe(false);
    expect(isLocalExtensionSpecifier('~helper')).toBe(false);
  });

  it('accepts every grammar form and rejects bare names, bare prefixes, and ~user forms', () => {
    expect(extensionSpecifierDefect('./helper')).toBeUndefined();
    expect(extensionSpecifierDefect('../helper')).toBeUndefined();
    expect(extensionSpecifierDefect('~/helper')).toBeUndefined();
    expect(extensionSpecifierDefect('/opt/helper')).toBeUndefined();
    expect(extensionSpecifierDefect('npm:pkg')).toBeUndefined();
    expect(extensionSpecifierDefect('git:github.com/o/r')).toBeUndefined();
    expect(extensionSpecifierDefect('helper')).toBeDefined();
    expect(extensionSpecifierDefect('npm:')).toBeDefined();
    expect(extensionSpecifierDefect('git:')).toBeDefined();
    expect(extensionSpecifierDefect('~')).toBeDefined();
    expect(extensionSpecifierDefect('~other/helper')).toBeDefined();
  });

  it('rejects a bare extension name in agent.md frontmatter at the schema boundary', () => {
    const validation = validateSchema('agent', {
      name: 'alpha',
      extensions: ['helper'],
    });
    expect(validation.valid).toBe(false);
  });

  it('accepts local path forms in agent.md frontmatter at the schema boundary', () => {
    const validation = validateSchema('agent', {
      name: 'alpha',
      extensions: ['./extensions/helper', '~/exts/a', '/opt/exts/b'],
    });
    expect(validation.valid).toBe(true);
  });
});

describe('resolveLocalExtensionPath', () => {
  it('resolves a relative specifier against the declaring root and canonicalizes it', () => {
    const root = temporaryDir('outfitter-local-ext-');
    const layerRoot = join(root, 'layers', 'workspace', '.agents');
    write(join(layerRoot, 'exts', 'helper', 'index.ts'), 'export default () => {};');
    const resolved = resolveLocalExtensionPath('./exts/helper', layerRoot, join(root, 'home'));
    expect(resolved).toEqual({ resolvedPath: join(layerRoot, 'exts', 'helper') });
  });

  it('resolves a parent-relative specifier against the declaring root', () => {
    const root = temporaryDir('outfitter-local-ext-');
    const layerRoot = join(root, 'layers', 'workspace', '.agents');
    write(join(root, 'layers', 'workspace', 'shared', 'ext', 'index.ts'), 'export default () => {};');
    const resolved = resolveLocalExtensionPath('../shared/ext', layerRoot, join(root, 'home'));
    expect(resolved).toEqual({ resolvedPath: join(root, 'layers', 'workspace', 'shared', 'ext') });
  });

  it('expands a home specifier against the run home, never the declaring root', () => {
    const root = temporaryDir('outfitter-local-ext-');
    const home = join(root, 'home');
    write(join(home, 'exts', 'helper', 'index.ts'), 'export default () => {};');
    const resolved = resolveLocalExtensionPath('~/exts/helper', join(root, 'layers', '.agents'), home);
    expect(resolved).toEqual({ resolvedPath: join(home, 'exts', 'helper') });
  });

  it('passes an absolute specifier through unchanged', () => {
    const root = temporaryDir('outfitter-local-ext-');
    const absolute = join(root, 'opt', 'exts', 'helper');
    write(join(absolute, 'index.ts'), 'export default () => {};');
    const resolved = resolveLocalExtensionPath(absolute, join(root, 'layers', '.agents'), join(root, 'home'));
    expect(resolved).toEqual({ resolvedPath: absolute });
  });

  it('warns when the resolved target does not exist', () => {
    const root = temporaryDir('outfitter-local-ext-');
    const layerRoot = join(root, 'layers', '.agents');
    const resolved = resolveLocalExtensionPath('./exts/gone', layerRoot, join(root, 'home'));
    expect('warning' in resolved && resolved.warning).toContain('./exts/gone');
    expect('warning' in resolved && resolved.warning).toContain(join(layerRoot, 'exts', 'gone'));
  });

  it('warns when a relative specifier has no declaring root to resolve against', () => {
    const resolved = resolveLocalExtensionPath('./exts/helper', undefined, '/home/user');
    expect('warning' in resolved && resolved.warning).toContain('./exts/helper');
  });
});

describe('resolvePiExtensionLoadout', () => {
  const remoteResult = (loadDir: string) => ({
    loadDirs: [loadDir],
    settingsEntries: { [loadDir]: [join(loadDir, 'index.ts')] },
    warnings: [],
  });

  it('serves local paths without delegating them to the remote cache flow', async () => {
    const root = temporaryDir('outfitter-local-ext-');
    const layerRoot = join(root, '.agents');
    write(join(layerRoot, 'exts', 'helper', 'index.ts'), 'export default () => {};');

    const remoteSpecifiers: string[] = [];
    const result = await resolvePiExtensionLoadout([{ specifier: './exts/helper', declaringRoot: layerRoot }], {
      homeDirectory: join(root, 'home'),
      ensureRemote: (specifiers) => {
        remoteSpecifiers.push(...specifiers);
        return Promise.resolve({ loadDirs: [], settingsEntries: {}, warnings: [] });
      },
    });

    expect(remoteSpecifiers).toEqual([]);
    expect(result.loadDirs).toEqual([join(layerRoot, 'exts', 'helper')]);
    expect(result.settingsEntries).toEqual({
      [join(layerRoot, 'exts', 'helper')]: [join(layerRoot, 'exts', 'helper')],
    });
    expect(result.warnings).toEqual([]);
  });

  it('skips a missing local target with a warning and still serves the remaining extensions', async () => {
    const root = temporaryDir('outfitter-local-ext-');
    const layerRoot = join(root, '.agents');
    write(join(layerRoot, 'exts', 'present', 'index.ts'), 'export default () => {};');

    const result = await resolvePiExtensionLoadout(
      [
        { specifier: './exts/gone', declaringRoot: layerRoot },
        { specifier: './exts/present', declaringRoot: layerRoot },
      ],
      {
        homeDirectory: join(root, 'home'),
        ensureRemote: () => Promise.resolve({ loadDirs: [], settingsEntries: {}, warnings: [] }),
      },
    );

    expect(result.loadDirs).toEqual([join(layerRoot, 'exts', 'present')]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('./exts/gone');
  });

  it('preserves declared loadout order across mixed local and remote specifiers', async () => {
    const root = temporaryDir('outfitter-local-ext-');
    const layerRoot = join(root, '.agents');
    write(join(layerRoot, 'exts', 'helper', 'index.ts'), 'export default () => {};');
    const cacheDir = join(root, 'cache', 'npm', 'node_modules', 'pkg');

    const result = await resolvePiExtensionLoadout(
      [
        { specifier: 'npm:pkg' },
        { specifier: './exts/helper', declaringRoot: layerRoot },
        { specifier: 'git:github.com/o/r' },
      ],
      {
        homeDirectory: join(root, 'home'),
        ensureRemote: (specifiers) =>
          Promise.resolve(
            specifiers[0] === 'npm:pkg' ? remoteResult(cacheDir) : remoteResult(join(root, 'cache', 'git', 'o', 'r')),
          ),
      },
    );

    expect(result.loadDirs).toEqual([
      cacheDir,
      join(layerRoot, 'exts', 'helper'),
      join(root, 'cache', 'git', 'o', 'r'),
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('delegates each unique remote specifier once and dedupes shared install dirs to the first occurrence', async () => {
    const root = temporaryDir('outfitter-local-ext-');
    const cacheDir = join(root, 'cache', 'npm', 'node_modules', 'pkg');
    const delegated: string[][] = [];

    const result = await resolvePiExtensionLoadout(
      [{ specifier: 'npm:pkg' }, { specifier: 'npm:pkg@1.0.0' }, { specifier: 'npm:pkg' }],
      {
        homeDirectory: join(root, 'home'),
        ensureRemote: (specifiers) => {
          delegated.push([...specifiers]);
          return Promise.resolve(remoteResult(cacheDir));
        },
      },
    );

    expect(delegated).toEqual([['npm:pkg'], ['npm:pkg@1.0.0']]);
    expect(result.loadDirs).toEqual([cacheDir]);
    expect(result.warnings).toEqual([]);
  });

  it('propagates remote warnings after local warnings in declaration order', async () => {
    const root = temporaryDir('outfitter-local-ext-');
    const result = await resolvePiExtensionLoadout(
      [{ specifier: './gone', declaringRoot: join(root, '.agents') }, { specifier: 'npm:pkg' }],
      {
        homeDirectory: join(root, 'home'),
        ensureRemote: () =>
          Promise.resolve({ loadDirs: [], settingsEntries: {}, warnings: ["extension 'npm:pkg' failed to install."] }),
      },
    );

    expect(result.warnings).toEqual([expect.stringContaining('./gone'), "extension 'npm:pkg' failed to install."]);
  });
});

describe('extension declaration provenance in composition', () => {
  it('binds a config.json override to the overlay layer root, not the winning frontmatter layer', () => {
    const root = temporaryDir('outfitter-prov-');
    const home = join(root, 'home');
    const project = join(root, 'project');
    write(join(home, '.agents', 'agents', 'alpha', 'agent.md'), '---\nname: alpha\n---\n\nHome alpha.\n');
    write(
      join(project, '.agents', 'agents', 'alpha', 'agent.md'),
      '---\nname: alpha\nextensions: ["./exts/front"]\n---\n\nProject alpha.\n',
    );
    write(join(home, '.agents', 'agents', 'alpha', 'config.json'), JSON.stringify({ extensions: ['./exts/overlay'] }));

    const result = compose(resolveSet(home, project), 'alpha');

    expect(result.errors).toEqual([]);
    // The home-layer config.json overrides the winning frontmatter's extensions wholesale, so the
    // surviving specifier resolves against the overlay's layer, never the agent.md's layer.
    expect(result.plan?.loadout.extensionDeclarations).toEqual([
      { specifier: './exts/overlay', declaringRoot: join(home, '.agents') },
    ]);
  });

  it('keeps settings-layer defaults without a declaring root ahead of the chain', () => {
    const root = temporaryDir('outfitter-prov-');
    const home = join(root, 'home');
    const project = join(root, 'project');
    write(join(project, '.agents', 'settings.yml'), 'agent_defaults:\n  extensions: [npm:shared]\n');
    write(
      join(project, '.agents', 'agents', 'alpha', 'agent.md'),
      '---\nname: alpha\nextensions: ["./exts/own"]\n---\n\nAlpha.\n',
    );

    const loaded = loadSettings(discoverSettingsLoadPlan({ homeDirectory: home, projectDirectory: project }));
    const result = compose(resolveSet(home, project), 'alpha', { agentDefaults: loaded.settings.agentDefaults });

    expect(loaded.issues).toEqual([]);
    expect(result.plan?.loadout.extensionDeclarations).toEqual([
      { specifier: 'npm:shared' },
      { specifier: './exts/own', declaringRoot: join(project, '.agents') },
    ]);
    expect(result.plan?.loadout.extensions).toEqual(['npm:shared', './exts/own']);
  });

  it('collapses a duplicate specifier to its first occurrence with that occurrence root', () => {
    const root = temporaryDir('outfitter-prov-');
    const home = join(root, 'home');
    const project = join(root, 'project');
    write(
      join(project, '.agents', 'agents', 'parent', 'agent.md'),
      '---\nname: parent\nextensions: ["./exts/shared", "npm:p"]\n---\n\nParent.\n',
    );
    write(
      join(home, '.agents', 'agents', 'child', 'agent.md'),
      '---\nname: child\ninherits: parent\nextensions: ["./exts/shared", "npm:c"]\n---\n\nChild.\n',
    );

    const result = compose(resolveSet(home, project), 'child');

    expect(result.plan?.loadout.extensionDeclarations).toEqual([
      { specifier: './exts/shared', declaringRoot: join(project, '.agents') },
      { specifier: 'npm:p', declaringRoot: join(project, '.agents') },
      { specifier: 'npm:c', declaringRoot: join(home, '.agents') },
    ]);
  });
});

describe('config.json extension grammar boundary', () => {
  it('rejects a bare extension name supplied by a config.json overlay', () => {
    const root = temporaryDir('outfitter-cfg-');
    const home = join(root, 'home');
    const project = join(root, 'project');
    write(join(project, '.agents', 'agents', 'alpha', 'agent.md'), '---\nname: alpha\n---\n\nAlpha.\n');
    write(join(project, '.agents', 'agents', 'alpha', 'config.json'), JSON.stringify({ extensions: ['helper'] }));

    const result = compose(resolveSet(home, project), 'alpha');

    expect(result.plan).toBeUndefined();
    expect(result.errors[0]).toContain('helper');
  });

  it('rejects a non-array extensions value at the config.json read boundary', () => {
    expect(extensionsShapeDefect('helper')).toContain('must be an array of extension specifiers');
  });

  it('rejects a non-string entry at the config.json read boundary', () => {
    expect(extensionsShapeDefect([42])).toContain('must be a specifier string');
  });

  it('accepts an absent extensions value', () => {
    expect(extensionsShapeDefect(undefined)).toBeUndefined();
  });
});
