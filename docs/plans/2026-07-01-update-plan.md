# Outfitter Update Plan — Atomic Issues (2026-07-01)

Derived from [the comprehensive assessment](./2026-07-01-comprehensive-assessment.md). Decisions locked with Tyler:

- Track as **GitHub issues** on `ai-outfitter/outfitter` with specs in issue bodies (deeper specs in `docs/specs/` as each is picked up). **Nothing is filed without manual approval.**
- **Claude adapter: full parity work now** (Milestone 3).
- **Keep the Outfitter name**; differentiation/SEO work only.
- **Scope: everything** — ship-blockers, hardening, Claude parity, docs, and strategic/distribution.

Sizes: S (≤half day), M (1–2 days), L (3+ days). Dependencies are by issue number.

---

## Milestone 1 — Research-preview ship-blockers (first-run reliability + demo)

### 1. Bundle an offline default profile; degrade gracefully when catalog sync fails

**Why:** First run hard-requires network+git; sync failure of `ai-outfitter/default-profiles` is fatal (`RunCommand.ts:410-418`, `SetupCommand.ts:236-263`). Offline/proxied users dead-end.
**Scope:** Ship a minimal built-in profile (id `starter`) inside the npm package; on sync failure, warn and fall back to built-ins instead of throwing; `outfitter sync` retries/refreshes later. Update OFTR-010 accordingly.
**Acceptance:** With network blocked, `npm i -g && outfitter` reaches a working Pi session using the bundled profile; warning explains degraded mode; integration fixture covers offline path.
**Size:** M

### 2. Remove hardcoded bootstrap model from onboarding

**Why:** `--model google/gemini-3.1-pro-preview` is silently injected (`PiLoginLaunch.ts:79`); catalog rotation breaks every new user with no fallback.
**Scope:** Query pi for available/authenticated models and pick a sensible default, else omit `--model` and let pi decide. No model ID literals in src outside tests/fixtures.
**Acceptance:** Onboarding works with zero configured providers (routes to `/login`), with only Anthropic, with only OpenAI; grep gate: no hardcoded model IDs.
**Size:** S–M

### 3. ~~Fix onboarding regression: stale flow shown on fresh install~~ — FIXED (v0.7.2)

Resolved upstream: `a380826 fix(onboarding): create local profile source directory` (v0.7.2) fixed the onboarding failure chain, and `prepareFirstRunRuntimeOnboarding` force-syncs the default catalog (`fetch` + `pull --ff-only`) before the picker, so a stale cache cannot replay old profile lists. Issue draft removed 2026-07-01.

### ~~3. (original)~~ Fix onboarding regression: stale flow shown on fresh install

**Why:** Demo dry run (Jul 1): fresh install showed the old profile prompt (engineer/project-lead), then second-version-old flow, then dumped into Pi with extension errors. Root cause likely stale cache/settings interplay or old published extension content.
**Scope:** Root-cause; add cache/settings versioning or invalidation so a new CLI version never replays an old onboarding flow; cover with a regression test simulating a stale `~/.outfitter` from prior versions.
**Acceptance:** Upgrading from a v0.6.x home dir or fresh install always shows the current pi-native onboarding; repro test in CI.
**Size:** M
**Deps:** —

### 4. ~~Fix extension sources pointing at the old repo~~ — FIXED (default-profiles)

Resolved upstream in `ai-outfitter/default-profiles`: `c413d75 fix(founder): update ulta-tasklist owner` (applepi-ai → ai-outfitter) plus shortcut-conflict fixes `5bb551a`/`f2c8acc`. Onboarding syncs the catalog fresh, so all users get the corrected URIs. Issue draft removed 2026-07-01. The dead-URI CI guard idea is effectively covered by issue 7's onboarding smoke.

### ~~4. (original)~~ Fix extension sources pointing at the old repo

**Why:** Dry run: bootstrap extensions (e.g., task list) still resolve to the pre-rename repo, causing first-boot errors.
**Scope:** Audit every extension/skill/source URI in shipped defaults, default-profiles catalog, and generated settings; point at current repos; add a lint/test that fails on known-dead source URIs.
**Acceptance:** Fresh onboarding downloads all extensions without repo-not-found errors; URI audit test in CI.
**Size:** S

