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

Global instructions come from `~/.agents/AGENTS.md`, the canonical personal guidance file. If that file does not exist, Outfitter links no instructions and says nothing about it — create it first.

A cell marked "not supported" is a deliberate gap, not an oversight:

- **Copilot CLI** discovers skills in `~/.copilot/skills/`, but loads custom instructions from
  repository-scoped `AGENTS.md` files rather than a documented user-global path, and exposes no
  hook or custom-command surface.
- **Codex hooks** live in `config.toml` behind a separate trust prompt. Writing one on your behalf
  would pre-authorize code execution, so Outfitter leaves them to you.

Requesting an unsupported combination prints a warning; `--strict` makes it fatal.

## What Outfitter will and will not overwrite

Outfitter records every path it creates in an ownership manifest under
`$XDG_STATE_HOME/outfitter/links.json` (or `~/.local/state/outfitter/links.json`). Unless you pass
`--force`, a path absent from that manifest is never replaced or removed — even if it already points
exactly where Outfitter would have pointed it. Adopting such a path silently would make `--remove`
later delete something you wrote by hand.

The same applies to a path Outfitter _did_ create but you have since taken over: replace a managed
link with a real directory and Outfitter reports a conflict instead of deleting your directory.

An unmanaged path at a target location is reported as a conflict and left alone:

```text
  ! [claude/skills] /home/you/.claude/skills/research  (path exists and is not managed by Outfitter)
✗ Conflicting paths were left untouched. Move them aside, or re-run with --force.
```

`--force` is the single exception: it deletes whatever sits at the conflicting path — recursively,
if it is a directory — and replaces it, reporting each replacement.

Hooks work differently, because they merge into a settings file you also edit. Each generated entry
carries an `x-outfitter-managed` marker, so re-running replaces only Outfitter's own entries and
leaves your hand-written hooks and every other settings key in place. The merge rewrites the whole
document, so every key and value survives but the file comes back two-space-indented the first time
Outfitter touches it. Outfitter updates the file in place rather than replacing it, so a
`settings.json` that is a symlink into your dotfiles repository stays a symlink. A settings file
that cannot be parsed is reported and left alone.

## Reconciling and removing

`link` is idempotent: run it again after editing your catalog and only real differences change —
including hooks, where a merge that changes nothing leaves `settings.json` untouched, mtime and all. A skill
deleted from the catalog has its managed link pruned, and withdrawing your hook declarations strips
Outfitter's entries on the next run.

`outfitter link --remove` uninstalls: it removes every managed path, strips Outfitter's marked hook
entries from each settings document it merged into, and forgets the manifest. Settings files
themselves are never deleted, and nothing unmanaged is touched. Combine it with `--harness` to
uninstall one harness and leave the rest provisioned.

## Configuration

Everything is driven from the `harnesses` block in [settings](./settings.md).

Unlike every other settings block, this one is honored **only from your own `~/.agents/settings.yml`**
(and its `settings.local.yml` sibling). A project or a remote catalog cannot declare it. The block
installs shell commands and filesystem targets into configuration every future agent session loads,
so cloning a repository must not be able to change it.

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

See [`outfitter link`](./cli.md#outfitter-link) in the CLI reference for the full option list.

See also: [Hooks](./hooks.md), [Settings](./settings.md), [Adapter support matrix](./support-matrix.md).
