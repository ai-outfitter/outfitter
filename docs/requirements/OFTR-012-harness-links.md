# OFTR-012: Harness Links

## Overview

`outfitter link` projects the composed `.agents` tree into the persistent home directories of
Claude Code and Codex as managed links, so native harness sessions carry Outfitter-composed skills,
agents, commands, shared context, and MCP servers without a launch. This is the persistent
projection deferred by [#187](https://github.com/ai-outfitter/outfitter/issues/187); it is opt-in
and separate from the temporary projection `outfitter run` builds and removes per launch, and
`outfitter setup` does not create it. The user-facing description lives in
[docs/documentation/linking-harnesses.md](../documentation/linking-harnesses.md).

## Requirements

### OFTR-012.1: Scope Selection

1. `outfitter link` MUST accept repeatable `--harness <claude|codex>`, `--agent <id>`, and `--workflow <id>` options and the `--all`, `--dry-run`, `--remove`, and `--strict` flags, and MUST reject an unknown harness name with a non-zero exit.
2. The Claude Code home MUST resolve to `$CLAUDE_CONFIG_DIR` when set and non-empty, otherwise `~/.claude`; the Codex home MUST resolve to `$CODEX_HOME` when set and non-empty, otherwise `~/.codex`.
3. Without `--harness`, `link` MUST target every harness whose home directory exists, and MUST fail with guidance to pass `--harness` when none exists.
4. An explicit `--harness` MUST create the harness home when it does not exist.
5. Without `--agent`, `--workflow`, or `--all`, the scope MUST be every enabled workflow root from the merged `workflows` setting plus `default_agent` when set, and `link` MUST fail with guidance when that scope is empty.
6. `--workflow <id>` MUST reject a workflow that is not enabled in the merged `workflows` setting, and MUST otherwise add every agent in that workflow's closure to the scope.
7. `--agent <id>` MUST reject an agent that does not resolve in the effective resource set.
8. `--all` MUST add every resolvable agent to the scope.
9. Each scoped agent MUST be composed with the same composer used by `run` and `dump`, and every subagent it delegates to MUST join the closure transitively.
10. The closure MUST contain the skills and MCP servers selected by every composed agent, every catalog command, and every agent-local command of a scoped agent; a skill or command that escapes its layer root MUST be excluded, with a warning for skills.
11. `link` MUST fail before touching any harness home when settings are invalid or when any scoped agent fails to compose.

### OFTR-012.2: Harness Mapping

1. For Claude Code, `link` MUST plan `CLAUDE.md` as a symlink to the highest-precedence tree-root `agents.md` that exists, `skills/<slug>` as a symlink to each skill's winning directory, `agents/<slug>.md` as a generated file for each composed agent, `commands/<slug>.md` as a symlink to each command's winning file, and one user-scope MCP registration per selected server.
2. For Codex, `link` MUST plan `AGENTS.md` as a symlink to the same `agents.md`, `skills/<slug>` symlinks, `prompts/<slug>.md` as a symlink to each command's winning file, and one MCP registration per selected server.
3. Codex MUST NOT receive agent definitions; when the closure contains agents, the Codex plan MUST report one warning naming them.
4. A generated Claude agent file MUST carry frontmatter `name` and `description`, plus `model`, `thinking`, `tools`, `skills`, and `extensions` when the loadout sets them, followed by a marker identifying `outfitter link` as the generator and the composed identity body in composition order: system prompt, shared context, appended prompt fragments, then inherited agent bodies.
5. Prompt fragments MUST NOT be linked as standalone harness files; shared context MUST reach the harness only through the `CLAUDE.md` or `AGENTS.md` symlink and the generated agent bodies.
6. When no layer provides a tree-root `agents.md`, `link` MUST plan no shared-context entry.
7. `link` MUST NOT create, modify, or plan entries for harness authentication, session, `settings.json`, or plugin state.

### OFTR-012.3: Conflict Preservation and Ownership

1. `link` MUST record every entry it creates or updates in `<harness home>/.outfitter/links.json`, and MUST remove that manifest and its directory when no entries remain.
2. `link` MUST NOT overwrite, replace, adopt, or delete any file, directory, or symlink that the manifest does not record.
3. A planned symlink or file whose path holds an unmanaged file, directory, or symlink (including an unmanaged symlink to a different target) MUST report `conflict` and leave the path untouched.
4. A planned entry whose parent path segment is an unmanaged symlink MUST report `conflict` with a message naming that ancestor and instructing the user to unlink it.
5. A planned symlink or file MUST report `created` when the path is absent, `unchanged` when the existing entry already matches the planned target or content, and `updated` only when the manifest owns the path and its target or content differs.
6. A manifest symlink that is not in the current plan MUST be removed and reported `pruned` only when its target no longer exists; every other manifest entry not in the plan MUST be retained in the manifest and left in place.
7. A manifest entry that exits the plan MUST NOT be deleted from the harness home by a non-`--remove` run unless it is a dangling symlink.
8. `--strict` MUST exit 1 when any warning, `conflict`, or `skipped` entry is reported and MUST exit 0 otherwise; without `--strict`, conflicts and skips MUST exit 0.

### OFTR-012.4: Idempotent Reconciliation, Dry Run, and Removal

1. Running `link` twice with an unchanged tree and selection MUST report every entry `unchanged` on the second run and MUST leave the harness home and manifest byte-identical.
2. After the tree changes, a rerun MUST report `updated` for owned entries whose target or content changed, `created` for new closure members, and `pruned` for owned symlinks whose targets vanished.
3. `--dry-run` MUST report `would create`, `would update`, and `would prune` in place of the applied statuses, MUST NOT create, modify, or delete any file, symlink, directory, or manifest, and MUST invoke no harness CLI command other than `mcp get`.
4. `--remove` MUST remove exactly the manifest entries: symlinks that are still symlinks, generated files that are still regular files, and MCP servers through the harness `mcp remove` command; an entry no longer in its recorded form MUST be reported `skipped` and left alone.
5. `--remove` MUST forget every removed entry; an MCP entry whose harness CLI is not on `PATH` MUST be reported `skipped` and retained in the manifest.
6. After `--remove`, the `skills`, `agents`, `commands`, and `prompts` directories MUST be removed only when each is an empty real directory; a non-empty or symlinked directory MUST be left in place.
7. `--remove` MUST NOT touch any path the manifest does not record.

### OFTR-012.5: MCP Registration

1. `link` MUST register MCP servers only through the harness's own CLI: `claude mcp add-json <id> <json> --scope user` for Claude Code and `codex mcp add <id> ...` for Codex.
2. Before adding, `link` MUST query `<harness> mcp get <id>`; a server the harness already reports MUST be reported `unchanged`, MUST NOT be added or modified, and MUST NOT be newly recorded in the manifest.
3. When the harness CLI is not on `PATH`, every MCP entry MUST be reported `skipped` and MUST NOT be recorded in the manifest.
4. A failed `mcp add` MUST be reported `skipped` with the command's first output line, except that a server the harness reports through `mcp get` after the failed add MUST be treated as `created`.
5. For Codex stdio servers, `link` MUST pass the command and string arguments after `--` and each string `env` entry as `--env NAME=VALUE`; an `env` value containing a `${VAR}` reference MUST be dropped with a warning naming the entry.
6. For Codex HTTP servers, `link` MUST pass `--url`; an `Authorization: Bearer ${VAR}` header MUST become `--bearer-token-env-var VAR`, and every other header MUST be dropped with a warning naming the header.
7. A Codex server id containing characters outside `[A-Za-z0-9_-]`, or a definition with neither `url` nor `command`, MUST be reported `skipped` with a warning and MUST NOT be registered.
8. When two composed agents define the same MCP server id differently, `link` MUST register the first definition in closure order and warn about the difference.
9. `--remove` MUST unregister owned servers with `claude mcp remove <id> --scope user` or `codex mcp remove <id>`, and MUST NOT unregister servers the manifest does not record.
