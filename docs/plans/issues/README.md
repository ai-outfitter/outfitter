# Local issue drafts (2026-07 update plan)

Draft GitHub issues for the [2026-07-01 update plan](../2026-07-01-update-plan.md). **Local only for now** — iterate here; nothing is filed until we explicitly run the filing script.

## Format

One file per issue: `NN-slug.md`. YAML frontmatter carries the metadata; everything after the `---` is the verbatim GitHub issue body.

```yaml
---
title: <issue title>
labels: [<type>, <milestone-label>, plan-2026-07]
size: S|M|L
depends_on: [<issue numbers>] # optional
---
```

Milestone labels: `m1-ship-blockers`, `m2-hardening`, `m3-claude-parity`, `m4-docs`, `m5-strategic`.

## Filing later

`node scripts/file-issues.mjs` — dry-run by default (prints what would be created). Use `--file` to actually create issues via `gh`, `--only 01,03` to file a subset. Requires the labels to exist (script creates missing ones with `--file`).

## Index

| #      | Issue                                                                                                                                                     | Milestone | Size |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---- |
| 01     | Bundle offline default profile; degrade gracefully when catalog sync fails                                                                                | M1        | M    |
| 02     | Remove hardcoded bootstrap model from onboarding                                                                                                          | M1        | S–M  |
| ~~03~~ | ~~Fix onboarding regression: stale flow~~ — fixed in v0.7.2 (`a380826`); onboarding also force-syncs the catalog                                          | —         | —    |
| ~~04~~ | ~~Fix extension sources pointing at the old repo~~ — fixed in default-profiles (`c413d75` + shortcut-conflict follow-ups)                                 | —         | —    |
| 05     | Fix "update available" notice shown immediately after updating                                                                                            | M1        | S    |
| 06     | First-boot speed follow-ups: shallow catalog clones, extension cache refresh, progress output (re-scoped after v0.7.1 `4f1b2bb` landed extension caching) | M1        | M    |
| 07     | Add packaged E2E smoke test to CI                                                                                                                         | M1        | M    |
| 08     | Record and publish the research-preview demo video                                                                                                        | M1        | M    |
| 09     | Extract Pi onboarding extension into code/pi-extension as typed TS                                                                                        | M2        | L    |
| 10     | Implement the `prompt` state-persistence strategy                                                                                                         | M2        | M    |
| 11     | Near-real-time undeclared-write detection + crash coverage                                                                                                | M2        | M    |
| 12     | Clean up composite temp dirs on exit                                                                                                                      | M2        | S    |
| 13     | CI matrix (ubuntu/macos/windows) + Windows compatibility pass                                                                                             | M2        | M–L  |
| 14     | Amend OFTR-001.5 and remove dead dependencies                                                                                                             | M2        | S    |
| 15     | Decompose SetupCommand/PiLoginLaunch; remove lint escape hatches                                                                                          | M2        | L    |
| 16     | Build and publish the Docker image from CI                                                                                                                | M2        | S–M  |
| 17     | Claude adapter: MCP composition                                                                                                                           | M3        | M    |
| 18     | Claude adapter: map generic skills control                                                                                                                | M3        | M    |
| 19     | Claude adapter: first-run/login onboarding path                                                                                                           | M3        | M–L  |
| 20     | Claude adapter: control mapping completeness                                                                                                              | M3        | M    |
| 21     | Cross-adapter conformance test suite                                                                                                                      | M3        | M–L  |
| 22     | Fix typo'd doc paths (archtecture, orginization)                                                                                                          | M4        | S    |
| 23     | Rewrite philosophy.md                                                                                                                                     | M4        | S    |
| 24     | Expand profile catalog docs + trust model                                                                                                                 | M4        | M    |
| 25     | Reconcile AGENTS.md, mark superseded plans, scrub leaked paths                                                                                            | M4        | S    |
| 26     | Add Concepts page and CLI command reference                                                                                                               | M4        | M    |
| 27     | Single docs home: doc site renders docs/documentation                                                                                                     | M4        | M–L  |
| 28     | Surface Supported-vs-Roadmap status in user docs                                                                                                          | M4        | S    |
| 29     | Differentiation & SEO pass (keep the name)                                                                                                                | M5        | S    |
| 30     | Ecosystem listings & Pi community presence                                                                                                                | M5        | S    |
| 31     | State the licensing split publicly                                                                                                                        | M5        | S    |
| 32     | Org-catalog governance features: design spec                                                                                                              | M5        | M    |
| 33     | Persona-profiles showcase                                                                                                                                 | M5        | M    |
| 34     | Federated-context pattern: worked example                                                                                                                 | M5        | M    |
