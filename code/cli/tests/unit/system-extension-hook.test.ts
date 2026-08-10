// Tests system-scope hook discovery, schema validation, and fail-closed file loading.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { executeRunAgentCommand } from '../../src/cli/commands/RunAgentCommand.js';
import type { AgentLaunchPlan } from '../../src/projection/Projection.js';
import {
  attachSystemExtensionHooks,
  readSystemExtensionHooks,
  resolveSystemExtensionHookSource,
} from '../../src/system/SystemExtensionHook.js';
import { validateSchema } from '../../src/validation/SchemaValidator.js';

const temporaryRoots: string[] = [];

const temporaryRoot = (): string => {
  // Resolved, because the loader resolves too. On macOS `/var` is a symlink to
  // `/private/var`, so an unresolved temp path would never equal what the loader
  // returns and these tests would only pass on Linux.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'outfitter-system-hook-')));
  temporaryRoots.push(root);
  return root;
};

const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const agentTree = (): { readonly home: string; readonly project: string } => {
  const root = temporaryRoot();
  const home = join(root, 'home');
  const project = join(root, 'project');
  write(
    join(project, '.agents', 'agents', 'engineer', 'agent.md'),
    '---\nname: engineer\nextensions: []\n---\n\n# Engineer\n',
  );
  return { home, project };
};

describe('system extension hook discovery', () => {
  it('prefers OUTFITTER_SYSTEM_DIR and stamps it as an environment override', () => {
    expect(
      resolveSystemExtensionHookSource({ environment: { OUTFITTER_SYSTEM_DIR: '/tmp/hooks' }, platform: 'linux' }),
    ).toEqual({ directory: '/tmp/hooks', stamp: 'env-override:/tmp/hooks' });
  });

  it('uses the operating-system location when there is no override', () => {
    expect(resolveSystemExtensionHookSource({ environment: {}, platform: 'linux' })).toEqual({
      directory: '/etc/outfitter/system.d',
      stamp: '/etc/outfitter/system.d',
    });
    expect(resolveSystemExtensionHookSource({ environment: {}, platform: 'darwin' })).toEqual({
      directory: '/Library/Application Support/Outfitter/system.d',
      stamp: '/Library/Application Support/Outfitter/system.d',
    });
    expect(resolveSystemExtensionHookSource({ environment: {}, platform: 'win32' })).toBeUndefined();
  });
});

describe('system extension hook documentation', () => {
  it('documents only launcher bypasses that avoid the explicit Pi extension arguments', () => {
    const documentation = readFileSync(new URL('../../../../docs/documentation/hooks.md', import.meta.url), 'utf8');

    expect(documentation).toContain(
      'The `--no-extensions` option does not disable explicitly passed `--extension` paths',
    );
    expect(documentation).not.toContain('can still pass `pi --no-extensions`');
    expect(documentation).toContain("execute Outfitter's bundled Pi binary directly");
    expect(documentation).toContain('set `OUTFITTER_SYSTEM_DIR` to an empty directory');
  });
});

