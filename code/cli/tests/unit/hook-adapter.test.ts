// Tests the harness-neutral hook adapter and its ownership-preserving settings merge.
import { describe, expect, it } from 'vitest';

import {
  HOOK_EVENTS,
  OUTFITTER_HOOK_MARKER,
  isHookEvent,
  isMergeConflict,
  mergeHookSettingsDocument,
  mergeManagedHooks,
  nativeHookEvent,
  projectHooks,
  stripManagedHooks,
} from '../../src/harness/HookAdapter.js';

describe('hook adapter', () => {
  it('recognizes neutral hook events', () => {
    expect(HOOK_EVENTS.every((event) => isHookEvent(event))).toBe(true);
    expect(isHookEvent('PreToolUse')).toBe(false);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.4.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('translates neutral events to each harness native event name', () => {
    expect(nativeHookEvent('before_tool', 'claude')).toBe('PreToolUse');
    expect(nativeHookEvent('before_tool', 'gemini')).toBe('BeforeTool');
    expect(nativeHookEvent('after_tool', 'claude')).toBe('PostToolUse');
    expect(nativeHookEvent('after_tool', 'gemini')).toBe('AfterTool');
    expect(nativeHookEvent('session_start', 'claude')).toBe('SessionStart');
    expect(nativeHookEvent('notification', 'gemini')).toBe('Notification');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.4.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('reports events with no native equivalent instead of approximating them', () => {
    // Claude has no before-agent event, and its Stop event is not equivalent to AfterAgent.
    expect(nativeHookEvent('before_agent', 'claude')).toBeUndefined();
    expect(nativeHookEvent('after_agent', 'claude')).toBeUndefined();
    // Codex and Copilot expose no hook surface at all.
    expect(nativeHookEvent('before_tool', 'codex')).toBeUndefined();
    expect(nativeHookEvent('before_tool', 'copilot')).toBeUndefined();

    const projection = projectHooks([{ event: 'before_agent', command: 'guard' }], 'claude');
    expect(projection.hooks).toEqual({});
    expect(projection.unsupported).toEqual(["hook event 'before_agent' has no claude equivalent"]);
  });

  it('groups declarations sharing a matcher into one entry and stamps the ownership marker', () => {
    const projection = projectHooks(
      [
        { event: 'before_tool', matcher: 'Bash', command: 'first', name: 'a', timeout: 500 },
        { event: 'before_tool', matcher: 'Bash', command: 'second' },
        { event: 'before_tool', matcher: 'Write', command: 'third' },
      ],
      'claude',
    );

    expect(projection.unsupported).toEqual([]);
    expect(projection.hooks.PreToolUse).toEqual([
      {
        matcher: 'Bash',
        hooks: [
          { type: 'command', command: 'first', name: 'a', timeout: 500 },
          { type: 'command', command: 'second' },
        ],
        [OUTFITTER_HOOK_MARKER]: true,
      },
      { matcher: 'Write', hooks: [{ type: 'command', command: 'third' }], [OUTFITTER_HOOK_MARKER]: true },
    ]);
  });

  it('omits an absent matcher rather than emitting undefined', () => {
    const projection = projectHooks([{ event: 'session_start', command: 'boot' }], 'gemini');
    expect(projection.hooks.SessionStart?.[0]).not.toHaveProperty('matcher');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.2.7, OFTR-011.2.8).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('replaces only previously generated entries and preserves hand-written ones', () => {
    const handWritten = { matcher: 'Bash', hooks: [{ type: 'command', command: 'mine' }] };
    const stale = { matcher: 'Bash', hooks: [{ type: 'command', command: 'old' }], [OUTFITTER_HOOK_MARKER]: true };
    const generated = projectHooks([{ event: 'before_tool', matcher: 'Bash', command: 'new' }], 'claude').hooks;

    const merged = mergeManagedHooks({ PreToolUse: [handWritten, stale], SessionEnd: [handWritten] }, generated);

    expect(isMergeConflict(merged)).toBe(false);
    const hooks = merged as Readonly<Record<string, unknown>>;
    expect(hooks.PreToolUse).toEqual([handWritten, ...(generated.PreToolUse ?? [])]);
    // An event Outfitter does not manage is carried through untouched.
    expect(hooks.SessionEnd).toEqual([handWritten]);
  });

  it('drops an event whose only entries were generated, and tolerates a missing hooks object', () => {
    const stale = { hooks: [{ type: 'command', command: 'old' }], [OUTFITTER_HOOK_MARKER]: true };

    expect(mergeManagedHooks({ PreToolUse: [stale] }, {})).toEqual({});
    expect(mergeManagedHooks(undefined, {})).toEqual({});
  });

  it('preserves a non-array hooks value rather than discarding it', () => {
    expect(mergeManagedHooks({ PreToolUse: 'unexpected' }, {})).toEqual({ PreToolUse: 'unexpected' });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.2.8).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('refuses to merge into an event holding an unmanaged non-array value', () => {
    const generated = projectHooks([{ event: 'notification', command: 'ping' }], 'claude').hooks;

    // Appending is impossible and replacing would destroy the user's value, so the merge fails.
    expect(mergeManagedHooks({ Notification: 'unexpected' }, generated)).toEqual({
      conflict: 'hooks.Notification is not an array; hooks were not written',
    });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.2.13).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('surfaces an event-level merge conflict through the document merge', () => {
    const generated = projectHooks([{ event: 'notification', command: 'ping' }], 'claude').hooks;
    const existing = JSON.stringify({ model: 'opus', hooks: { Notification: 'unexpected' } });

    expect(mergeHookSettingsDocument(existing, generated)).toEqual({
      error: 'hooks.Notification is not an array; hooks were not written',
    });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.2.13).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('refuses to write over a non-object hooks value', () => {
    const generated = projectHooks([{ event: 'notification', command: 'ping' }], 'claude').hooks;

    expect(mergeHookSettingsDocument(JSON.stringify({ hooks: 'unexpected' }), generated)).toEqual({
      error: 'has a non-object `hooks` value; hooks were not written',
    });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.3.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('strips only marked entries, and refuses to touch an unreadable document', () => {
    const handWritten = { matcher: 'Bash', hooks: [{ type: 'command', command: 'mine' }] };
    const managed = { matcher: 'Write', hooks: [{ type: 'command', command: 'ours' }], [OUTFITTER_HOOK_MARKER]: true };

    const stripped = stripManagedHooks(
      JSON.stringify({ model: 'opus', hooks: { PreToolUse: [handWritten, managed] } }),
    );
    const document = JSON.parse(stripped.content ?? '{}') as { model: string; hooks: Record<string, unknown[]> };

    expect(document.model).toBe('opus');
    expect(document.hooks.PreToolUse).toEqual([handWritten]);

    expect(stripManagedHooks('{ not json').error).toContain('could not be parsed as JSON');
    expect(stripManagedHooks('[]').error).toContain('is not a JSON object');
  });

  it('reports nothing to strip for an absent file, a hookless document, or a non-object hooks value', () => {
    expect(stripManagedHooks(undefined)).toEqual({});
    expect(stripManagedHooks('{"model":"opus"}')).toEqual({});
    expect(stripManagedHooks('{"hooks":"unexpected"}')).toEqual({});
  });

  it('reports nothing to strip when the document holds only hand-written entries', () => {
    const handWritten = { matcher: 'Bash', hooks: [{ type: 'command', command: 'mine' }] };
    const raw = `${JSON.stringify({ hooks: { PreToolUse: [handWritten] } }, null, 2)}\n`;

    expect(stripManagedHooks(raw)).toEqual({});
  });
});
