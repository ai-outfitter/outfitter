# Hooks

Hooks let deterministic code run at fixed points in an agent session — before tool calls, after edits, at session start — independent of what the model decides. The `.agents` protocol does not yet define a hooks resource, so hook wiring is harness-specific today. This page documents what works per adapter and where this is heading.

## Claude Code

Claude Code hooks live in its native `settings.json` (`hooks` key), matching tool events to shell commands. Outfitter projects hook configuration into the composite `settings.json` it generates for a Claude launch, so a composition can ship hooks the same way it ships skills:

- Keep hook scripts in a skill's `scripts/` directory or under `commands/`, so they travel with the tree and pass through the same [trust review](./catalogs.md#trust-and-review) as other executable content.
- Machine-specific hook wiring stays in your local layer and is projected as harness-native config (the Claude `settings.json` Outfitter composes for that launch), not in a `settings.yml` key — the protocol schema defines no hooks field. Keep it out of shared catalogs.

See the [Claude Code hooks documentation](https://code.claude.com/docs/en/hooks) for event types and matcher syntax.

## Pi

Pi supports a bootstrap hook via its extension mechanism: an extension passed with `--extension` runs at session start and can register tools, providers, and runtime behavior. Outfitter's own onboarding flow uses this channel. For recurring per-event behavior, Pi extensions are the native surface.

## System extension hooks

An organization can make a local Pi observer load by default on every `outfitter run` by installing a system extension hook. Outfitter reads hook documents in lexical filename order from:

1. `$OUTFITTER_SYSTEM_DIR/*.yml` when the variable is set (the test/development seam), or
2. `/etc/outfitter/system.d/*.yml` on Linux, or
3. `/Library/Application Support/Outfitter/system.d/*.yml` on macOS.

Each file contributes extensions and environment additively; files do not override each other. Reusing the same environment key for the same harness in two files is an error rather than an implicit precedence rule. An absent directory is a no-op. An unreadable or malformed document, including one naming an extension path that does not exist, aborts the run whether or not `--strict` is set.

```yaml
name: pensieve
harnesses:
  pi:
    extensions:
      - /nix/store/example-pensieve/lib/pensieve/collectors/pi
    env:
      PENSIEVE_SINK: https://pensieve.example.com
      PENSIEVE_INSTALL_SCOPE: launcher
```

Extension entries must be absolute paths that already exist. Package and Git specifiers are rejected, so a launch never installs a system extension from the network. Only `name` and `harnesses` are accepted at the document root, and each harness entry can contain only `extensions` and `env`; a system hook cannot select an agent, harness, model, tool, skill, or prompt.

For Pi, Outfitter prepends the configured `--extension <path>` arguments after projection on every launch, including `--mode rpc`, print, and other non-interactive launches. Hook documents cannot name the Outfitter-controlled `PI_CODING_AGENT_DIR` or `PI_CODING_AGENT_SESSION_DIR` variables. They also reject `NODE_OPTIONS`, `NODE_REPL_EXTERNAL_MODULE`, `LD_PRELOAD`, `LD_AUDIT`, `LD_LIBRARY_PATH`, and every `DYLD_*` variable because those can change process loading before Pi starts. Other hook environment is below the launch plan's own environment but above the parent process environment at spawn. `harnesses.claude` and `harnesses.codex` documents validate but are ignored with a warning; Outfitter has no equivalent extension argument for those adapters. Their native managed configuration is the stronger policy surface.

### Launcher scope, not managed scope

This mechanism changes who owns the file that names an extension. It does not change Pi's configuration resolution because Pi never reads the system hook document. The accurate guarantee is **collection is on by default and the organization owns the configuration**, not that the session cannot turn collection off.

A session can still pass `pi --no-extensions`, execute Outfitter's bundled Pi binary directly, or set `OUTFITTER_SYSTEM_DIR` to an empty directory. Every launch whose platform resolves a hook directory records that choice in `OUTFITTER_SYSTEM_HOOK_SOURCE`: the normal value is the system path, while an override is stamped as `env-override:<path>`. Downstream evidence can therefore distinguish the normal system source from the session-settable bypass.

The normal Linux and macOS directories are root-owned. Outfitter deliberately fails closed on their operator errors: a malformed file should fail on a canary boot, while failing open could silently produce fleet sessions without collection. Those sessions must be treated as unattested rather than clean.

## Roadmap

> **TODO (protocol gap):** hooks are the one behavioral surface the pinned protocol revision does not model, which means hook definitions cannot yet be expressed portably in a `.agents` tree and projected per harness. The path `agents/<agent-id>/hooks/<hook-id>/` is reserved for a future agent-local hook entity and deliberately has no resolution or projection behavior today. Outfitter may need to ship its own hooks extension that adapters translate to Claude `settings.json` hooks and Pi extensions respectively, or drive the concept into a future protocol revision. Until one of those lands, treat hooks as harness-native configuration and keep them thin: call scripts that live in the tree rather than embedding logic in hook definitions.
