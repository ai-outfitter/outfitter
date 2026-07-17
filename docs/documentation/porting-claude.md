# Porting a Claude Code setup

If your agent configuration lives in `~/.claude`, Outfitter can port it into `~/.agents/` — the protocol's global layer — and symlink it back so Claude Code keeps working natively while the `.agents` tree becomes the source of truth.

```bash
outfitter setup
```

Setup detects an existing `~/.claude` directory (when no `~/.agents/` tree exists yet) and offers the port. Nothing is destroyed: originals are moved, not copied-and-diverged, and the symlinks keep native Claude Code behavior identical.

## What gets ported

| `~/.claude` content      | `~/.agents/` destination | Symlinked back? |
| ------------------------ | ------------------------ | --------------- |
| `agents/<id>.md`         | `agents/<id>/agent.md`   | Yes             |
| `skills/<id>/`           | `skills/<id>/`           | Yes             |
| `commands/`              | `commands/`              | Yes             |
| `CLAUDE.md`              | `agents.md`              | Yes             |
| MCP server configuration | `mcp.json`               | Yes             |

After the port, `~/.claude/skills` is a symlink into `~/.agents/skills`, and so on — Claude Code reads exactly what it read before, from the protocol tree. Editing either view edits the same files.

## What stays native

Runtime and account state is not configuration and stays in `~/.claude` untouched:

- auth and account state
- sessions and project history (`projects/`)
- plugins, caches, debug output
- `settings.json` — permissions, model, and hooks remain harness-native; see [Hooks](./hooks.md) for how hook wiring relates to the tree

This is the same boundary [state persistence](./state.md) enforces at run time: configuration lives in the tree, mutable state lives with the harness.

## After porting

Your resources are now protocol resources. Reference them by slug from an agent's loadout like anything else:

```
<!-- ~/.agents/agents/daily/agent.md -->
---
name: daily
skills: [wiki, code-review] # formerly ~/.claude/skills/*
---
```

- `outfitter list` shows everything that resolved from the ported tree.
- `outfitter run daily --harness claude` launches Claude Code through Outfitter with the same material, now composable with catalogs and other layers.
- Plain `claude` continues to work as before, through the symlinks.

Consider putting `~/.agents` under version control as a standalone repository — see [Local development](./local-development.md).

## Projects

The same port applies per project: a `<repo>/.claude` directory ports to `<repo>/.agents/` (the workspace layer) with symlinks back, and a `CLAUDE.md` at the repo root can become `.agents/agents.md`. Commit the `.agents/` tree; gitignore `.agents/settings.local.yml`.