### 5. Fix "update available" notice shown immediately after updating

**Why:** Dry run: `pi update`/install path still reports an update is available when current.
**Scope:** Root-cause the version-check source (npm dist-tag vs installed version, caching); correct comparison; suppress within same version.
**Acceptance:** After installing latest, no update notice; unit test on the comparator.
**Size:** S

### 6. First-boot speed follow-ups (re-scoped 2026-07-01 after v0.7.1)

v0.7.1 (`4f1b2bb`) landed `PiExtensionCache`: shallow-cloned, dep-installed git-extension caching. Remaining scope: shallow catalog clones in `createGitSynchronizer`, a refresh policy for the git-extension cache (currently never updates — new staleness bug), and progress output during materialization (currently silent `spawn.sync`). See the re-scoped issue draft.

### ~~6. (original)~~ Speed up first boot: shallow clones + extension/package caching

**Why:** Dry run stalls minutes on cloning/building extensions ("maybe even make those shallow clones"); the pitch is a five-minute setup.
**Scope:** `--depth 1` clones for catalog + extension sources; cache built extensions keyed by version/commit; warm-cache path skips rebuilds; progress messaging while downloading.
**Acceptance:** Cold first boot on a clean machine measurably reduced (target: <60s on normal broadband, excluding model login); second boot near-instant; timing smoke recorded in CI logs.
**Size:** M

### 7. Add packaged E2E smoke to CI

**Why:** All tests are in-process; the shipped artifact (`npm pack` → global install → run) is never exercised. This is the exact path that failed in the demo.
**Scope:** CI job: `npm pack`, install into a temp prefix, run `outfitter --version`, `outfitter profile list`, and a `--smoke` run through onboarding with a fake/stubbed pi TTY where needed.
**Acceptance:** CI fails if the published-artifact flow breaks; runs on every PR.
**Size:** M
**Deps:** 1–5 (to pass), but can land first as a failing/allow-fail canary.

### 8. Record and publish the research-preview demo video

**Why:** Launch asset; script already converged (problem → make/share/switch → "follow along, 5 minutes").
**Scope:** Finalize script beats (Nicholas problem narrative, install, onboarding, profile switch `-p`, share via catalog); record (OBS, casual Imbue-style); publish to YouTube + README embed.
**Acceptance:** Video live; README links it; total length ≤ 8 min.
**Size:** M (non-code)
**Deps:** 1–6.

---

## Milestone 2 — Engineering hardening

### 9. Extract the Pi onboarding extension into `code/pi-extension` as typed TypeScript

**Why:** ~750-line untyped JS string in `PiLoginLaunch.ts:127-150`; never linted/type-checked/tested; largest untested surface and the source of onboarding fragility; workspace TODO already exists.
**Scope:** Real TS module in `code/pi-extension`, compiled at build; runtime values passed via env/JSON, not string interpolation; unit tests against pi-tui API surface; CLI consumes built artifact.
**Acceptance:** No `String.raw` extension bodies in src; extension package has its own tests + type-checks against `@earendil-works/pi-tui`; onboarding behavior unchanged (covered by issue 7 smoke).
**Size:** L
**Deps:** 3 (root cause first).

### 10. Implement the `prompt` state-persistence strategy

**Why:** In the strategy union and allowed for most paths (`StatePersistence.ts:17`, `PiAdapter.ts:38-44`) but no prompting exists; degrades silently to warn. Profiles can configure behavior that doesn't exist.
**Scope:** Interactive post-exit prompt (persist/discard/always-for-this-profile) when TTY; non-TTY falls back to warn with explicit notice; persist choice into profile `state_persistence`.
**Acceptance:** `prompt` paths actually prompt; choice is honored and persisted; docs in `state.md` updated; requirement added/amended.
**Size:** M

### 11. Near-real-time undeclared-write detection (and crash coverage)

**Why:** Detection only fires at clean exit (`RunCommand.ts:176-184`); multi-hour sessions get no feedback; crash/SIGKILL gets none.
**Scope:** Extend `CompositeProfileWatcher` to flag undeclared writes as they happen (throttled notices); write a journal so a crashed session's writes are reported on next invocation.
**Acceptance:** Undeclared write reported within seconds during a live session; post-crash report on next run; tests for both.
**Size:** M
**Deps:** 10 (shared UX for reporting).

