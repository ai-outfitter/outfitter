// Tests launch resource identity normalization used for deduplication.
import { describe, expect, it } from 'vitest';

import { normalizeExtensionResourceIdentity } from '../../src/agents/ResourceIdentity.js';

describe('resource identity normalization', () => {
  it('deduplicates npm extensions by package name while ignoring versions', () => {
    expect(normalizeExtensionResourceIdentity('npm:pi-subagents')).toBe('npm:pi-subagents');
    expect(normalizeExtensionResourceIdentity('npm:pi-subagents@latest')).toBe('npm:pi-subagents');
    expect(normalizeExtensionResourceIdentity('npm:@juicesharp/rpiv-ask-user-question@1.2.3')).toBe(
      'npm:@juicesharp/rpiv-ask-user-question',
    );
    expect(normalizeExtensionResourceIdentity('npm:@juicesharp/rpiv-ask-user-question')).toBe(
      'npm:@juicesharp/rpiv-ask-user-question',
    );
  });

  it('deduplicates git extensions by repository while ignoring refs and URL spelling', () => {
    expect(normalizeExtensionResourceIdentity('git:github.com/applepi-ai/deepwork#main')).toBe(
      'git:https://github.com/applepi-ai/deepwork.git',
    );
    expect(normalizeExtensionResourceIdentity('git+https://github.com/applepi-ai/deepwork.git#v1')).toBe(
      'git:https://github.com/applepi-ai/deepwork.git',
    );
    expect(normalizeExtensionResourceIdentity('github:applepi-ai/deepwork#main')).toBe(
      'git:https://github.com/applepi-ai/deepwork.git',
    );
    expect(normalizeExtensionResourceIdentity('https://github.com/applepi-ai/deepwork')).toBe(
      'git:https://github.com/applepi-ai/deepwork.git',
    );
    expect(normalizeExtensionResourceIdentity('git:not a url#main')).toBe('git:not a url.git');
  });
});
