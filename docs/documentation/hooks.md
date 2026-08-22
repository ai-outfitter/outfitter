# Hooks

Hooks run deterministic code at fixed points in an agent session. The model does not decide when a hook runs.

## Portable workspace hooks

Outfitter v1 discovers hooks only from the active workspace:

```text
.agents/
└── hooks/
    └── catalog-authoring/
        ├── hook.yml
        └── scripts/
            └── remind.py
```

Outfitter does not discover portable hooks from `~/.agents`, configured sources, or `agents/<agent>/hooks/`. It reads hooks in slug order. It validates each manifest. It then captures all regular package files in the composition. A file change after composition does not change the active launch.

```yaml
version: 1
name: catalog-authoring
description: Remind the agent to update catalog metadata.
events:
  stop:
    command: ./scripts/remind.py
    args: []
    timeout_seconds: 30
```

V1 supports the `stop` event. The manifest name must match the directory slug. A command must start with `./`. It must name an executable regular file inside its package. The package must not contain symlinks. Outfitter runs the command with its argument array. It does not use a shell. The command working directory is the active workspace.

Each command receives one normalized JSON object on stdin:

```json
{
  "version": 1,
  "event": "stop",
  "harness": "claude",
  "workspace": "/workspace/project",
  "hook": {
    "slug": "catalog-authoring",
    "name": "catalog-authoring"
  },
  "continuation": {
    "active": false,
    "supported": true
  }
}
```

The command must use these exit codes:

- Exit 0 allows the session to stop.
- Exit 2 requests one more agent turn. Outfitter uses command output as the reason.
- Any other exit, timeout, signal, or launch error produces a warning. Outfitter fails open.

The `continuation.active` value tells the command that a prior stop hook caused the current turn. Claude supplies this state as `stop_hook_active`. Outfitter fails open if a Claude hook requests continuation again while this state is active. The Pi adapter keeps equivalent state and rejects a second consecutive continuation request. Both guards prevent loops.

Outfitter projects the event as follows:

- Claude inherited mode loads temporary plugin hooks. Claude isolated mode writes temporary settings. Outfitter does not change `~/.claude` settings.
- Pi loads a temporary extension through `--extension`. The extension maps `agent_end` to `stop` and sends an exit-2 reason as a follow-up message.
- Codex produces a compatibility warning and does not attach the hook. Codex 0.147 reads a project hook from the durable `.codex/hooks.json` path. Its CLI does not provide an alternate hook-file flag for Outfitter's temporary runtime. A session hook also needs review and trust for its exact command. The temporary dispatcher path changes on each run, so Outfitter cannot reuse that trust safely. The legacy `notify` command cannot request continuation and has one user-owned slot. Outfitter does not write `.codex/hooks.json`, replace `notify`, or bypass hook trust. `--strict` makes this warning fatal. See the [Codex hooks documentation](https://developers.openai.com/codex/hooks).

Only `outfitter run` projects these hooks. A direct `claude`, `codex`, or `pi` launch does not run them.

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

Extension entries must be absolute paths that already exist. Outfitter resolves source-directory, hook-document, and extension symlinks to physical paths before loading them; a dangling link is fatal, and `OUTFITTER_SYSTEM_HOOK_SOURCE` records the physical source directory. Package and Git specifiers are rejected, so a launch never installs a system extension from the network. Only `name` and `harnesses` are accepted at the document root, and each harness entry can contain only `extensions` and `env`; a system hook cannot select an agent, harness, model, tool, skill, or prompt.

For Pi, Outfitter prepends the configured `--extension <path>` arguments after projection on every launch, including `--mode rpc`, print, and other non-interactive launches. Hook documents cannot name the Outfitter-controlled `PI_CODING_AGENT_DIR` or `PI_CODING_AGENT_SESSION_DIR` variables. They also reject `NODE_OPTIONS`, `NODE_REPL_EXTERNAL_MODULE`, `OPENSSL_CONF`, `LD_PRELOAD`, `LD_AUDIT`, `LD_LIBRARY_PATH`, and every `DYLD_*` variable because those can change process loading before Pi starts. Other hook environment is below the launch plan's own environment but above the parent process environment at spawn. `harnesses.claude` and `harnesses.codex` documents validate but are ignored with a warning; Outfitter has no equivalent extension argument for those adapters. Their native managed configuration is the stronger policy surface.

### Launcher scope, not managed scope

This mechanism changes who owns the file that names an extension. It does not change Pi's configuration resolution because Pi never reads the system hook document. The accurate guarantee is **collection is on by default and the organization owns the configuration**, not that the session cannot turn collection off.

The `--no-extensions` option does not disable explicitly passed `--extension` paths, so it does not bypass a system hook. A session can still execute Outfitter's bundled Pi binary directly, never going through the Outfitter launcher, or set `OUTFITTER_SYSTEM_DIR` to an empty directory. Every launch whose platform resolves a hook directory records that choice in `OUTFITTER_SYSTEM_HOOK_SOURCE`: the normal value is the resolved physical system path, while an override is stamped as `env-override:<resolved-physical-path>`. Downstream evidence can therefore distinguish the normal system source from the session-settable bypass.

The normal Linux and macOS directories are root-owned. Outfitter deliberately fails closed on their operator errors: a malformed file should fail on a canary boot, while failing open could silently produce fleet sessions without collection. Those sessions must be treated as unattested rather than clean.

## Agent-local hook roadmap

The path `agents/<agent-id>/hooks/<hook-id>/` remains reserved. Outfitter does not resolve or project it. V1 hooks apply to every Outfitter session that starts in the workspace.