### 12. Clean up composite temp dirs on exit

**Why:** Every run leaks `/tmp/outfitter-*` containing symlinks into auth/settings state (no `rmSync` in `RunCommand.ts`/`CompositeProfileAssembler.ts`).
**Scope:** Remove composite dir on normal exit; keep with `--debug` (path printed); best-effort sweep of stale dirs older than N days on startup.
**Acceptance:** No orphan dirs after clean exit; `--debug` preserves; test coverage.
**Size:** S

### 13. CI matrix (ubuntu/macos/windows) + Windows compatibility pass

**Why:** ubuntu-only CI (`ci.yml:13`); symlink-centric state model and `process.env.HOME` fallbacks (`PiAdapter.ts:418,435`) are Windows hazards.
**Scope:** Matrix CI; replace HOME with `os.homedir()`; junction/copy fallback where symlinks unavailable; document Windows support level honestly if not fully green.
**Acceptance:** CI green on all three OSes, or Windows explicitly marked unsupported in README with a tracking issue.
**Size:** M–L

### 14. Amend OFTR-001.5 and remove dead dependencies

**Why:** `defu`, `glob`, `hosted-git-info`, `typebox` declared but never imported; a do-not-modify test forbids removal (`tests/cli.test.ts:91-106`). Requirements are pinning history, not intent.
**Scope:** Define a requirements-amendment process (doc note in requirements README); amend OFTR-001.5; drop deps; update pinned test.
**Acceptance:** Deps removed; install size reduced; amendment process documented.
**Size:** S

### 15. Decompose SetupCommand / PiLoginLaunch; remove lint escape hatches

**Why:** 1,590 + 885 LoC files opening with `eslint-disable max-lines`/`complexity` — quality gates disabled exactly where risk is highest.
**Scope:** Extract flow modules (source import, interactive prompts, welcome persistence, login flow); delete the eslint-disable headers; no behavior change (guarded by existing suite + issue 7).
**Acceptance:** No `eslint-disable max-lines|complexity` in `src/cli/commands`; coverage unchanged.
**Size:** L
**Deps:** 9 (extension extraction shrinks PiLoginLaunch first).

### 16. Build and publish the Docker image from CI

**Why:** Dockerfile + entrypoint are written and unit-tested but no workflow ships the image.
**Scope:** GHCR publish on release (multi-arch if cheap); README usage section; version tags aligned with release-please.
**Acceptance:** `docker run ghcr.io/ai-outfitter/outfitter` reaches onboarding; publish wired to releases.
**Size:** S–M

---

## Milestone 3 — Claude Code adapter parity

### 17. Claude adapter: MCP composition

**Why:** `.mcp.json` merge is pi-only (`PiMcpConfig.ts`); Claude composite gets no MCP wiring.
**Scope:** Generalize MCP fragment merging; emit `.mcp.json` (or `managed-mcp` equivalent) into `CLAUDE_CONFIG_DIR` composite; layer-precedence identical to pi.
**Acceptance:** Profile with MCP servers launches Claude with them available; golden-tree fixture for claude composite.
**Size:** M

### 18. Claude adapter: map generic `skills` control

**Why:** `controls.skills` unsupported on claude, only warns (`ClaudeAdapter.ts:21-35`), despite SKILL.md being a cross-tool standard.
**Scope:** Materialize profile skills into the composite Claude skills directory; identity-dedupe consistent with pi.
**Acceptance:** Same profile's skills appear in both pi and claude sessions; fixtures + support matrix updated.
**Size:** M

### 19. Claude adapter: first-run/login onboarding path

**Why:** `PiLoginLaunch.ts:32-34` no-ops for claude; no onboarding parity.
**Scope:** Detect missing claude binary/credentials; guided install + `claude /login` handoff; profile picker works with `--agent claude` on first run.
**Acceptance:** Clean machine with claude installed: `outfitter run --agent claude` onboards to a working session; without claude: actionable install guidance.
**Size:** M–L
**Deps:** 9 (shared onboarding architecture).

