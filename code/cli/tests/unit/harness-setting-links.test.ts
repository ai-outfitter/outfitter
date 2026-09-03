import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { applyHarnessLinks, removeHarnessLinks } from '../../src/links/HarnessLinkApply.js';
import type { HarnessCommandRunner } from '../../src/links/HarnessLinkApply.js';
import { planHarnessLinks } from '../../src/links/HarnessLinkPlan.js';
import type { HarnessLinkPlan, LinkClosure, LinkEntry } from '../../src/links/HarnessLinkPlan.js';
import type { LinkHarness } from '../../src/links/HarnessHome.js';
import type { SettingsValue } from '../../src/settings/Settings.js';

const roots: string[] = [];
const temporary = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-setting-links-'));
  roots.push(root);
  return root;
};
const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const noRunner: HarnessCommandRunner = () => ({ found: false, ok: false, output: '' });
const setting = (file: 'settings.json' | 'config.toml', keys: readonly string[], value: SettingsValue): LinkEntry => ({
  kind: 'setting',
  path: `setting:${file}:${keys.map(encodeURIComponent).join('/')}`,
  setting: { file, keys, value },
  resource: `setting:${keys.join('.')}`,
});
const plan = (entries: LinkEntry[], harness: LinkHarness = 'claude'): HarnessLinkPlan => ({
  harness,
  entries,
  warnings: [],
});
const statuses = (result: { actions: readonly { entry: LinkEntry; status: string }[] }): string[] =>
  result.actions.map((action) => `${action.status} ${action.entry.path}`);

