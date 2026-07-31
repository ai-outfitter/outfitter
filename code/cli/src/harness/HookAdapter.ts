// Translates harness-neutral hook declarations from settings.yml into each harness's native hook
// schema. Claude Code and Gemini CLI use a structurally identical envelope — an array of
// `{matcher, hooks: [{type, command, timeout}]}` entries keyed by event — and differ only in what
// they call each event. That difference is the whole adapter; the envelope is shared.
//
// Event names were read from Claude Code's settings hooks and the `settings.schema.json` shipped
// with Gemini CLI 0.52.0. An event a harness does not name is reported unsupported rather than
// guessed at, so `--strict` can fail on a hook that would otherwise never fire.
import type { HarnessId } from './HarnessLayout.js';

/** Harness-neutral hook events users write in settings.yml. */
export const HOOK_EVENTS = [
  'before_tool',
  'after_tool',
  'before_agent',
  'after_agent',
  'session_start',
  'session_end',
  'notification',
] as const;
export type HookEvent = (typeof HOOK_EVENTS)[number];

export const isHookEvent = (value: string): value is HookEvent => (HOOK_EVENTS as readonly string[]).includes(value);

/** One neutral hook declaration. `matcher` is passed through untranslated; both harnesses use it. */
export interface HookDeclaration {
  readonly event: HookEvent;
  readonly command: string;
  readonly matcher?: string;
  readonly name?: string;
  readonly timeout?: number;
}

/**
 * Neutral event to native event name, per harness. A missing entry means the harness has no
 * equivalent event.
 *
 * Claude has no dedicated before-agent event, and its `Stop` fires when the main agent finishes a
 * response — close to Gemini's `AfterAgent` but not identical, so it is deliberately not mapped.
 * Overstating that equivalence would silently change when a user's hook runs.
 */
const NATIVE_EVENTS: Readonly<Record<HookEvent, Partial<Record<HarnessId, string>>>> = {
  before_tool: { claude: 'PreToolUse', gemini: 'BeforeTool' },
  after_tool: { claude: 'PostToolUse', gemini: 'AfterTool' },
  before_agent: { gemini: 'BeforeAgent' },
  after_agent: { gemini: 'AfterAgent' },
  session_start: { claude: 'SessionStart', gemini: 'SessionStart' },
  session_end: { claude: 'SessionEnd', gemini: 'SessionEnd' },
  notification: { claude: 'Notification', gemini: 'Notification' },
};

export const nativeHookEvent = (event: HookEvent, harness: HarnessId): string | undefined =>
  NATIVE_EVENTS[event][harness];

/** The native `hooks` object both Claude and Gemini accept, keyed by native event name. */
export type NativeHooks = Readonly<Record<string, readonly NativeHookEntry[]>>;

export interface NativeHookEntry {
  readonly matcher?: string;
  readonly hooks: readonly NativeHookCommand[];
  /** Marks the entry as Outfitter-owned so reconcile can replace only its own entries. */
  readonly [OUTFITTER_HOOK_MARKER]?: true;
}

export interface NativeHookCommand {
  readonly type: 'command';
  readonly command: string;
  readonly name?: string;
  readonly timeout?: number;
}

/**
 * Marker key stamped on every generated entry. Hooks merge into a settings file the user also
 * edits by hand, so ownership has to travel with the entry itself — a path-level manifest cannot
 * express "these three array elements are ours".
 */
export const OUTFITTER_HOOK_MARKER = 'x-outfitter-managed' as const;

export interface HookProjection {
  readonly hooks: NativeHooks;
  /** Declarations this harness cannot express, as human-readable reasons. */
  readonly unsupported: readonly string[];
}

const toNativeCommand = (declaration: HookDeclaration): NativeHookCommand => ({
  type: 'command',
  command: declaration.command,
  ...(declaration.name === undefined ? {} : { name: declaration.name }),
  ...(declaration.timeout === undefined ? {} : { timeout: declaration.timeout }),
});

/**
 * Groups declarations by native event, then by matcher, so several hooks sharing a matcher become
 * one entry with several commands — the shape both harnesses document.
 */