### 20. Claude adapter: control mapping completeness (`provider`, `thinking`, `prompt_template`, `deepwork`)

**Why:** `thinking` loosely maps to `--effort` (`ClaudeAdapter.ts:181`); `provider`/`prompt_template`/`deepwork` warn-only.
**Scope:** Precise thinking→effort table; decide + implement or explicitly document each remaining control (support matrix must match code); `--strict` behavior verified.
**Acceptance:** `controllable-elements.md` matrix rows for Claude are all either Supported (with tests) or Roadmap (with warning text asserted in tests).
**Size:** M

### 21. Cross-adapter conformance test suite

**Why:** Parity claims need an enforcement mechanism or they'll drift again.
**Scope:** Shared conformance spec: for each generic control, a fixture profile and per-adapter expected composite output/flags; runs for pi and claude; matrix doc generated from results.
**Acceptance:** One command proves the support matrix; docs table generated (or verified) from the suite.
**Size:** M–L
**Deps:** 17, 18, 20.

---

## Milestone 4 — Docs & site front door

### 22. Fix typo'd paths and filenames (`docs/archtecture/`, `orginization-profile-catalog.md`)

**Why:** Typos baked into public links while the repo is young; propagated into CONTRIBUTING.
**Scope:** `git mv` to correct names; update all references; add redirects/notes where linked externally.
**Acceptance:** No occurrences of `archtecture`/`orginization` in repo; links resolve.
**Size:** S

### 23. Rewrite `philosophy.md`

**Why:** 16-line unedited draft with typos, linked from the user-facing index; it's also the best positioning material ("expeditious agents").
**Scope:** Full rewrite: expeditious agents, context headroom, make/share/switch, individual→team→enterprise; keep it short but polished.
**Acceptance:** Typo-free, coherent, linked from README; reads as the "why" page.
**Size:** S

### 24. Expand profile catalog docs + trust model

**Why:** Headline feature has 30 lines of docs; catalogs inject extensions/args/env into agents — CSA-flagged supply-chain surface with no trust guidance.
**Scope:** Grow `profile-repository.md`: authoring a catalog, `ref` pinning, `only`/`except`, private repos, `remote_settings`, versioning; new "Trust and review" section (what a catalog can do to your machine, review checklist).
**Acceptance:** A team can publish + consume a catalog using only this doc; trust section exists and is linked from setup output.
**Size:** M

### 25. Reconcile AGENTS.md, mark superseded plans, scrub leaked paths

**Why:** AGENTS.md says "Pi is the only day-one adapter" contradicting OFTR-006 and shipped code; `setup-flow-refactor-deepplan.md` documents the superseded terminal flow and leaks `/home/ncrmro/...` paths and private repo names.
**Scope:** Update AGENTS.md to current adapter reality + doc conventions; add SUPERSEDED banners to stale plans; scrub personal paths/private names from public docs.
**Acceptance:** No contradictions between AGENTS.md, requirements, and README; no personal machine paths in repo.
**Size:** S

### 26. Add a Concepts page and CLI command reference

**Why:** Vocabulary is heavy (profile/composite/catalog/source/loadout/state paths) with no single map; command flags scattered across docs.
**Scope:** `docs/documentation/concepts.md` (one diagram + one paragraph per concept, layer-precedence picture); `docs/documentation/cli.md` generated-or-verified from commander definitions.
**Acceptance:** Every concept term links to Concepts; every command/flag documented; drift check (help text vs docs) in CI or a test.
**Size:** M

### 27. Single docs home: doc site renders `docs/documentation`

**Why:** Two-page Nextra site duplicates/diverges from the real docs.
**Scope:** Doc site consumes `docs/documentation/*` sources (contentlayer/symlink/build copy); nav mirrors the docs index; deploy pipeline.
**Acceptance:** Publishing a doc change requires editing exactly one file; site deployed with full docs + landing page.
**Size:** M–L
**Deps:** 22, 26.

### 28. Surface Supported-vs-Roadmap status in user docs

**Why:** Users can't tell what works without reading an 872-line architecture file.
**Scope:** Move/mirror the support matrix into user docs with per-adapter status badges; link from README.
**Acceptance:** README links a matrix a new user can parse in 30 seconds; matrix consistent with issue 21's conformance results.
**Size:** S
**Deps:** 21 (ideally), 27.

