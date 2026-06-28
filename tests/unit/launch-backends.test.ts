// Tests container launch backend selection and shell-free argv rendering.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createCompositeProfile } from '../../src/compositeProfile/CompositeProfile.js';
import { createCompositeProfileFile } from '../../src/compositeProfile/CompositeProfileFile.js';
import {
  renderAppleContainerBackend,
  renderDockerLikeBackend,
  renderHostBackend,
} from '../../src/launchBackends/ContainerRenderers.js';
import {
  envPassthroughForContainer,
  isLaunchBackendId,
  mutableImageReferenceWarning,
  selectContainerControls,
  selectRequestedLaunchBackend,
} from '../../src/launchBackends/ContainerControls.js';
import { planContainerMounts } from '../../src/launchBackends/ContainerMountPlanner.js';
import { createHostLaunchBackend } from '../../src/launchBackends/HostLaunchBackend.js';
import { createLaunchBackend, resolveConcreteBackendId } from '../../src/launchBackends/LaunchBackendRegistry.js';
import type { LaunchBackendRenderInput } from '../../src/launchBackends/LaunchBackend.js';

const createInput = (): LaunchBackendRenderInput => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-container-backend-'));
  const project = join(root, 'project');
  const composite = join(root, 'composite');
  const profile = join(root, 'profiles', 'engineering');
  const cache = join(root, 'cache');
  const state = join(root, 'state');
  const profileFile = join(profile, 'profile.yml');

  for (const directory of [project, composite, profile, cache, state]) {
    mkdirSync(directory, { recursive: true });
  }
  writeFileSync(profileFile, 'id: engineering\n');
  writeFileSync(join(state, 'settings.json'), '{}\n');

  return {
    innerLaunchPlan: { command: 'pi', args: ['--model', 'sonnet'], env: { PI_CODING_AGENT_DIR: composite } },
    container: {
      image: 'ghcr.io/ai-outfitter/outfitter-pi:0.6.1',
      backend: 'docker',
      pull: 'always',
      platform: 'linux/arm64',
      envPassthrough: ['ANTHROPIC_API_KEY'],
      runArgs: ['--init'],
    },
    compositeProfile: createCompositeProfile(
      composite,
      [
        createCompositeProfileFile({
          rootDirectory: composite,
          relativePath: 'outfitter/profile.json',
          content: '{}\n',
          sourceInputs: [profileFile],
          strategy: 'transform',
        }),
      ],
      [
        {
          relativePath: 'settings.json',
          strategy: 'symlink',
          sourcePath: join(state, 'settings.json'),
          directory: false,
        },
      ],
    ),
    profileFolders: [profile],
    projectDirectory: project,
    cacheDirectory: cache,
    statePaths: [
      {
        relativePath: 'settings.json',
        strategy: 'symlink',
        sourcePath: join(state, 'settings.json'),
        directory: false,
      },
    ],
    envPassthroughAllowed: ['ANTHROPIC_API_KEY'],
    stdinIsTty: true,
    stdoutIsTty: true,
  };
};

