# Hooks

Hooks let deterministic code run at fixed points in an agent session — before tool calls, after edits, at session start — independent of what the model decides. The `.agents` protocol does not yet define a hooks resource, so hook wiring is harness-specific today. This page documents what works per adapter and where this is heading.

## Claude Code

Claude Code hooks live in its native `settings.json` (`hooks` key), matching tool events to shell commands. Outfitter projects hook configuration into the composite `settings.json` it generates for a Claude launch, so a composition can ship hooks the same way it ships skills:

- Keep hook scripts in a skill's `scripts/` directory or under `commands/`, so they travel with the tree and pass through the same [trust review](./catalogs.md#trust-and-review) as other executable content.
- Machine-specific hook configuration belongs in `settings.local.yml`-scoped composition, not in shared catalogs.

See the [Claude Code hooks documentation](https://code.claude.com/docs/en/hooks) for event types and matcher syntax.

## Pi

Pi supports a bootstrap hook via its extension mechanism: an extension passed with `--extension` runs at session start and can register tools, providers, and runtime behavior. Outfitter's own onboarding flow uses this channel. For recurring per-event behavior, Pi extensions are the native surface.

## Roadmap

> **TODO (protocol gap):** hooks are the one behavioral surface the pinned protocol revision does not model, which means hook definitions cannot yet be expressed portably in a `.agents` tree and projected per harness. Outfitter may need to ship its own hooks extension — a namespaced, optional resource that adapters translate to Claude `settings.json` hooks and Pi extensions respectively — or drive a hooks concept into a future protocol revision. Until one of those lands, treat hooks as harness-native configuration and keep them thin: call scripts that live in the tree rather than embedding logic in hook definitions.
