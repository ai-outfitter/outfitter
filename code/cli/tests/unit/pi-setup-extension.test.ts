// Exercises the generated Pi `/outfitter` walkthrough UI: the profile screen, target and CLI
// screens, import branch, cancellation, and startup branding.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { cleanupFixtures, createMockContext, fixture } from './helpers/pi-setup-extension-harness.js';

afterEach(cleanupFixtures);

describe('Pi setup extension', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-010.2, OFTR-011.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('asks profile, target, and CLI agent in order and mentions the telemetry setting on completion', async () => {
    const { pi, resultPath } = fixture();
    const context = createMockContext();
    await pi.commands.outfitter.handler({}, context);

    // One screen: featured profiles first (Engineer recommended), then More profiles, then the import row (#381).
    expect(context.selectCalls).toEqual([]);
    expect(context.rendered[0]?.join('\n')).toContain('Choose an Outfitter profile');
    expect(context.rendered[0]?.join('\n')).toContain('→ Engineer (Recommended)');
    expect(context.rendered[0]?.join('\n')).not.toContain('Create your own profile');
    // Featured profiles only, then "More profiles", then the import row; other profiles stay hidden.
    const firstScreen = context.rendered[0]?.join('\n') ?? '';
    expect(firstScreen).not.toContain('Planner');
    expect(firstScreen.indexOf('Founder')).toBeLessThan(firstScreen.indexOf('More profiles (1)'));
    expect(firstScreen.indexOf('More profiles (1)')).toBeLessThan(
      firstScreen.indexOf('Import a different .agents catalog'),
    );
    expect(context.rendered[1]?.join(' ')).toContain('Where should Outfitter install these settings?');
    expect(context.rendered[2]?.join(' ')).toContain('Which CLI agent should Outfitter use by default?');
    expect(context.rendered[2]?.join('\n')).toContain('→ Pi / Outfitter (Recommended)');
    expect(context.rendered[2]?.join('\n')).toContain('Codex CLI');
    expect(JSON.parse(readFileSync(resultPath, 'utf8'))).toEqual({
      setupMode: 'default',
      agentId: 'engineer',
      harness: 'pi',
      target: 'home',
    });
    expect(context.rendered.flat().every((line) => line.length <= 40)).toBe(true);
    expect(context.notifications.join('\n')).toContain(
      'Pseudonymous usage analytics are on by default; turn them off with telemetry.enabled: false',
    );
    expect(context.shutdowns).toBe(1);
  });

  it('imports a different catalog from the profile screen with the original catalog prompts', async () => {
    const { pi, resultPath } = fixture();
    const context = createMockContext({
      mode: 'catalog',
      inputs: ['my_account/outfitter_config', 'main', 'settings.yml'],
    });
    await pi.commands.outfitter.handler({}, context);
    expect(JSON.parse(readFileSync(resultPath, 'utf8'))).toEqual({
      setupMode: 'catalog',
      github: 'my_account/outfitter_config',
      ref: 'main',
      settingsPath: 'settings.yml',
      harness: 'pi',
      target: 'home',
    });
  });

  const seedSettings = (home: string): void => {
    mkdirSync(join(home, '.agents'), { recursive: true });
    writeFileSync(join(home, '.agents', 'settings.yml'), 'default_agent: keepme\n');
  };

  it('does not replace existing settings when the user declines the confirmation', async () => {
    const { pi, resultPath, home } = fixture();
    seedSettings(home);
    const context = createMockContext({
      mode: 'catalog',
      inputs: ['my_account/outfitter_config', 'main', 'settings.yml'],
      // Default preselection is "Keep my current settings"; the default mock presses it.
    });
    await pi.commands.outfitter.handler({}, context);

    expect(existsSync(resultPath)).toBe(false);
    expect(readFileSync(join(home, '.agents', 'settings.yml'), 'utf8')).toBe('default_agent: keepme\n');
    expect(context.notifications.some((message) => message.includes('Kept your existing'))).toBe(true);
    expect(context.shutdowns).toBe(1);
  });

  it('replaces existing settings only after the user confirms', async () => {
    const { pi, resultPath, home } = fixture();
    seedSettings(home);
    const context = createMockContext({
      mode: 'catalog',
      inputs: ['my_account/outfitter_config', 'main', 'settings.yml'],
      pickOption: (labels) => {
        const index = labels.findIndex((label) => label.includes('Replace them'));
        return index === -1 ? undefined : index;
      },
    });
    await pi.commands.outfitter.handler({}, context);

    expect(JSON.parse(readFileSync(resultPath, 'utf8'))).toMatchObject({
      setupMode: 'catalog',
      github: 'my_account/outfitter_config',
      target: 'home',
    });
  });

  it('keeps the original private-catalog confirmation before target selection', async () => {
    const { pi, resultPath } = fixture({ visibility: 'private' });
    const context = createMockContext({
      mode: 'catalog',
      inputs: ['company/private-profiles', 'main', 'settings.yml'],
    });
    await pi.commands.outfitter.handler({}, context);
    expect(context.rendered.flat().join(' ')).toContain(
      'Private GitHub profile catalog detected: company/private-profiles.',
    );
    expect(JSON.parse(readFileSync(resultPath, 'utf8'))).toMatchObject({
      setupMode: 'catalog',
      privateCatalogAccepted: true,
      privateCatalogsEnabled: true,
    });
  });

  it('expands the full profile list behind "More profiles"', async () => {
    const { pi, resultPath } = fixture();
    let picker = 0;
    const context = createMockContext({
      pickOption: (labels) => {
        picker += 1;
        if (picker === 1) return labels.findIndex((label) => label.startsWith('More profiles'));
        if (picker === 2) return labels.findIndex((label) => label.startsWith('Planner'));
        return undefined;
      },
    });
    await pi.commands.outfitter.handler({}, context);
    const expanded = context.rendered[1]?.join('\n') ?? '';
    expect(expanded).toContain('→ Engineer (Recommended)');
    expect(expanded).toContain('Planner');
    expect(expanded).not.toContain('More profiles');
    expect(JSON.parse(readFileSync(resultPath, 'utf8'))).toMatchObject({ setupMode: 'default', agentId: 'planner' });
  });

  it('keeps the collapsed list and marks a featured current default', async () => {
    const { pi, resultPath } = fixture({ currentDefault: 'founder' });
    const context = createMockContext();
    await pi.commands.outfitter.handler({}, context);
    const screen = context.rendered[0]?.join('\n') ?? '';
    expect(screen).toContain('→ Founder (current)');
    expect(screen).toContain('More profiles (1)');
    expect(screen).not.toContain('Recommended');
    expect(JSON.parse(readFileSync(resultPath, 'utf8'))).toMatchObject({ agentId: 'founder' });
  });

  it('cancels from the expanded list without writing a handoff', async () => {
    const { pi, resultPath } = fixture();
    let picker = 0;
    const context = createMockContext({
      pickOption: (labels) => {
        picker += 1;
        return picker === 1 ? labels.findIndex((label) => label.startsWith('More profiles')) : -1;
      },
    });
    await pi.commands.outfitter.handler({}, context);
    expect(existsSync(resultPath)).toBe(false);
    expect(context.notifications.join('\n')).toContain('no settings were changed');
  });

  it('shows every profile directly when the current default is not featured or nothing is featured', async () => {
    const current = fixture({ currentDefault: 'planner' });
    const currentContext = createMockContext();
    await current.pi.commands.outfitter.handler({}, currentContext);
    const currentScreen = currentContext.rendered[0]?.join('\n') ?? '';
    expect(currentScreen).toContain('→ Planner (current)');
    expect(currentScreen).not.toContain('More profiles');

    const flat = fixture({ agents: [{ id: 'custom', label: 'Custom', description: 'Custom profile.' }] });
    const flatContext = createMockContext();
    await flat.pi.commands.outfitter.handler({}, flatContext);
    expect(flatContext.rendered[0]?.join('\n')).toContain('→ Custom');
    expect(flatContext.rendered[0]?.join('\n')).not.toContain('More profiles');
  });

  it('preselects the import row and explains an empty default catalog', async () => {
    const { pi, resultPath } = fixture({ agents: [] });
    const context = createMockContext({ inputs: ['acme/config', 'main', 'settings.yml'] });
    await pi.commands.outfitter.handler({}, context);
    expect(context.rendered[0]?.join(' ')).toContain('No profiles were found in the default Outfitter catalog');
    expect(context.rendered[0]?.join('\n')).toContain('→ Import a different .agents catalog');
    expect(JSON.parse(readFileSync(resultPath, 'utf8'))).toMatchObject({ setupMode: 'catalog', github: 'acme/config' });
  });

  it('bypasses the profile screen for a provided source, as the original flow did', async () => {
    const { pi, resultPath } = fixture({ setupSourceUri: 'https://example.test/catalog.git' });
    const context = createMockContext();
    await pi.commands.outfitter.handler({}, context);
    expect(context.rendered[0]?.join(' ')).toContain('Where should Outfitter install these settings?');
    expect(JSON.parse(readFileSync(resultPath, 'utf8'))).toEqual({
      setupMode: 'source',
      sourceUri: 'https://example.test/catalog.git',
      harness: 'pi',
      target: 'home',
    });
  });

  it('cancels without writing a handoff', async () => {
    const { pi, resultPath } = fixture();
    const context = createMockContext({ mode: 'cancel' });
    await pi.commands.outfitter.handler({}, context);
    expect(existsSync(resultPath)).toBe(false);
    expect(context.notifications.join('\n')).toContain('no settings were changed');
    expect(context.shutdowns).toBe(1);
  });

  it('brands startup with the original header and auto-opens /outfitter without model login', async () => {
    const { pi } = fixture();
    const context = createMockContext();
    await pi.handlers.session_start[0]({ reason: 'startup' }, context);
    expect(context.editorText).toBe('/outfitter');
    expect(context.rendered.flat().join('\n')).toContain('Outfitter + pi');
    expect(context.rendered.flat().join('\n')).toContain('profiles define model, tools, prompts,');
  });

  it('omits the arrow-key legend for a single-item picker but keeps it for longer lists', async () => {
    const { pi } = fixture();
    const context = createMockContext({ models: [], login: 'connect' });
    await pi.commands.outfitter.handler({}, context);
    const profilePicker = context.rendered[0]?.join('\n') ?? '';
    const providerDialog = context.rendered[3]?.join('\n') ?? '';
    expect(profilePicker).toContain('↑↓ navigate  enter select');
    expect(providerDialog).toContain('enter connect  escape skip');
    expect(providerDialog).not.toContain('navigate');
  });

  it('does not tell the user to restart Outfitter after setup', async () => {
    const { pi } = fixture();
    const context = createMockContext();
    await pi.commands.outfitter.handler({}, context);
    expect(context.notifications.join('\n')).not.toMatch(/restart/iu);
    expect(context.notifications.join('\n')).toContain('Pseudonymous usage analytics');
  });
});