describe('readSystemExtensionHooks', () => {
  it('treats an absent hook directory and an unsupported platform as empty', () => {
    const directory = join(temporaryRoot(), 'absent');
    expect(readSystemExtensionHooks({ environment: { OUTFITTER_SYSTEM_DIR: directory } })).toEqual({
      hooks: [],
      source: { directory, stamp: `env-override:${directory}` },
    });
    expect(readSystemExtensionHooks({ environment: {}, platform: 'win32' })).toEqual({ hooks: [] });
  });

  it('loads every yml document additively in lexical order', () => {
    const directory = temporaryRoot();
    const extensionA = join(directory, 'extension-a');
    const extensionB = join(directory, 'extension-b');
    mkdirSync(extensionA);
    mkdirSync(extensionB);
    write(
      join(directory, '20-second.yml'),
      `name: second\nharnesses:\n  pi:\n    extensions: [${extensionB}]\n    env:\n      SECOND: two\n`,
    );
    write(
      join(directory, '10-first.yml'),
      `name: first\nharnesses:\n  pi:\n    extensions: [${extensionA}]\n    env:\n      FIRST: one\n`,
    );
    write(join(directory, 'ignored.yaml'), 'not: read\n');

    const loaded = readSystemExtensionHooks({ environment: { OUTFITTER_SYSTEM_DIR: directory } });

    expect(loaded.hooks.map((hook) => hook.name)).toEqual(['first', 'second']);
    expect(loaded.hooks.map((hook) => hook.harnesses.pi?.extensions?.[0])).toEqual([extensionA, extensionB]);
  });

  it('resolves source, hook document, and extension symlinks to physical paths', () => {
    const root = temporaryRoot();
    const physicalDirectory = join(root, 'physical-system');
    const sourceLink = join(root, 'system-link');
    const physicalDocument = join(root, 'physical-hook.yml');
    const physicalExtension = join(root, 'physical-extension');
    mkdirSync(physicalDirectory);
    mkdirSync(physicalExtension);
    write(
      physicalDocument,
      `name: linked\nharnesses:\n  pi:\n    extensions: [${join(physicalDirectory, 'extension-link')}]\n`,
    );
    symlinkSync(physicalDocument, join(physicalDirectory, 'linked.yml'));
    symlinkSync(physicalExtension, join(physicalDirectory, 'extension-link'));
    symlinkSync(physicalDirectory, sourceLink);

    const loaded = readSystemExtensionHooks({ environment: { OUTFITTER_SYSTEM_DIR: sourceLink } });

    expect(loaded.source).toEqual({
      directory: physicalDirectory,
      stamp: `env-override:${physicalDirectory}`,
    });
    expect(loaded.hooks[0]?.filePath).toBe(physicalDocument);
    expect(loaded.hooks[0]?.harnesses.pi?.extensions).toEqual([physicalExtension]);
  });

  it('fails closed for dangling source, hook document, and extension symlinks', () => {
    const sourceRoot = temporaryRoot();
    const danglingSource = join(sourceRoot, 'dangling-source');
    symlinkSync(join(sourceRoot, 'missing-source'), danglingSource);
    expect(() => readSystemExtensionHooks({ environment: { OUTFITTER_SYSTEM_DIR: danglingSource } })).toThrow(
      /source .*cannot be resolved/u,
    );

    const documentDirectory = temporaryRoot();
    symlinkSync(join(documentDirectory, 'missing-hook'), join(documentDirectory, 'dangling.yml'));
    expect(() => readSystemExtensionHooks({ environment: { OUTFITTER_SYSTEM_DIR: documentDirectory } })).toThrow(
      /hook .*cannot be resolved/u,
    );

    const extensionDirectory = temporaryRoot();
    const danglingExtension = join(extensionDirectory, 'dangling-extension');
    symlinkSync(join(extensionDirectory, 'missing-extension'), danglingExtension);
    write(
      join(extensionDirectory, 'dangling.yml'),
      `name: dangling\nharnesses:\n  pi:\n    extensions: [${danglingExtension}]\n`,
    );
    expect(() => readSystemExtensionHooks({ environment: { OUTFITTER_SYSTEM_DIR: extensionDirectory } })).toThrow(
      /extension path cannot be resolved/u,
    );
  });

  it('fails closed for malformed YAML and schema-invalid documents', () => {
    const malformedDirectory = temporaryRoot();
    write(join(malformedDirectory, 'bad.yml'), 'name: [unterminated\n');
    expect(() => readSystemExtensionHooks({ environment: { OUTFITTER_SYSTEM_DIR: malformedDirectory } })).toThrow(
      /Invalid system extension hook.*YAMLParseError/u,
    );

    const invalidDirectory = temporaryRoot();
    write(join(invalidDirectory, 'bad.yml'), 'name: redirector\nagent: engineer\nharnesses:\n  pi: {}\n');
    expect(() => readSystemExtensionHooks({ environment: { OUTFITTER_SYSTEM_DIR: invalidDirectory } })).toThrow(
      /additional properties/u,
    );
  });

  it('rejects network specifiers and extension paths that do not exist', () => {
    const networkDirectory = temporaryRoot();
    write(join(networkDirectory, 'network.yml'), 'name: network\nharnesses:\n  pi:\n    extensions: [npm:observer]\n');
    expect(() => readSystemExtensionHooks({ environment: { OUTFITTER_SYSTEM_DIR: networkDirectory } })).toThrow(
      /pattern/u,
    );

    const missingDirectory = temporaryRoot();
    write(
      join(missingDirectory, 'missing.yml'),
      'name: missing\nharnesses:\n  pi:\n    extensions: [/definitely/not/an/outfitter-extension]\n',
    );
    expect(() => readSystemExtensionHooks({ environment: { OUTFITTER_SYSTEM_DIR: missingDirectory } })).toThrow(
      /extension path does not exist/u,
    );
  });

  it('fails closed when the source or a hook document is unreadable', () => {
    const fileSource = join(temporaryRoot(), 'not-a-directory');
    write(fileSource, 'content');
    expect(() => readSystemExtensionHooks({ environment: { OUTFITTER_SYSTEM_DIR: fileSource } })).toThrow(
      /is not a directory/u,
    );

    const directory = temporaryRoot();
    mkdirSync(join(directory, 'directory.yml'));
    expect(() => readSystemExtensionHooks({ environment: { OUTFITTER_SYSTEM_DIR: directory } })).toThrow(
      /is unreadable/u,
    );
  });

  it('rejects environment collisions instead of assigning file precedence', () => {
    const directory = temporaryRoot();
    write(join(directory, 'a.yml'), 'name: a\nharnesses:\n  pi:\n    env:\n      SINK: a\n');
    write(join(directory, 'b.yml'), 'name: b\nharnesses:\n  pi:\n    env:\n      SINK: b\n');

    expect(() => readSystemExtensionHooks({ environment: { OUTFITTER_SYSTEM_DIR: directory } })).toThrow(
      /environment 'SINK'.*declared by both/u,
    );
  });

  it.each(['PI_CODING_AGENT_DIR', 'PI_CODING_AGENT_SESSION_DIR'])(
    'rejects protected Pi runtime variable %s at load time',
    (name) => {
      const directory = temporaryRoot();
      write(join(directory, 'protected.yml'), `name: protected\nharnesses:\n  pi:\n    env:\n      ${name}: /tmp\n`);

      expect(() => readSystemExtensionHooks({ environment: { OUTFITTER_SYSTEM_DIR: directory } })).toThrow(
        `environment variable '${name}' is reserved by Outfitter`,
      );
    },
  );

  it.each([
    'NODE_OPTIONS',
    'NODE_REPL_EXTERNAL_MODULE',
    'LD_PRELOAD',
    'LD_AUDIT',
    'LD_LIBRARY_PATH',
    'DYLD_INSERT_LIBRARIES',
    'OPENSSL_CONF',
  ])('rejects process-loader and runtime-control variable %s at load time', (name) => {
    const directory = temporaryRoot();
    write(join(directory, 'loader.yml'), `name: loader\nharnesses:\n  pi:\n    env:\n      ${name}: exploit\n`);

    expect(() => readSystemExtensionHooks({ environment: { OUTFITTER_SYSTEM_DIR: directory } })).toThrow(
      `environment variable '${name}' controls process loading and is forbidden`,
    );
  });

  // A name containing '=' would slip past the denylist and still reach the child
  // as a real variable: Node serializes each entry as `name=value`, and the child
  // splits on the FIRST '=', so `NODE_OPTIONS=--import=...` becomes NODE_OPTIONS.
  // Verified against a real spawn before this guard was added.
  it.each(['NODE_OPTIONS=--import=data:text/javascript,0', 'A B', 'NUL\u0000NAME', '1LEADING_DIGIT'])(
    'rejects the non-identifier environment name %j',
    (name) => {
      const directory = temporaryRoot();
      write(
        join(directory, 'smuggled.yml'),
        `name: smuggled\nharnesses:\n  pi:\n    env:\n      ${JSON.stringify(name)}: value\n`,
      );

      expect(() => readSystemExtensionHooks({ environment: { OUTFITTER_SYSTEM_DIR: directory } })).toThrow();
    },
  );

  it('registers the persisted document with the shared schema validator', () => {
    expect(
      validateSchema('system-extension-hook', {
        name: 'pensieve',
        harnesses: { claude: { env: { PENSIEVE_INSTALL_SCOPE: 'launcher' } } },
      }),
    ).toEqual({ valid: true, issues: [] });
  });
});

