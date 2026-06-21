// Tests profile control parsing behavior.
import { describe, expect, it } from 'vitest';

import { parseProfileYaml } from '../../src/profiles/ProfileLoader.js';

describe('profile control parsing', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-005.3, OFTR-006.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('parses generic, pi, and claude array controls from profile YAML', () => {
    const profile = parseProfileYaml(
      [
        'id: arrays',
        'controls:',
        '  args: [--generic]',
        '  extensions: [ext-a]',
        '  skills: [skill-a]',
        '  append_system_prompt: [prompt-a, prompt-b]',
        '  pi:',
        '    args: [--pi]',
        '    extensions: [ext-pi]',
        '    skills: [skill-pi]',
        '    append_system_prompt: [prompt-pi-a, prompt-pi-b]',
        '  claude:',
        '    args: [--claude]',
        '    extensions: [plugin-claude]',
        '    skills: [skill-claude]',
        '    append_system_prompt: [prompt-claude-a, prompt-claude-b]',
        '',
      ].join('\n'),
      'fallback',
    );

    expect('message' in profile).toBe(false);
    if (!('message' in profile)) {
      expect(profile.controls.args).toEqual(['--generic']);
      expect(profile.controls.extensions).toEqual(['ext-a']);
      expect(profile.controls.skills).toEqual(['skill-a']);
      expect(profile.controls.appendSystemPrompt).toEqual(['prompt-a', 'prompt-b']);
      expect(profile.controls.pi?.args).toEqual(['--pi']);
      expect(profile.controls.pi?.extensions).toEqual(['ext-pi']);
      expect(profile.controls.pi?.skills).toEqual(['skill-pi']);
      expect(profile.controls.pi?.appendSystemPrompt).toEqual(['prompt-pi-a', 'prompt-pi-b']);
      expect(profile.controls.claude?.args).toEqual(['--claude']);
      expect(profile.controls.claude?.extensions).toEqual(['plugin-claude']);
      expect(profile.controls.claude?.skills).toEqual(['skill-claude']);
      expect(profile.controls.claude?.appendSystemPrompt).toEqual(['prompt-claude-a', 'prompt-claude-b']);
    }
  });
});
