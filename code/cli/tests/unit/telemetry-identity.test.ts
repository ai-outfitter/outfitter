import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTelemetryService } from '../../src/telemetry/TelemetryService.js';
import type { TelemetryClient, TelemetryCommandContext } from '../../src/telemetry/TelemetryService.js';
import { readHostedTelemetryIdentity } from '../../src/telemetry/HostedIdentity.js';
import type { TelemetryIdentity } from '../../src/telemetry/HostedIdentity.js';
import type { SettingsLoadResult } from '../../src/settings/SettingsLoader.js';

const context: TelemetryCommandContext = {
  command: 'account',
  outfitterVersion: '1',
  nodeVersion: '24',
  platform: 'linux',
  architecture: 'x64',
  interactive: false,
};
const alice = {
  userId: 'github:1',
  email: 'alice@example.test',
  workspaceId: 'user:1',
  workspaceType: 'User',
} as const;
const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const fixture = (
  identityReader: () => Promise<TelemetryIdentity | undefined>,
  env = {},
  loaded: SettingsLoadResult = { files: [], issues: [] },
  isCI = false,
) => {
  const capture = vi.fn<TelemetryClient['capture']>();
  const identify = vi.fn<NonNullable<TelemetryClient['identify']>>();
  const client = { capture, identify, shutdown: vi.fn().mockResolvedValue(undefined) };
  const service = createTelemetryService({
    identityReader,
    env,
    settingsReader: () => loaded,
    ci: { isCI, vendorId: null },
    stateStore: {
      readOrCreate: () => ({ installation_id: 'anonymous', notice_shown: true }),
      recordNoticeShown: (state) => state,
      delete: vi.fn(),
    },
    writeError: vi.fn(),
    apiKey: 'test',
    clientFactory: () => client,
  });
  return { service, capture, identify };
};
const credential = {
  type: 'oauth',
  access: 'private-access',
  refresh: 'private-refresh',
  expires: Date.now() + 60000,
  origin: 'https://ai-outfitter.com',
};
const homeWith = (auth: unknown = { outfitter: credential }): string => {
  const home = mkdtempSync(join(tmpdir(), 'hosted-telemetry-'));
  roots.push(home);
  mkdirSync(join(home, '.pi', 'agent'), { recursive: true });
  writeFileSync(join(home, '.pi', 'agent', 'auth.json'), JSON.stringify(auth));
  return home;
};
const me = { user: { id: 'github:1', email: 'alice@example.test' }, workspace: { id: 'user:1', type: 'User' } };

// THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.7).
// YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
describe('authenticated analytics identity', () => {
  it('identifies stable account and email, with workspace context but no credentials', async () => {
    const { service, capture, identify } = fixture(() => Promise.resolve(alice));
    await service.captureCommandStarted(context);
    expect(identify).toHaveBeenCalledWith({ distinctId: 'github:1', properties: { email: 'alice@example.test' } });
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: 'github:1',
        properties: expect.objectContaining({
          workspace_id: 'user:1',
          workspace_type: 'User',
          $process_person_profile: true,
        }) as Record<string, unknown>,
      }),
    );
    expect(JSON.stringify(capture.mock.calls)).not.toContain('email');
    await service.shutdown();
  });
  it('isolates successive accounts, workspace changes and logout on one installation', async () => {
    const reader = vi
      .fn<() => Promise<TelemetryIdentity | undefined>>()
      .mockResolvedValueOnce(alice)
      .mockResolvedValueOnce({ ...alice, workspaceId: 'org:2', workspaceType: 'Organization' })
      .mockResolvedValueOnce({ userId: 'github:3', workspaceId: 'user:3', workspaceType: 'User' })
      .mockResolvedValueOnce(undefined);
    const { service, capture, identify } = fixture(reader);
    for (let i = 0; i < 4; i++) await service.captureCommandStarted(context);
    expect(capture.mock.calls.map(([event]) => event.distinctId)).toEqual([
      'github:1',
      'github:1',
      'github:3',
      'anonymous',
    ]);
    expect(capture.mock.calls[1][0].properties.workspace_id).toBe('org:2');
    expect(capture.mock.calls[3][0].properties.workspace_id).toBeUndefined();
    expect(capture.mock.calls[3][0].properties.$process_person_profile).toBe(false);
    expect(identify.mock.calls[2][0]).toEqual({ distinctId: 'github:3', properties: {} });
  });
  it.each([{ OUTFITTER_TELEMETRY: '0' }, { DO_NOT_TRACK: '1' }])(
    'does not read credentials or identify when opted out through %j',
    async (env) => {
      const reader = vi.fn();
      const { service, capture, identify } = fixture(reader, env);
      await service.captureCommandStarted(context);
      expect(reader).not.toHaveBeenCalled();
      expect(capture).not.toHaveBeenCalled();
      expect(identify).not.toHaveBeenCalled();
    },
  );
  it.each(['user', 'user-local', 'project', 'project-local'] as const)(
    'respects %s settings before identity access',
    async (scope) => {
      const reader = vi.fn();
      const { service } = fixture(
        reader,
        {},
        {
          files: [{ location: { scope, path: '/settings.yml' }, settings: { telemetry: { enabled: false } } }],
          issues: [],
        },
      );
      await service.captureCommandStarted(context);
      expect(reader).not.toHaveBeenCalled();
    },
  );
  it('never resolves account identity in CI', async () => {
    const reader = vi.fn();
    const { service, capture } = fixture(reader, {}, undefined, true);
    await service.captureCommandStarted(context);
    expect(reader).not.toHaveBeenCalled();
    expect(capture.mock.calls[0][0].distinctId).toBe('ci.unknown');
  });
  it('honors opt-out added after the first event', async () => {
    const env: Record<string, string> = {};
    const reader = vi.fn().mockResolvedValue(alice);
    const { service, capture } = fixture(reader, env);
    await service.captureCommandStarted(context);
    env.DO_NOT_TRACK = '1';
    await service.captureCommandStarted(context);
    expect(reader).toHaveBeenCalledOnce();
    expect(capture).toHaveBeenCalledOnce();
  });
  it('isolates identity and identify failures from the command and avoids stale identity', async () => {
    const { service, capture, identify } = fixture(
      vi.fn().mockResolvedValueOnce(alice).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(alice),
    );
    await service.captureCommandStarted(context);
    await service.captureCommandStarted(context);
    identify.mockImplementationOnce(() => {
      throw new Error('broken');
    });
    await service.captureCommandStarted(context);
    identify.mockRejectedValueOnce(new Error('async failure'));
    await service.captureCommandStarted(context);
    expect(capture.mock.calls.map(([event]) => event.distinctId)).toEqual([
      'github:1',
      'anonymous',
      'anonymous',
      'github:1',
    ]);
  });
  it('does not require identify support from a custom telemetry sink', async () => {
    const service = createTelemetryService({
      identityReader: () => Promise.resolve(alice),
      env: {},
      settingsReader: () => ({ files: [], issues: [] }),
      ci: { isCI: false, vendorId: null },
      stateStore: {
        readOrCreate: () => ({ installation_id: 'anon', notice_shown: true }),
        recordNoticeShown: (value) => value,
        delete: vi.fn(),
      },
      writeError: vi.fn(),
      apiKey: 'test',
      clientFactory: () => ({ capture: vi.fn(), shutdown: () => Promise.resolve() }),
    });
    await expect(service.captureCommandStarted(context)).resolves.toBeUndefined();
  });
});

// THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.7).
// YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
describe('bounded server identity lookup', () => {
  it('uses only an unexpired origin-bound token and validates server identity', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify(me)));
    expect(await readHostedTelemetryIdentity(homeWith(), {}, fetch)).toEqual(alice);
    expect(fetch.mock.calls[0][1]).toMatchObject({
      headers: { Authorization: 'Bearer private-access' },
      redirect: 'error',
    });
  });
  it('does not refresh or send expired, foreign, malformed or absent credentials', async () => {
    const fetch = vi.fn();
    for (const auth of [
      null,
      {},
      { outfitter: null },
      { outfitter: { ...credential, type: 'api_key' } },
      { outfitter: { ...credential, origin: 'https://evil.example' } },
      { outfitter: { ...credential, access: 4 } },
      { outfitter: { ...credential, expires: 0 } },
      { outfitter: { ...credential, expires: 'later' } },
    ])
      expect(await readHostedTelemetryIdentity(homeWith(auth), {}, fetch)).toBeUndefined();
    expect(await readHostedTelemetryIdentity('/nonexistent-outfitter-test-home', {}, fetch)).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    {},
    { user: { id: 'email@example.test' } },
    { user: { id: 'github:1' }, workspace: { id: 'bad' } },
    { user: { id: 'github:1' }, workspace: { id: 'user:1', type: 'Other' } },
  ])('rejects malformed server identity %#', async (data) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify(data)));
    expect(await readHostedTelemetryIdentity(homeWith(), {}, fetch)).toBeUndefined();
  });
  it('supports accounts without email and handles denied requests', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ user: { id: 'github:1' }, workspace: { id: 'org:2', type: 'Organization' } })),
      )
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    const home = homeWith();
    expect(await readHostedTelemetryIdentity(home, {}, fetch)).toEqual({
      userId: 'github:1',
      email: undefined,
      workspaceId: 'org:2',
      workspaceType: 'Organization',
    });
    expect(await readHostedTelemetryIdentity(home, {}, fetch)).toBeUndefined();
  });
  it('bounds even a fetch implementation that does not honor abort', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(() => new Promise(() => undefined));
    const started = performance.now();
    expect(await readHostedTelemetryIdentity(homeWith(), {}, fetch)).toBeUndefined();
    expect(performance.now() - started).toBeLessThan(1000);
  });
  it('uses the default fetch and isolates network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await readHostedTelemetryIdentity(homeWith(), {})).toBeUndefined();
  });
});
