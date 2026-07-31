# Hooks

Hooks let deterministic code run at fixed points in an agent session — before tool calls, after edits, at session start — independent of what the model decides. The `.agents` protocol does not yet define a hooks resource, so hook wiring is harness-specific today. This page documents what works per adapter and where this is heading.

## Claude Code

Claude Code hooks live in its native `settings.json` (`hooks` key), matching tool events to shell commands. Outfitter projects hook configuration into the composite `settings.json` it generates for a Claude launch, so a composition can ship hooks the same way it ships skills:

- Keep hook scripts in a skill's `scripts/` directory or under `commands/`, so they travel with the tree and pass through the same [trust review](./catalogs.md#trust-and-review) as other executable content.
- Machine-specific hook wiring stays in your local layer and is projected as harness-native config (the Claude `settings.json` Outfitter composes for that launch), not in a `settings.yml` key — the protocol schema defines no hooks field. Keep it out of shared catalogs.

See the [Claude Code hooks documentation](https://code.claude.com/docs/en/hooks) for event types and matcher syntax.

## Pi

Pi supports a bootstrap hook via its extension mechanism: an extension passed with `--extension` runs at session start and can register tools, providers, and runtime behavior. Outfitter's own onboarding flow uses this channel. For recurring per-event behavior, Pi extensions are the native surface.

## Portable hooks for linked harnesses

[`outfitter link`](./linking.md) closes part of this gap for the persistent path. The `harnesses.hooks`
settings block expresses a hook once in harness-neutral terms, and each adapter translates it into
that harness's native event names:

```yaml
# ~/.agents/settings.yml
harnesses:
  hooks:
    - event: before_tool
      matcher: Bash
      command: ~/.agents/scripts/guard-bash.sh
```

Claude Code and Gemini CLI use a structurally identical hook envelope and differ only in event
naming, so `before_tool` becomes `PreToolUse` for Claude and `BeforeTool` for Gemini. An event with
no native equivalent is reported rather than mapped to an approximate one — see the
[event table](./linking.md#hook-events).

Generated entries carry an `x-outfitter-managed` marker so re-linking replaces only Outfitter's own
entries and never disturbs hand-written hooks in the same settings file.

This covers hooks for harnesses Outfitter links persistently. It is settings-level configuration, not
a protocol resource: a hook still cannot travel inside a shared `.agents` catalog — and deliberately
so. The block is honored only from your own `~/.agents` settings, because a hook a project could
declare would become a shell command every future agent session runs on your machine.

## Roadmap

> **TODO (protocol gap):** hooks are the one behavioral surface the pinned protocol revision does not model, which means hook definitions cannot yet be expressed portably in a `.agents` tree and projected per harness. The path `agents/<agent-id>/hooks/<hook-id>/` is reserved for a future agent-local hook entity and deliberately has no resolution or projection behavior today. Outfitter may need to ship its own hooks extension that adapters translate to Claude `settings.json` hooks and Pi extensions respectively, or drive the concept into a future protocol revision. Until one of those lands, treat hooks as harness-native configuration and keep them thin: call scripts that live in the tree rather than embedding logic in hook definitions.