describe('launch backend resolver and renderers', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('resolves auto deterministically and renders Docker argv without a shell', () => {
    expect(resolveConcreteBackendId('auto', { commandExists: (command) => command === 'podman' })).toBe('podman');

    const originalApiKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'test-secret';
    const input = createInput();
    const plan = renderDockerLikeBackend('docker', input);
    if (originalApiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalApiKey;
    }

    expect(plan.launchPlan.command).toBe('docker');
    expect(plan.launchPlan.cwd).toBe(input.projectDirectory);
    expect(plan.launchPlan.args).toContain('--pull=always');
    expect(plan.launchPlan.args).toContain('--platform');
    expect(plan.launchPlan.args).toContain('linux/arm64');
    expect(plan.launchPlan.args).toContain('--init');
    expect(plan.launchPlan.args.slice(-3)).toEqual(
      ['ghcr.io/ai-outfitter/outfitter-pi:0.6.1', 'pi', '--model', 'sonnet'].slice(-3),
    );
    expect(plan.launchPlan.args).toContain(`type=bind,src=${input.projectDirectory},dst=${input.projectDirectory}`);
    expect(plan.launchPlan.args).toContain('--env');
    expect(plan.launchPlan.args).toContain('ANTHROPIC_API_KEY');
    expect(plan.launchPlan.args).not.toContain('test-secret');
    expect(plan.launchPlan.env).toMatchObject({
      ANTHROPIC_API_KEY: 'test-secret',
      PI_CODING_AGENT_DIR: input.compositeProfile.rootDirectory,
    });

    const podmanPlan = renderDockerLikeBackend('podman', {
      ...input,
      container: { ...input.container, backend: 'podman' },
    });
    expect(podmanPlan.launchPlan.command).toBe('podman');
    expect(podmanPlan.launchPlan.args).toContain(
      `type=bind,src=${input.projectDirectory},dst=${input.projectDirectory}`,
    );
    expect(podmanPlan.launchPlan.args.slice(-3)).toEqual(['pi', '--model', 'sonnet']);
    expect(podmanPlan.launchPlan.args).not.toContain('test-secret');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('plans identity mounts and warns for Apple pull policy gaps and mutable images', () => {
    const container = { image: 'example/agent:latest', pull: 'always' } satisfies LaunchBackendRenderInput['container'];
    const input = { ...createInput(), container };
    const mounts = planContainerMounts(input);
    const targets = mounts.mounts.map((mount) => mount.target);
    const missingInput = { ...input, cacheDirectory: join(input.projectDirectory, 'missing-cache') };
    const unsafeInput = { ...input, cacheDirectory: process.env.HOME ?? '/' };
    const unsafeDescendantInput = { ...input, cacheDirectory: join(process.env.HOME ?? '/', '.ssh', 'keys') };
    const writableProfileInput = {
      ...input,
      statePaths: [
        {
          relativePath: 'settings.json',
          strategy: 'symlink' as const,
          sourcePath: join(input.profileFolders[0], 'state.json'),
          directory: false,
        },
      ],
    };
    writeFileSync(join(input.profileFolders[0], 'state.json'), '{}\n');

    const stateSource = input.statePaths[0]?.sourcePath;
    expect(stateSource).toBeDefined();
    expect(targets).toContain(input.projectDirectory);
    expect(targets).toContain(input.compositeProfile.rootDirectory);
    expect(targets).toContain(dirname(stateSource ?? ''));
    expect(planContainerMounts(missingInput).warnings[0]).toContain('does not exist');
    expect(planContainerMounts(unsafeInput).warnings[0]).toContain('Refusing unsafe implicit container mount');
    expect(planContainerMounts(unsafeDescendantInput).warnings[0]).toContain(
      'Refusing unsafe implicit container mount',
    );
    expect(
      planContainerMounts({ ...input, statePaths: [{ relativePath: 'unknown', strategy: 'warn', directory: false }] })
        .warnings,
    ).toEqual([]);
    expect(
      planContainerMounts(writableProfileInput).mounts.find((mount) => mount.target === input.profileFolders[0])
        ?.readonly,
    ).toBe(false);
    rmSync(join(input.profileFolders[0], 'state.json'));

    const apple = renderAppleContainerBackend(input);
    expect(apple.launchPlan.command).toBe('container');
    expect(apple.warnings).toContain("apple-container launch backend does not support portable pull policy 'always'.");
    expect(apple.warnings.some((warning) => warning.includes('mutable'))).toBe(true);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.2, OFTR-011.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('covers backend factories, host rendering, and validation helper branches', () => {
    const input = createInput();

    expect(isLaunchBackendId('docker')).toBe(true);
    expect(isLaunchBackendId('invalid')).toBe(false);
    expect(mutableImageReferenceWarning('example/agent@sha256:abc')).toBeUndefined();
    expect(mutableImageReferenceWarning('example/agent:1.0.0')).toBeUndefined();
    expect(mutableImageReferenceWarning('example/agent')).toContain('mutable');
    expect(mutableImageReferenceWarning('agent:latest')).toContain('mutable');
    expect(mutableImageReferenceWarning(undefined)).toBeUndefined();
    expect(
      envPassthroughForContainer(['SECRET', 'MISSING', 'SECRET'], ['SECRET', 'OTHER'], { SECRET: 'value' }),
    ).toEqual(['SECRET']);
    expect(envPassthroughForContainer(undefined, undefined, {})).toEqual([]);

    const hostBackend = createLaunchBackend('host');
    expect(hostBackend.id).toBe('host');
    expect(hostBackend.render(input).launchPlan).toEqual(input.innerLaunchPlan);
    expect(createHostLaunchBackend().render(input).backendId).toBe('host');
    expect(createLaunchBackend('docker', { commandExists: (command) => command === 'docker' }).id).toBe('docker');
    expect(createLaunchBackend('podman', { commandExists: (command) => command === 'podman' }).id).toBe('podman');
    expect(createLaunchBackend('apple-container', { commandExists: (command) => command === 'container' }).id).toBe(
      'apple-container',
    );
    expect(resolveConcreteBackendId('auto', { commandExists: (command) => command === 'docker' })).toBe('docker');
    expect(
      resolveConcreteBackendId('auto', { platform: 'darwin', commandExists: (command) => command === 'container' }),
    ).toBe('apple-container');
    expect(() =>
      resolveConcreteBackendId('auto', { platform: 'linux', commandExists: (command) => command === 'container' }),
    ).toThrow('No container launch backend');
    expect(() => createLaunchBackend('docker', { commandExists: () => false })).toThrow("requires executable 'docker'");
    expect(() => resolveConcreteBackendId('auto', { commandExists: () => false })).toThrow(
      'No container launch backend',
    );

    expect(renderHostBackend(input).warnings).toEqual([
      "host launch backend ignores configured container image 'ghcr.io/ai-outfitter/outfitter-pi:0.6.1'.",
    ]);
    expect(renderHostBackend({ ...input, container: {} }).warnings).toEqual([]);
    expect(() => renderDockerLikeBackend('podman', { ...input, container: {} })).toThrow(
      "Launch backend 'podman' requires controls.container.image.",
    );
    expect(
      renderAppleContainerBackend({ ...input, stdoutIsTty: false, container: { image: 'example/agent:1.0.0' } })
        .launchPlan.args,
    ).not.toContain('--tty');
    expect(renderAppleContainerBackend({ ...input, container: { image: 'example/agent:1.0.0' } }).warnings).toEqual([]);

    expect(
      selectRequestedLaunchBackend(
        'podman',
        { backend: 'docker', image: 'example:1' },
        { defaultLaunchBackend: 'host' },
      ),
    ).toBe('podman');
    expect(
      selectRequestedLaunchBackend(
        undefined,
        { backend: 'docker', image: 'example:1' },
        { defaultLaunchBackend: 'host' },
      ),
    ).toBe('docker');
    expect(selectRequestedLaunchBackend(undefined, { image: 'example:1' }, { defaultLaunchBackend: 'host' })).toBe(
      'host',
    );
    expect(selectRequestedLaunchBackend(undefined, { image: 'example:1' }, {})).toBe('auto');
    expect(selectRequestedLaunchBackend(undefined, {}, {})).toBe('host');

    expect(selectContainerControls({ id: 'p', inherits: [], controls: {} }, 'unknown')).toEqual({});
    expect(
      selectContainerControls({ id: 'p', inherits: [], controls: { container: { image: 'generic' } } }, 'unknown'),
    ).toEqual({
      image: 'generic',
    });
    expect(
      selectContainerControls(
        {
          id: 'p',
          inherits: [],
          controls: { container: { image: 'generic' }, pi: { container: { backend: 'docker' } } },
        },
        'pi',
      ),
    ).toEqual({ image: 'generic', backend: 'docker' });
    expect(
      selectContainerControls(
        { id: 'p', inherits: [], controls: { claude: { container: { backend: 'podman' } } } },
        'claude',
      ),
    ).toEqual({ backend: 'podman' });
  });
});