---

## Milestone 5 — Distribution, positioning, and enterprise wedge (strategic)

### 29. Differentiation & SEO pass (keep the name)

**Why:** `outfitter-dev/agents` dominates "outfitter agents" search; awareness of ai-outfitter is ~zero, so positioning language must do the work.
**Scope:** Consistent tagline everywhere ("Make, share, and switch your coding-agent profiles"); npm keywords; GitHub topics/description; doc site meta/OG; explicit "not affiliated with outfitter-dev" FAQ entry if collisions bite.
**Acceptance:** Searching "outfitter pi agent profiles" surfaces ai-outfitter properties; consistent tagline across README/npm/site.
**Size:** S

### 30. Ecosystem listings & Pi community presence

**Why:** Cheapest distribution: awesome-cli-coding-agents covers Pi/agent infra; Pi Discord/package channels are exactly the audience.
**Scope:** PR to awesome-cli-coding-agents; Pi Discord announcement; explore listing the outfitter skill/extension in pi package channels; HN/launch post timing decision.
**Acceptance:** Listed in at least two ecosystem directories; announcement posted alongside demo video (issue 8).
**Size:** S (non-code)
**Deps:** 8, M1 complete.

### 31. State the licensing split publicly

**Why:** Open/MIT individual+team, enterprise license for private-catalog features + paid training/support was the sketch (Jamie call, Weekly Demo); `code/enterprise` is an unexplained BSL shell.
**Scope:** README "Licensing" section; `code/enterprise/README.md` explains what will live there; LICENSE.md clarity on boundaries.
**Acceptance:** A prospective org user can answer "what's free, what will cost money" from the README.
**Size:** S (decision + writing)

### 32. Org-catalog governance features: design spec

**Why:** The enterprise wedge (approved stores, `only`/`except` policy, budget annotations, model allowlists) matches field demand (UPS/Home Depot via Jamie: control plane, auditability).
**Scope:** Design doc (docs/specs/): org-pinned `remote_settings`, source allowlists, policy enforcement vs warn, audit logging of profile provenance per session; identify which parts are OSS vs enterprise-licensed. Spec only — implementation issues spawn from it.
**Acceptance:** Reviewed spec with explicit OSS/enterprise boundary and an implementation issue list.
**Size:** M (spec)
**Deps:** 24, 31.

### 33. Persona-profiles showcase

**Why:** Differentiated, product-shaped use case no competitor serves; docs exist (`usecases/persona-reviews.md`) but no runnable catalog.
**Scope:** Publish a `persona-reviews` catalog in default-profiles (founder-operator, staff-engineer, EM, platform-lead reviewers); one-command demo (`outfitter run --profile persona/staff-engineer`); short write-up/blog.
**Acceptance:** A user can run a persona review on their own docs in <5 minutes from the use-case page.
**Size:** M
**Deps:** M1.

### 34. Federated-context pattern: worked example

**Why:** The prompts-library pattern (atomic md files composed per-profile: codebases/teams/tools/models) is the answer to the "federated context layer" demand and already works via `append_system_prompt` includes; it's undocumented as a pattern.
**Scope:** Example catalog repo with `/prompts/{codebases,teams,tools,models}` and profiles composing them; docs page walking the governance story (who owns the prompt library, review flow).
**Acceptance:** Documented, cloneable example demonstrating 50-codebase-style composition; linked from org-catalog use case.
**Size:** M
**Deps:** 24.

---

## Sequencing summary

- **Week 1 (launch):** 1–7 in parallel where possible (3→4→5 are quick kills; 1, 2, 6 are the meat; 7 lands as canary), then 8 (demo) ships the preview. 29–30 fire with the launch.
- **Weeks 2–4:** 9 → 15, 10 → 11, 12, 13, 14, 16; docs 22–26 in parallel (small, independent).
- **Weeks 3–6:** Claude parity 17, 18, 20 → 19 → 21 → 28; docs site 27.
- **Quarter:** 31 → 32 (enterprise wedge), 33, 34.

Total: 34 atomic issues (25 code, 9 docs/strategic).
