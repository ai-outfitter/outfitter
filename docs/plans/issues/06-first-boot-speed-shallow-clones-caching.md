---
title: 'First-boot speed follow-ups: shallow catalog clones, extension cache refresh, progress output'
labels: [enhancement, m1-ship-blockers, plan-2026-07]
size: M
---

## Problem

v0.7.1 (`4f1b2bb`) added `PiExtensionCache`: git extensions are shallow-cloned (`--depth 1`) and cached under `~/.outfitter/cache/extensions/git/<hash>` with deps installed once — a big first-boot win. Three gaps remain:

1. **Catalog clones are still full clones.** `createGitSynchronizer` runs `git clone --` with no `--depth` (`code/cli/src/cli/commands/SyncCommand.ts`). Cheap for default-profiles; expensive for large org catalogs.
2. **The git-extension cache never refreshes.** `materializePiExtensionSource` returns the cached path whenever it exists (`PiExtensionCache.ts`) — a `git:` extension tracking a branch never receives updates, and `outfitter sync` does not touch this cache. This is a new staleness bug introduced by the perf work.
3. **Materialization is silent and blocking.** Clones and `npm ci` run via `spawn.sync` with `stdio: 'pipe'` — zero output before launch. First boot with several git extensions reproduces the "is it hung?" experience from the 2026-07-01 demo dry run, now at the outfitter layer.

## Scope

- Shallow-clone catalog sources in `createGitSynchronizer` (`--depth 1 --single-branch`); verify `fetch` + `pull --ff-only` and `ref` checkout still work against shallow caches.
- Define and implement a refresh policy for the git-extension cache: refresh on `outfitter sync` (and/or TTL); pinned `#ref` entries stay immutable; document the policy.
- Progress output during extension materialization and catalog sync (per-source "cloning…/installing…" lines), so no silent multi-second stall precedes launch.
- Keep/confirm cold-boot timing measurement in the packaged E2E smoke (issue 07).

## Acceptance criteria

- Catalog cache directories contain shallow clones; sync/update paths tested against them.
- `outfitter sync` refreshes branch-tracking git extensions; `#ref`-pinned entries untouched; test coverage for both.
- Any network/build step prints progress; no silent stall > ~2s before launch.
- Cold first boot < 60s on normal broadband (excluding model login); warm boot does no clone/build work.

## References

- `code/cli/src/agents/pi/PiExtensionCache.ts` (v0.7.1, `4f1b2bb`)
- `code/cli/src/cli/commands/SyncCommand.ts` (`createGitSynchronizer`)
- Demo dry-run transcript (2026-07-01)
