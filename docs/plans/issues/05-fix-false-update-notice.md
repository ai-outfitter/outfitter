---
title: Fix "update available" notice shown immediately after updating
labels: [bug, m1-ship-blockers, plan-2026-07]
size: S
---

## Problem

During the demo dry run (2026-07-01), an "update available" message appeared right after updating to the latest version. Undermines trust in the update mechanism and looks broken on camera.

## Scope

- Root-cause the version-check path (npm dist-tag lookup vs installed version, stale cache of the check result).
- Correct the comparison; suppress the notice when installed version >= latest.
- Unit-test the comparator including prerelease/equal/newer-local cases.

## Acceptance criteria

- After installing the latest release, no update notice is shown.
- Comparator unit tests cover equal, older, newer-local, and prerelease versions.

## References

- Demo dry-run transcript (2026-07-01)

## Investigation (2026-07-01)

**The notice comes from pi itself, not from Outfitter.** Outfitter contains no
update-check, version-comparison, or notice logic anywhere in `code/cli/src`,
`bin/`, or `scripts/` (verified by searching for npm dist-tag lookups, semver
comparisons, registry URLs, and "update available" strings).

Root cause chain:

1. Outfitter always launches its **bundled** pi
   (`code/cli/src/agents/AgentLaunch.ts`, `resolveAgentLaunchExecutable`
   resolves `@earendil-works/pi-coding-agent` from Outfitter's own
   `node_modules` and runs it through the current Node).
2. On every interactive startup pi runs `checkForNewPiVersion(this.version)`
   (`dist/modes/interactive/interactive-mode.js` → `dist/utils/version-check.js`
   in the pi package): it fetches `https://pi.dev/api/latest-version` fresh each
   launch (no cached result involved) and compares against the running pi's own
   version. The comparator itself is correct (proper major/minor/patch and
   prerelease handling).
3. The bundled pi is version-pinned by Outfitter's dependency (`^0.78.1` at the
   time of writing). Whenever pi.dev advertises a newer pi than the pinned copy,
   every Outfitter launch shows "Update Available … run `pi update`" — including
   immediately after updating Outfitter itself, which is exactly what the demo
   dry run hit. The instruction is also unactionable: `pi update` updates a
   global pi install, never the copy bundled inside Outfitter.

**Fix applied in Outfitter:** there is no Outfitter comparator or cache to fix,
but the false notice is still an Outfitter-context problem, so bundled pi
launches now set `PI_SKIP_VERSION_CHECK=1` (pi's own documented kill switch for
this check) in `resolveAgentLaunchExecutable`. Profile-controlled environment
values still override it. PATH-resolved agents are unaffected. Pi package-update
notices (`checkForPackageUpdates`, gated by `PI_OFFLINE`) remain enabled because
those are actionable.

**Upstream note:** the real update channel for the bundled pi is an Outfitter
release; if pi ever grows a "bundled/embedded" mode notice, this suppression can
be revisited.
