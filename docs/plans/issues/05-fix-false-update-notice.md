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
