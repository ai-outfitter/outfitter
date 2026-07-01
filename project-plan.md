# Outfitter — Project Plan

_Last updated: 2026-07-01. Companion chronological log: [project-log.md](./project-log.md)._

## What it is

Outfitter builds effective **agent profiles** and launches them through wrapped agent CLIs — Pi first (`@earendil-works/pi-coding-agent`, bundled), Claude Code partially, more adapters planned. Individuals, teams, and organizations can make, share, and switch repeatable agent loadouts, manually or programmatically.

One-line value prop (from the demo script work, Jul 2026): **"Make, share, and switch the profiles your coding agents use — manually or programmatically."**

## Who it serves

- **Individuals**: rapid loadout switching (engineer / prod-debug / research / founder profiles) so each session gets narrow, relevant context instead of one bloated setup ("expeditious agents" philosophy — tight profiles preserve context headroom).
- **Teams**: share iterated profiles via git-based profile catalog repos; org-approved default stores.
- **Enterprises** (future): governance plane — approved profile stores, federated context libraries (atomic markdown composed into system prompts), cost/model policies, auditability. Enterprise features to live under `code/enterprise/` (BSL license shell exists, no code yet).

Strategy stair-steps: individual → team → enterprise; TUI → GUI; open → paid. Monetization sketch: MIT/open for individual+team, enterprise license for private catalog features, plus training/support services.

## Tech stack & repo structure

- Node 22+, strict TypeScript, npm workspaces. Published as `@ai-outfitter/outfitter` (v0.7.0, npm provenance).
- `code/cli/` — the product (~8.6k LoC): `src/agents/` (adapter contract, pi + claude adapters, launch), `src/profiles/` (loading, multi-inheritance merge with cycle detection, remote cache), `src/compositeProfile/` (temp-dir assembly, Liquid templating with `[[= ]]` delimiters, fs watcher, state persistence), `src/settings/` (user/project/project-local/remote settings), `src/cli/commands/` (run, setup, sync, welcome, profile list/create/lint).
- `code/pi-extension/` — placeholder; the real Pi onboarding extension is currently a ~750-line JS string in `PiLoginLaunch.ts` (known debt).
- `code/doc_site/` — Nextra site, 2 pages so far.
- `docs/` — user docs (`documentation/`), architecture (`architecture/`, typo fixed 2026-07-01), formal requirements OFTR-001..010, plans, specs.
- Testing: vitest, 254 tests, ~99% coverage with 98% thresholds enforced in CI; golden-tree integration fixtures; requirement-pinning "do not modify" tests. CI: ubuntu-only; release-please + npm publish workflows; Dockerfile exists but image not published.

## How it works (core flow)

settings.yml layers (user `~/.outfitter`, project `.outfitter`, project-local, remote) select profile sources and defaults → profile stack resolves with deterministic precedence (project-local > project > user > cached remote > inherits > built-ins) → adapter translates generic controls into a **composite profile** (mkdtemp dir: merged prompts, `.mcp.json`, keybindings, settings) → agent launched with `PI_CODING_AGENT_DIR` / `CLAUDE_CONFIG_DIR` pointed at it → declared state paths symlink/discard/warn/error back to real state (`~/.pi/agent`, `~/.claude`); undeclared writes detected by fingerprint diff at exit. `outfitter sync` refreshes remote catalogs into `~/.outfitter/cache/`. First run triggers Pi-native onboarding (syncs `ai-outfitter/default-profiles`, profile picker: founder/engineer/data_analyst).

## Current status (2026-07-01)

Public research preview being launched. Core engine (profiles → composite → pi launch) is production-quality; risk concentrated in first-run/onboarding surface (see assessment). Demo video in progress with Nicholas; dry run exposed onboarding regressions.

## Planned improvements / roadmap

See [docs/plans/2026-07-01-comprehensive-assessment.md](./docs/plans/2026-07-01-comprehensive-assessment.md) for the full prioritized list. Headlines:

1. Bulletproof first run (offline default profile, remove hardcoded bootstrap model, graceful degraded sync, faster first boot)
2. Extract Pi extension to typed workspace; implement or remove `prompt` persistence strategy
3. Claude adapter: label experimental or reach parity
4. Docs front door cleanup (typo'd dirs, philosophy draft, catalog trust model, AGENTS.md contradiction)
5. Distribution: Pi ecosystem beachhead, awesome-lists, resolve "Outfitter" name collision with `outfitter-dev/agents`

## Related tools / context

- **Pi** (pi.dev): minimal, extensible agent harness Outfitter wraps first. Everything is an extension; Outfitter is "the quickest path to a recommended Pi loadout."
- **DeepWork**: multi-step workflow system, deeply integrated into Outfitter profiles (deepwork jobs are a profile control).
- **Panopticon**: sibling Unsupervised tool — multi-session agent control plane / orchestrator TUI (separate repo, launching around the same time).
- Company context: Unsupervised pivoting to "product research lab" building agent-control utilities (per Tyler, Jun 2026).