describe('attachSystemExtensionHooks', () => {
  it('prepends Pi extensions in file order and layers hook env beneath the launch plan', () => {
    const plan: AgentLaunchPlan = {
      command: 'pi',
      args: ['--mode', 'rpc'],
      env: {
        PI_CODING_AGENT_DIR: '/projection',
        PI_CODING_AGENT_SESSION_DIR: '/sessions',
        SHARED: 'plan',
      },
    };
    const result = attachSystemExtensionHooks(plan, {
      source: { directory: '/system', stamp: '/system' },
      hooks: [
        {
          filePath: '/system/10-a.yml',
          name: 'a',
          harnesses: {
            pi: {
              extensions: ['/extensions/a'],
              env: { FIRST: '1', SHARED: 'hook' },
            },
          },
        },
        {
          filePath: '/system/20-b.yml',
          name: 'b',
          harnesses: {
            pi: {
              extensions: ['/extensions/b'],
              env: { SECOND: '2' },
            },
          },
        },
      ],
    });

    expect(result.launch.args).toEqual([
      '--extension',
      '/extensions/a',
      '--extension',
      '/extensions/b',
      '--mode',
      'rpc',
    ]);
    expect(result.launch.env).toEqual({
      FIRST: '1',
      SECOND: '2',
      OUTFITTER_SYSTEM_HOOK_SOURCE: '/system',
      PI_CODING_AGENT_DIR: '/projection',
      PI_CODING_AGENT_SESSION_DIR: '/sessions',
      SHARED: 'plan',
    });
  });

  it('leaves unsupported platforms unchanged and warns for non-Pi hook sections', () => {
    const plan: AgentLaunchPlan = { command: 'claude', args: ['--model', 'x'], env: {} };
    expect(attachSystemExtensionHooks(plan, { hooks: [] })).toEqual({ launch: plan, warnings: [] });

    const attached = attachSystemExtensionHooks(plan, {
      source: { directory: '/system', stamp: 'env-override:/system' },
      hooks: [
        {
          filePath: '/system/observer.yml',
          name: 'observer',
          harnesses: { claude: {}, codex: {} },
        },
      ],
    });
    expect(attached.launch.args).toEqual(plan.args);
    expect(attached.warnings).toEqual([
      "warning: System extension hook 'observer' configures unsupported harness 'claude'; ignoring it.",
      "warning: System extension hook 'observer' configures unsupported harness 'codex'; ignoring it.",
    ]);
  });
});

