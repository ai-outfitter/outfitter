// Tests pi adapter translation behavior.
import { describe, expect, it } from 'vitest';

import { createPiAdapter } from '../../src/agents/pi/PiAdapter.js';
import { parseProfileYaml } from '../../src/profiles/ProfileLoader.js';

describe('pi adapter', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-006.1, BRIDL-REQ-006.2, BRIDL-REQ-006.3, BRIDL-REQ-006.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('translates generic and pi-specific profile controls into pi env and argv', () => {
    const adapter = createPiAdapter();
    const tackPlan = adapter.createTack(
      {
        id: 'engineering',
        inherits: [],
        controls: {
          model: 'generic-model',
          provider: 'anthropic',
          environment: { GENERIC: '1' },
          extensions: ['ext-a'],
          skills: ['skill-a'],
          promptTemplate: 'template-a',
          systemPrompt: 'base prompt',
          appendSystemPrompt: 'extra prompt',
          pi: {
            model: 'pi-model',
            sessionDirectory: '/tmp/pi-sessions',
            args: ['--share'],
            environment: { PI_ONLY: '1' },
          },
        },
      },
      { rootDirectory: '/tmp/bridl-engineering-pi-123', profilePaths: ['/profiles/engineering/profile.yml'] },
    );
    const launchPlan = adapter.createLaunchPlan(tackPlan.tack, {
      id: 'engineering',
      inherits: [],
      controls: {
        model: 'generic-model',
        provider: 'anthropic',
        environment: { GENERIC: '1' },
        extensions: ['ext-a'],
        skills: ['skill-a'],
        promptTemplate: 'template-a',
        systemPrompt: 'base prompt',
        appendSystemPrompt: 'extra prompt',
        pi: {
          model: 'pi-model',
          sessionDirectory: '/tmp/pi-sessions',
          args: ['--share'],
          environment: { PI_ONLY: '1' },
        },
      },
    });

    expect(adapter.id).toBe('pi');
    expect(adapter.supportedControls).toContain('model');
    expect(adapter.supportedControls).toContain('promptTemplate');
    expect(
      adapter.getUnsupportedControls({
        id: 'engineering',
        inherits: [],
        controls: { pi: { unsupportedPiControl: true } },
      }),
    ).toEqual(['pi.unsupportedPiControl']);
    expect(tackPlan.tack.rootDirectory).toBe('/tmp/bridl-engineering-pi-123');
    expect(tackPlan.tack.files[0]?.sourceInputs).toEqual(['/profiles/engineering/profile.yml']);
    expect(launchPlan.command).toBe('pi');
    expect(launchPlan.env).toEqual({
      GENERIC: '1',
      PI_ONLY: '1',
      PI_CODING_AGENT_DIR: '/tmp/bridl-engineering-pi-123',
    });
    expect(launchPlan.args).toEqual([
      '--model',
      'pi-model',
      '--provider',
      'anthropic',
      '--session-dir',
      '/tmp/pi-sessions',
      '--prompt-template',
      'template-a',
      '--system-prompt',
      'base prompt',
      '--append-system-prompt',
      'extra prompt',
      '--extension',
      'ext-a',
      '--skill',
      'skill-a',
      '--share',
    ]);

    const genericFallbackProfile = parseProfileYaml(
      'id: fallback\ncontrols:\n  model: generic-model\n  pi: {}\n',
      'fallback',
    );
    expect('message' in genericFallbackProfile).toBe(false);
    if (!('message' in genericFallbackProfile)) {
      expect(adapter.createLaunchPlan(tackPlan.tack, genericFallbackProfile).args).toEqual([
        '--model',
        'generic-model',
      ]);
    }
  });
});