describe('managed native harness settings', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.11.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('maps nested native defaults onto every supported harness layout', () => {
    const closure: LinkClosure = {
      agents: [{ slug: 'leader', document: 'Leader.' }],
      skills: [],
      commands: [],
      mcpServers: [],
      warnings: [],
      errors: [],
    };
    const defaults = { retry: { provider: { timeoutMs: 3600000 } } };

    for (const harness of ['pi', 'claude', 'codex'] as const) {
      const file = harness === 'codex' ? 'config.toml' : 'settings.json';
      expect(planHarnessLinks(closure, harness, defaults).entries).toContainEqual({
        kind: 'setting',
        path: `setting:${file}:retry/provider/timeoutMs`,
        setting: { file, keys: ['retry', 'provider', 'timeoutMs'], value: 3600000 },
        resource: `harness_defaults.${harness}.retry.provider.timeoutMs`,
      });
    }
    expect(planHarnessLinks(closure, 'pi').entries).toEqual([]);
    expect(planHarnessLinks(closure, 'pi').warnings).toEqual([
      'pi has one native agent identity; composed agent identities are not linked.',
    ]);
    expect(planHarnessLinks({ ...closure, agents: [] }, 'pi').warnings).toEqual([]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.11.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('creates, preserves, updates, and protects managed native settings', () => {
    const home = join(temporary(), 'pi');
    const initial = plan([setting('settings.json', ['retry', 'provider', 'timeoutMs'], 3600000)], 'pi');

    expect(statuses(applyHarnessLinks(initial, home, {}, noRunner))).toEqual([
      'created setting:settings.json:retry/provider/timeoutMs',
    ]);
    expect(JSON.parse(readFileSync(join(home, 'settings.json'), 'utf8'))).toEqual({
      retry: { provider: { timeoutMs: 3600000 } },
    });
    expect(statuses(applyHarnessLinks(initial, home, {}, noRunner))).toEqual([
      'unchanged setting:settings.json:retry/provider/timeoutMs',
    ]);

    const changed = plan([setting('settings.json', ['retry', 'provider', 'timeoutMs'], 7200000)], 'pi');
    expect(statuses(applyHarnessLinks(changed, home, {}, noRunner))).toEqual([
      'updated setting:settings.json:retry/provider/timeoutMs',
    ]);
    write(join(home, 'settings.json'), '{"retry":{"provider":{"timeoutMs":1}}}\n');
    expect(statuses(applyHarnessLinks(initial, home, {}, noRunner))).toEqual([
      'conflict setting:settings.json:retry/provider/timeoutMs',
    ]);
  });

  it('does not adopt unmanaged settings and reports malformed settings documents', () => {
    const root = temporary();
    const sameHome = join(root, 'same');
    write(join(sameHome, 'settings.json'), '{"theme":"dark"}\n');
    expect(
      statuses(applyHarnessLinks(plan([setting('settings.json', ['theme'], 'dark')]), sameHome, {}, noRunner)),
    ).toEqual(['unchanged setting:settings.json:theme']);
    expect(existsSync(join(sameHome, '.outfitter', 'links.json'))).toBe(false);

    const conflictHome = join(root, 'conflict');
    write(join(conflictHome, 'settings.json'), '{"theme":"light"}\n');
    expect(
      statuses(applyHarnessLinks(plan([setting('settings.json', ['theme'], 'dark')]), conflictHome, {}, noRunner)),
    ).toEqual(['conflict setting:settings.json:theme']);

    const malformedHome = join(root, 'malformed');
    write(join(malformedHome, 'settings.json'), 'not json');
    const malformed = applyHarnessLinks(
      plan([setting('settings.json', ['theme'], 'dark')]),
      malformedHome,
      {},
      noRunner,
    );
    expect(malformed.actions[0]).toMatchObject({ status: 'conflict' });
    expect(malformed.actions[0].detail).toContain('cannot parse settings.json');

    const nonObjectHome = join(root, 'non-object');
    write(join(nonObjectHome, 'settings.json'), '[]');
    expect(
      applyHarnessLinks(plan([setting('settings.json', ['theme'], 'dark')]), nonObjectHome, {}, noRunner).actions[0]
        .detail,
    ).toContain('settings document is not an object');
  });

  it('repairs scalar parents and preserves nonempty parents while removing a managed leaf', () => {
    const root = temporary();
    const home = join(root, 'pi');
    write(join(home, 'settings.json'), '{"retry":1,"theme":"dark"}\n');
    const entry = setting('settings.json', ['retry', 'provider', 'timeoutMs'], 3600000);
    expect(statuses(applyHarnessLinks(plan([entry], 'pi'), home, {}, noRunner))).toEqual([
      'created setting:settings.json:retry/provider/timeoutMs',
    ]);
    write(join(home, 'settings.json'), '{"retry":{"provider":{"timeoutMs":3600000},"keep":true},"theme":"dark"}\n');
    expect(statuses(removeHarnessLinks('pi', home, noRunner))).toEqual([
      'removed setting:settings.json:retry/provider/timeoutMs',
    ]);
    expect(JSON.parse(readFileSync(join(home, 'settings.json'), 'utf8'))).toEqual({
      retry: { keep: true },
      theme: 'dark',
    });
  });

  it('handles incomplete managed setting records without overwriting native values', () => {
    const home = join(temporary(), 'pi');
    write(join(home, 'settings.json'), '{"theme":"dark"}\n');
    write(
      join(home, '.outfitter', 'links.json'),
      '{"version":1,"harness":"pi","entries":[{"kind":"setting","path":"setting:settings.json:theme"}]}\n',
    );

    expect(
      statuses(applyHarnessLinks(plan([setting('settings.json', ['theme'], 'light')], 'pi'), home, {}, noRunner)),
    ).toEqual(['conflict setting:settings.json:theme']);
    write(
      join(home, '.outfitter', 'links.json'),
      '{"version":1,"harness":"pi","entries":[{"kind":"setting","path":"setting:settings.json:theme"}]}\n',
    );
    expect(removeHarnessLinks('pi', home, noRunner).actions[0]).toMatchObject({
      status: 'skipped',
      detail: 'native setting no longer matches the managed value',
    });
  });

  it('writes native Codex TOML settings and removes only values it still owns', () => {
    const home = join(temporary(), 'codex');
    const entries = plan(
      [setting('config.toml', ['features', 'apps'], false), setting('config.toml', ['model_reasoning_effort'], 'high')],
      'codex',
    );
    expect(statuses(applyHarnessLinks(entries, home, {}, noRunner))).toEqual([
      'created setting:config.toml:features/apps',
      'created setting:config.toml:model_reasoning_effort',
    ]);
    expect(readFileSync(join(home, 'config.toml'), 'utf8')).toContain('apps = false');

    expect(statuses(removeHarnessLinks('codex', home, noRunner))).toEqual([
      'removed setting:config.toml:features/apps',
      'removed setting:config.toml:model_reasoning_effort',
    ]);
    expect(readFileSync(join(home, 'config.toml'), 'utf8').trim()).toBe('');

    applyHarnessLinks(plan([setting('config.toml', ['features', 'apps'], false)], 'codex'), home, {}, noRunner);
    write(join(home, 'config.toml'), '[features]\napps = true\n');
    expect(removeHarnessLinks('codex', home, noRunner).actions[0]).toMatchObject({
      status: 'skipped',
      detail: 'native setting no longer matches the managed value',
    });
  });
});