describe('run agent with system extension hooks', () => {
  it('attaches the system extension to a Pi RPC launch', async () => {
    const { home, project } = agentTree();
    const systemDirectory = temporaryRoot();
    const extensionDirectory = join(systemDirectory, 'observer');
    mkdirSync(extensionDirectory);
    write(
      join(systemDirectory, 'observer.yml'),
      `name: observer\nharnesses:\n  pi:\n    extensions: [${extensionDirectory}]\n`,
    );
    vi.stubEnv('OUTFITTER_SYSTEM_DIR', systemDirectory);
    let launch: AgentLaunchPlan | undefined;

    const result = await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'engineer',
      passThroughArgs: ['--mode', 'rpc'],
      launcher: (plan) => {
        launch = plan;
        return Promise.resolve(0);
      },
    });

    expect(result.exitCode).toBe(0);
    expect(launch?.args.slice(0, 4)).toEqual([
      '--extension',
      extensionDirectory,
      '--system-prompt',
      expect.any(String),
    ]);
    expect(launch?.args).toEqual(expect.arrayContaining(['--mode', 'rpc']));
    expect(launch?.args.some((arg) => arg.endsWith('outfitter-runtime-extension.js'))).toBe(false);
    expect(launch?.env.OUTFITTER_SYSTEM_HOOK_SOURCE).toBe(`env-override:${systemDirectory}`);
  });

  it('does not make a valid system hook fatal under strict mode', async () => {
    const { home, project } = agentTree();
    const systemDirectory = temporaryRoot();
    const extensionDirectory = join(systemDirectory, 'observer');
    mkdirSync(extensionDirectory);
    write(
      join(systemDirectory, 'observer.yml'),
      [
        'name: observer',
        'harnesses:',
        '  pi:',
        `    extensions: [${extensionDirectory}]`,
        '    env:',
        '      OBSERVER_SINK: https://observer.example.test',
        '',
      ].join('\n'),
    );
    vi.stubEnv('OUTFITTER_SYSTEM_DIR', systemDirectory);

    const result = await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'engineer',
      strict: true,
      launcher: (plan) => {
        expect(plan.env.OBSERVER_SINK).toBe('https://observer.example.test');
        return Promise.resolve(0);
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.messages).toEqual([]);
  });

  it('warns and does not change argv when a Claude system hook is present', async () => {
    const { home, project } = agentTree();
    const systemDirectory = temporaryRoot();
    const extensionDirectory = join(systemDirectory, 'observer');
    mkdirSync(extensionDirectory);
    write(
      join(systemDirectory, 'observer.yml'),
      `name: observer\nharnesses:\n  claude:\n    extensions: [${extensionDirectory}]\n`,
    );
    vi.stubEnv('OUTFITTER_SYSTEM_DIR', systemDirectory);
    let launch: AgentLaunchPlan | undefined;

    const result = await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'engineer',
      harness: 'claude',
      launcher: (plan) => {
        launch = plan;
        return Promise.resolve(0);
      },
    });

    expect(result.exitCode).toBe(0);
    expect(launch?.args).not.toContain('--extension');
    expect(result.messages).toEqual([
      "warning: System extension hook 'observer' configures unsupported harness 'claude'; ignoring it.",
    ]);
  });
});
