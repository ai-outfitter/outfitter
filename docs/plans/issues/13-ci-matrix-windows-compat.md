---
title: CI matrix (ubuntu/macos/windows) + Windows compatibility pass
labels: [enhancement, testing, m2-hardening, plan-2026-07]
size: L
---

## Problem

CI runs on `ubuntu-latest` only (`.github/workflows/ci.yml:13`) while the runtime is symlink-centric (`StatePersistence.ts:213` uses `symlinkSync`, which requires Developer Mode/admin on Windows) and uses `process.env.HOME` fallbacks (`PiAdapter.ts:418,435`) that are undefined on Windows. macOS happens to work but nothing enforces it.

## Scope

- Matrix CI across ubuntu, macos, windows for unit + integration suites (and the packaged smoke where feasible).
- Replace `process.env.HOME` with `os.homedir()` throughout.
- Symlink fallback strategy on Windows (junctions for dirs; copy+writeback or warn for files) or an explicit, tested "Windows unsupported" gate with a clear error.
- Document the actual support level in README.

## Acceptance criteria

- CI green on all three OSes, or Windows explicitly marked unsupported in README with a tracking issue and a clean error at runtime.
- No `process.env.HOME` reads remain in `src/`.

## References

- `.github/workflows/ci.yml:13`
- `code/cli/src/compositeProfile/StatePersistence.ts:213`
- `code/cli/src/agents/PiAdapter.ts:418,435`
