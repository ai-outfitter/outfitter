# Linking harnesses

`outfitter link` provisions your installed coding harnesses from the resolved `.agents` catalog, so
`claude`, `codex`, `gemini`, and `copilot` see your skills, commands, instructions, and hooks when
you run them directly — no `outfitter run` wrapper involved.

This is the persistent counterpart to [`outfitter run`](./cli.md#outfitter-run-agent-args). `run`
assembles a temporary composite directory and deletes it when the harness exits. `link` writes into
the directories the harness itself owns, then exits.

## Why it exists

Every harness reads a different user-global config directory, so keeping one catalog visible in all
of them means hand-maintaining a pile of symlinks. Those drift in ways that fail quietly: a second
config directory gets missed, a renamed skill leaves a dangling link, and a harness needing a
translated format gets a symlink that never loads.

## Quick start

```bash
outfitter link --dry-run   # see exactly what would change
outfitter link             # apply it
```

By default Outfitter provisions only harnesses whose config directory already exists, so it never
creates configuration for a CLI you have not installed.

## What each harness gets

All four harnesses discover skills the same way — `<config>/skills/<slug>/SKILL.md` with YAML
frontmatter — so skills project as plain per-skill symlinks and stay live-editable. The formats that
actually differ are commands and hooks.

| Resource            | Claude Code               | Codex CLI                | Gemini CLI                           | Copilot CLI          |
| ------------------- | ------------------------- | ------------------------ | ------------------------------------ | -------------------- |
| Skills              | `skills/<slug>` link      | `skills/<slug>` link     | `skills/<slug>` link                 | `skills/<slug>` link |
| Commands            | `commands/<slug>.md` link | `prompts/<slug>.md` link | `commands/<slug>.toml` **generated** | Not supported        |
| Global instructions | `CLAUDE.md` link          | `AGENTS.md` link         | `GEMINI.md` link                     | Not supported        |
| Hooks               | `settings.json` merge     | Not written              | `settings.json` merge                | Not supported        |

Global instructions come from `~/.agents/AGENTS.md`, the canonical personal guidance file.

A cell marked "not supported" is a deliberate gap, not an oversight:

- **Copilot CLI** discovers skills in `~/.copilot/skills/`, but loads custom instructions from
  repository-scoped `AGENTS.md` files rather than a documented user-global path, and exposes no
  hook or custom-command surface.
- **Codex hooks** live in `config.toml` behind a separate trust prompt. Writing one on your behalf
  would pre-authorize code execution, so Outfitter leaves them to you.

Requesting an unsupported combination prints a warning; `--strict` makes it fatal.

## Nothing of yours is overwritten

Outfitter records every path it creates in an ownership manifest under
`$XDG_STATE_HOME/outfitter/links.json` (or `~/.local/state/outfitter/links.json`). A path absent
from that manifest is never replaced or removed — even if it already points exactly where Outfitter
would have pointed it. Adopting such a path silently would make `--remove` later delete something
you wrote by hand.

An unmanaged path at a target location is reported as a conflict and left alone:

```text
  ! [claude/skills] /home/you/.claude/skills/research  (path exists and is not managed by Outfitter)
✗ Conflicting paths were left untouched. Move them aside, or re-run with --force.
```

Hooks are the exception to path ownership, because they merge into a settings file you also edit.
Each generated entry carries an `x-outfitter-managed` marker, so re-running replaces only Outfitter's
own entries and leaves your hand-written hooks and every other settings key untouched. A settings
file that cannot be parsed is reported and left alone rather than replaced.

## Reconciling and removing

`link` is idempotent: run it again after editing your catalog and only real differences change —
including hooks, where an unchanged merge leaves `settings.json` byte-for-byte untouched. A skill
deleted from the catalog has its managed link pruned, and withdrawing your hook declarations strips
Outfitter's entries on the next run.

`outfitter link --remove` uninstalls: it removes every managed path, strips Outfitter's marked hook
entries from each settings document it merged into, and forgets the manifest. Settings files
themselves are never deleted, and nothing unmanaged is touched.

## Configuration

Everything is driven from the `harnesses` block in [settings](./settings.md), so it follows the
usual precedence — project-local over project over user.

```yaml
# ~/.agents/settings.yml
harnesses:
  # 'detected' (default), 'none', or an explicit list.
  link: [claude, codex, gemini, copilot]

  # Harness-neutral hooks, translated to each harness's native event names.
  hooks:
    - event: before_tool
      matcher: Bash
      command: ~/.agents/scripts/guard-bash.sh

  # Per-harness overrides, applied over the selection above.
  claude:
    resources: [skills, instructions]
    # One harness can have several live config roots — CLAUDE_CONFIG_DIR makes
    # a second profile a real directory that would otherwise be skipped.
    config_directories: ['~/.claude', '~/.claude-work']
```

### Hook events

Hook declarations are harness-neutral and translated per harness. An event with no native
equivalent is reported rather than mapped to an approximate one.

| Neutral event   | Claude Code    | Gemini CLI     |
| --------------- | -------------- | -------------- |
| `before_tool`   | `PreToolUse`   | `BeforeTool`   |
| `after_tool`    | `PostToolUse`  | `AfterTool`    |
| `session_start` | `SessionStart` | `SessionStart` |
| `session_end`   | `SessionEnd`   | `SessionEnd`   |
| `notification`  | `Notification` | `Notification` |
| `before_agent`  | —              | `BeforeAgent`  |
| `after_agent`   | —              | `AfterAgent`   |

Claude Code has no before-agent event, and its `Stop` event is close to Gemini's `AfterAgent` but
not equivalent, so it is deliberately left unmapped — silently changing when your hook fires would
be worse than reporting the gap.

## Options

| Option            | Description                                                               |
| ----------------- | ------------------------------------------------------------------------- |
| `--harness <ids>` | Comma-separated harnesses to provision, narrowing the settings selection. |
| `--dry-run`       | Show what would change; write nothing, including the manifest.            |
| `--remove`        | Remove every managed path and forget the manifest.                        |
| `--force`         | Replace paths Outfitter does not manage. Off by default.                  |
| `--strict`        | Treat unsupported resource/harness combinations as failures.              |
| `--json`          | Emit the plan and result as JSON.                                         |

See also: [Hooks](./hooks.md), [Settings](./settings.md), [Adapter support matrix](./support-matrix.md).
