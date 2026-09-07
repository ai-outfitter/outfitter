// Exercises the provider step that follows the walkthrough: the setup shell offers Pi's native
// /login when no real provider is connected and records a skip otherwise.
import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';

import { cleanupFixtures, createMockContext, fixture } from './helpers/pi-setup-extension-harness.js';
import type { MockContext } from './helpers/pi-setup-extension-harness.js';

afterEach(cleanupFixtures);

describe('Pi setup extension provider step', () => {
  const fullWidth = (context: MockContext): string => context.rendered.flat().join(' ');

  it('offers /login after the handoff when no real provider is connected and waits for it', async () => {
    const { pi, resultPath } = fixture();
    const context = createMockContext({ models: [{ provider: 'outfitter-setup' }], login: 'connect' });
    await pi.commands.outfitter.handler({}, context);

    // The handoff precedes the provider step, and the dialog follows the CLI-agent screen.
    expect(fullWidth(context)).toContain('Pi does not have a model provider connected yet.');
    expect(fullWidth(context)).toContain('Press Enter to open /login');
    expect(context.rendered[3]?.join(' ')).toContain('Connect a model provider');
    expect(context.editorText).toBe('/login');
    expect(JSON.parse(readFileSync(resultPath, 'utf8'))).toEqual({
      setupMode: 'default',
      agentId: 'engineer',
      harness: 'pi',
      target: 'home',
    });
    expect(context.shutdowns).toBe(1);
  });

  it('skips the provider step when a real provider is already connected', async () => {
    const { pi } = fixture();
    const context = createMockContext({ models: [{ provider: 'outfitter-setup' }, { provider: 'openai' }] });
    await pi.commands.outfitter.handler({}, context);
    expect(fullWidth(context)).not.toContain('model provider');
    expect(context.editorText).toBe('');
  });

  it('skips the provider step for a non-Pi harness', async () => {
    const { pi, resultPath } = fixture();
    const context = createMockContext({
      models: [],
      pickOption: (labels) => {
        const index = labels.findIndex((label) => label.includes('Claude Code'));
        return index === -1 ? undefined : index;
      },
    });
    await pi.commands.outfitter.handler({}, context);
    expect(JSON.parse(readFileSync(resultPath, 'utf8'))).toMatchObject({ harness: 'claude' });
    expect(fullWidth(context)).not.toContain('model provider');
  });

  it('records a skipped provider step in the handoff when the user presses Escape', async () => {
    const { pi, resultPath } = fixture();
    const context = createMockContext({
      models: [],
      pickOption: (labels) => (labels.includes('Connect a model provider') ? -1 : undefined),
    });
    // -1 makes the driver press Escape via its target-index guard below.
    await pi.commands.outfitter.handler({}, context);
    expect(context.editorText).toBe('');
    expect(JSON.parse(readFileSync(resultPath, 'utf8'))).toMatchObject({ providerConnection: 'skipped' });
    expect(context.shutdowns).toBe(1);
  });

  it('records a skipped provider step when the user leaves pi login without connecting', async () => {
    const { pi, resultPath } = fixture();
    const context = createMockContext({ models: [], login: 'cancel' });
    await pi.commands.outfitter.handler({}, context);
    expect(context.editorText).toBe('/login');
    expect(JSON.parse(readFileSync(resultPath, 'utf8'))).toMatchObject({ providerConnection: 'skipped' });
    expect(context.shutdowns).toBe(1);
  });

  it('reports connected when the credential lands after pi showed its login UI', async () => {
    const { pi, resultPath } = fixture();
    const context = createMockContext({ models: [], login: 'connect-late' });
    await pi.commands.outfitter.handler({}, context);
    expect(context.editorText).toBe('/login');
    expect(JSON.parse(readFileSync(resultPath, 'utf8'))).not.toHaveProperty('providerConnection');
    expect(context.shutdowns).toBe(1);
  });

  it('gives up waiting when pi never opens its login UI or has no editor to submit it', async () => {
    for (const login of ['never-opens', 'no-editor'] as const) {
      const { pi, resultPath } = fixture();
      const context = createMockContext({ models: [], login });
      await pi.commands.outfitter.handler({}, context);
      expect(JSON.parse(readFileSync(resultPath, 'utf8'))).toMatchObject({ providerConnection: 'skipped' });
    }
  });

  it('treats a missing or failing model registry as no provider', async () => {
    const { pi, resultPath } = fixture();
    const context = createMockContext({ modelRegistry: false, login: 'never-opens' });
    await pi.commands.outfitter.handler({}, context);
    expect(fullWidth(context)).toContain('Pi does not have a model provider connected yet.');
    expect(JSON.parse(readFileSync(resultPath, 'utf8'))).toMatchObject({ providerConnection: 'skipped' });

    const failing = fixture();
    const failingContext = createMockContext({ login: 'connect' });
    let calls = 0;
    Object.assign(failingContext, {
      modelRegistry: {
        getAvailable: () => {
          calls += 1;
          if (calls === 1) throw new Error('registry unavailable');
          return 'not-an-array';
        },
      },
    });
    await failing.pi.commands.outfitter.handler({}, failingContext);
    expect(fullWidth(failingContext)).toContain('Pi does not have a model provider connected yet.');
  });
});
