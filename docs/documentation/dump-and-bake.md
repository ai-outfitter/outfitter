# Dump and bake

Bake and dump are the two outputs of Outfitter's resolver — the same resolver that backs `list`, `validate`, and `run`, so what you inspect is exactly what executes.

## Task bake

`outfitter task bake <id>` resolves a [task](./tasks.md) and everything it depends on into an **immutable execution artifact**:

1. Explicit pinned remote sources.
2. The global (`~/.agents/`) and workspace (`<project>/.agents/`) layers.
3. The selected task.
4. Its ordered personas and selected skills, subagents, and jobs.
5. Model, MCP, knowledge, command, and harness configuration.
6. Structured invocation inputs, validated against the task's contract.

The result is backed by a self-contained `.agents/` tree: every referenced resource is materialized, every slug resolved, nothing left to look up at run time. `outfitter run --task <id>` uses this same bake path before launching the harness, and the [GitHub Actions adapter](./actions.md) always executes baked tasks — CI never re-derives composition logic.

Given identical sources, refs, selections, and inputs, a bake is deterministic. That makes baked artifacts cacheable and comparable: two runs from the same bake differ only in what the model did, not in what it was given.

## Dump

`outfitter dump` writes the composed resource tree as a plain `.agents/` directory you can commit, diff, and review through a normal pull request:

```bash
outfitter dump --out ./review
outfitter dump --task issue-triage --out ./baked   # one task's transitive closure only
```

Use dumps to:

- **Review** exactly what an organization or project composition resolves to before approving a source bump.
- **Vendor** a self-contained tree into a repository for air-gapped or provenance-sensitive environments.
- **Debug** layer and merge behavior by diffing dumps before and after a change.

## Guarantees

- **Deterministic** — identical sources, refs, selections, and inputs produce byte-identical output.
- **Self-contained** — the dumped tree resolves with no remote sources and no cache.
- **Safe** — a dump may include reviewable source provenance, but never credentials, auth state, sessions, transcripts, caches, backups, mutable harness state, or symlinks escaping the tree.
- **Protocol-shaped** — the output is a valid `.agents` payload usable by any protocol consumer, not just Outfitter. Any Outfitter-specific provenance metadata is namespaced, JSON-based, and removable without losing the underlying resources.