export const projectHooks = (declarations: readonly HookDeclaration[], harness: HarnessId): HookProjection => {
  const hooks: Record<string, NativeHookEntry[]> = {};
  const unsupported: string[] = [];

  for (const declaration of declarations) {
    const nativeEvent = nativeHookEvent(declaration.event, harness);

    if (nativeEvent === undefined) {
      unsupported.push(`hook event '${declaration.event}' has no ${harness} equivalent`);
      continue;
    }

    const entries = (hooks[nativeEvent] ??= []);
    const existing = entries.find((entry) => entry.matcher === declaration.matcher);

    if (existing === undefined) {
      entries.push({
        ...(declaration.matcher === undefined ? {} : { matcher: declaration.matcher }),
        hooks: [toNativeCommand(declaration)],
        [OUTFITTER_HOOK_MARKER]: true,
      });
      continue;
    }

    entries[entries.indexOf(existing)] = {
      ...existing,
      hooks: [...existing.hooks, toNativeCommand(declaration)],
    };
  }

  return { hooks, unsupported };
};

const isManagedEntry = (value: unknown): boolean =>
  value !== null && typeof value === 'object' && (value as Record<string, unknown>)[OUTFITTER_HOOK_MARKER] === true;

/**
 * Folds generated hooks into an existing settings document, dropping only previously generated
 * entries. Hand-written entries are preserved even when they sit in an event Outfitter also
 * manages, satisfying #187's rule that unmanaged configuration is never rewritten.
 */
export const mergeManagedHooks = (
  existingHooks: Readonly<Record<string, unknown>> | undefined,
  generated: NativeHooks,
): Readonly<Record<string, unknown>> => {
  const merged: Record<string, unknown> = {};

  for (const [event, entries] of Object.entries(existingHooks ?? {})) {
    const preserved = Array.isArray(entries) ? entries.filter((entry) => !isManagedEntry(entry)) : entries;
    if (!Array.isArray(preserved) || preserved.length > 0) merged[event] = preserved;
  }

  for (const [event, entries] of Object.entries(generated)) {
    const preserved: unknown = merged[event];
    merged[event] = Array.isArray(preserved) ? [...(preserved as readonly unknown[]), ...entries] : [...entries];
  }

  return merged;
};

export interface HookDocumentMerge {
  /** The full settings document to write, already serialized. Absent when `error` is set. */
  readonly content?: string;
  /** Why the document could not be merged safely; the file must then be left untouched. */
  readonly error?: string;
}

/**
 * Produces the complete settings document to write for a harness.
 *
 * The merge is computed during planning rather than while applying so the planner can compare it
 * against the file on disk and report "unchanged" — rewriting an identical settings.json on every
 * run would make `outfitter link` a no-op that still touches the user's files.
 */
export const mergeHookSettingsDocument = (
  existingRaw: string | undefined,
  generated: NativeHooks,
): HookDocumentMerge => {
  let document: Record<string, unknown> = {};

  if (existingRaw !== undefined) {
    let parsed: unknown;

    try {
      parsed = JSON.parse(existingRaw);
    } catch {
      return { error: 'could not be parsed as JSON; hooks were not written' };
    }

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { error: 'is not a JSON object; hooks were not written' };
    }

    document = parsed as Record<string, unknown>;
  }

  const existingHooks = document.hooks;
  const hooks = mergeManagedHooks(
    existingHooks !== null && typeof existingHooks === 'object' && !Array.isArray(existingHooks)
      ? (existingHooks as Record<string, unknown>)
      : undefined,
    generated,
  );

  return { content: `${JSON.stringify({ ...document, hooks }, null, 2)}\n` };
};

/**
 * Removes Outfitter's own hook entries from a settings document, leaving every other key and every
 * hand-written entry untouched. This is what `outfitter link --remove` needs: the settings file
 * itself is not Outfitter's to delete, but the entries it stamped are unambiguously identifiable.
 *
 * Returns no content when the document has nothing of Outfitter's in it, so an uninstall does not
 * rewrite files it never touched.
 */
export const stripManagedHooks = (existingRaw: string | undefined): HookDocumentMerge => {
  if (existingRaw === undefined) return {};

  let parsed: unknown;

  try {
    parsed = JSON.parse(existingRaw);
  } catch {
    return { error: 'could not be parsed as JSON; managed hooks were left in place' };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { error: 'is not a JSON object; managed hooks were left in place' };
  }

  const document = parsed as Record<string, unknown>;
  const existingHooks = document.hooks;

  if (existingHooks === null || typeof existingHooks !== 'object' || Array.isArray(existingHooks)) return {};

  const hooks = mergeManagedHooks(existingHooks as Record<string, unknown>, {});
  const content = `${JSON.stringify({ ...document, hooks }, null, 2)}\n`;

  return content === existingRaw ? {} : { content };
};
