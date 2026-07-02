# M1: Initial Release

## Tracker

- Provider: GitHub
- Provider milestone: [Initial Release](https://github.com/ai-outfitter/outfitter/milestone/1)
- Provider ID: `1`
- Milestone key: `M1-initial-release`
- Branch: `milestone/M1-initial-release`
- Worktree: `/home/ncrmro/repos/unsupervised/worktrees/outfitter/milestone/M1-initial-release`
- Status: planned

## Customer deliverable

Outfitter's initial release gets a new user from first install to a useful Pi session without configuration spelunking. The release centers on two business/user requirements:

1. **Easy onboarding:** a new user SHOULD be able to start Outfitter, choose the recommended founder/default catalog path inside Pi, and reach a useful Pi session without profile/source/extension spelunking.
2. **Welcome flow:** a new user MUST see guided Outfitter/Pi onboarding before setup decisions, and provider credential entry MUST remain inside Pi.

The merged Pi-native welcome/onboarding PR belongs to M1 onboarding scope. PR #94 / commit `65037fc` is assigned to the GitHub `Initial Release` milestone and is mapped in `evidence/onboarding-pr-94.md`.

## Requirements in scope

- `docs/requirements/OFTR-004-sync-and-setup.md`
  - OFTR-004.1.1-6: setup launches Pi-native onboarding, preserves `setup <source>`, and creates home setup state for first-run project installs.
  - OFTR-004.2.1-18: sync validates settings, synchronizes remote settings/profile sources, redacts credentials, gates private catalogs, and resolves nested `.outfitter/settings.yml` for setup-style sources.
- `docs/requirements/OFTR-010-onboarding-welcome.md`
  - OFTR-010.1: default interactive first-run launches Pi with a bootstrap extension, registers native `/outfitter`, avoids agent/model turns, and does not mutate settings in non-interactive launches.
  - OFTR-010.2: Pi-native onboarding asks setup mode, reads catalog profiles from the synced default source, selects install target, creates home setup state for project installs, syncs, and restarts/relaunches after install.
  - OFTR-010.3: onboarding UI keeps credential collection outside Outfitter prompts and explains profiles/settings/catalogs with Outfitter branding.
  - OFTR-010.4: Pi login setup MUST be delegated to Pi without Outfitter collecting provider credentials.
  - OFTR-010.5: explicit terminal setup compatibility remains through Pi-native setup launch behavior and published fallback guidance.

## Requirements out of scope

- Organization profile catalog management beyond what the founder profile and default Outfitter skill require.
- Container launch backends, trusted publishing, release provenance, and other platform-only work unless needed to unblock the initial release.
- Setup-source symlink mode refinements beyond preserving the already specified behavior.
- New remote provider integrations or provider credential collection.
- Target conformance reports.

## Press release

Outfitter's initial release turns Pi setup into a guided first run. Start Outfitter, complete native `/outfitter` onboarding inside Pi, and Pi restarts with the selected profile/catalog instead of asking new users to assemble profiles, extensions, and login steps manually. Provider credential entry stays in Pi's `/login` flow.

## Internal FAQ

**Who is this for?** New Pi users, founder-operators, and engineers who want a productive agentic coding setup without manually composing profiles and extensions.

**What is the default path?** Choose the default Outfitter profile catalog, select the recommended founder profile when present, pick the install target, and let Outfitter sync/restart so Pi loads the installed profile.

**What if the user chooses project install on a fresh machine?** Outfitter writes the project settings and also creates a valid home setup state so later launches do not repeat first-run onboarding.

**Does Outfitter collect API keys?** No. Outfitter may detect missing Pi login state and open Pi's `/login` flow, but credential entry stays inside Pi.

**Can support tell users to rerun setup?** Yes, but support MUST distinguish first-run welcome onboarding from later setup/profile management. Later customization happens through `/outfitter` or `outfitter profile list`.

**What should engineering preserve?** Pi-native `/outfitter` onboarding, default-catalog profile choices loaded from synchronized catalog data, deterministic founder recommendation when available, no provider credential collection, home setup state for first-run project installs, and automatic sync/restart after install.

## ASCII mockup

```text
  ____        _    __ _ _   _
 / __ \      | |  / _(_) | | |
| |  | |_   _| |_| |_ _| |_| |_ ___ _ __
| |  | | | | | __|  _| | __| __/ _ \ '__|
| |__| | |_| | |_| | | | |_| ||  __/ |
 \____/ \__,_|\__|_| |_|\__|\__\___|_|

Pi is a fully extensible agentic coding harness.
The founder profile brings Pi to feature parity with dedicated agentic coding tools.
Run /outfitter inside Pi at any time to customize your profile.

How would you like to set up Outfitter?
→ Use the default Outfitter profile catalog
  Create your own profile
  Provide a different catalog to import
```

## Expected KPI movement

Outfitter does not yet have a dedicated `docs/mission.md` KPI table. M1 will therefore record initial-release measurements in the milestone evidence before close:

- `M1-KPI-1` — First-run happy-path completion: target 100% pass rate for the automated fresh-home onboarding scenario before release handoff; measurement window: release-candidate validation.
- `M1-KPI-2` — Prompt count on recommended path: target only the required Pi-native setup decisions before restart/relaunch, excluding Pi-native `/login`; measurement window: release-candidate validation.
- `M1-KPI-3` — Welcome requirement coverage: target tests or captured session evidence proving branded welcome text, accept path, decline path, and Pi login handoff; measurement window: release-candidate validation.

Follow-up governance SHOULD add durable project KPIs to `docs/mission.md`; that work is not required to ship M1.

## E2E happy-path test

1. Start from a fresh temporary home with no existing `~/.outfitter` and no Pi auth/model state.
2. Run the default interactive `outfitter` entry point.
3. Confirm Pi launches with the Outfitter bootstrap extension and auto-opens native `/outfitter` without sending an agent/model message.
4. Choose the default Outfitter profile catalog and the recommended founder profile when present.
5. Confirm Outfitter writes `~/.outfitter/settings.yml`, synchronizes configured sources, and automatically restarts/relaunches with the installed profile.
6. Confirm project-target first-run setup also creates home setup state so later launches do not repeat onboarding.
7. Confirm missing Pi login state is delegated to Pi's `/login` flow without Outfitter collecting credentials.

## Post-release test plan

- **Immediately after release candidate build:** run unit, lint, typecheck, and fresh-home onboarding tests. Roll back if the accepted path asks for extra profile/loadout decisions or fails to launch Pi.
- **Dogfood within 24 hours:** run the published package or release artifact in a clean temp home and capture the prompt transcript. Roll back if welcome text is missing, the founder path is not default, or `/login` handling leaks credentials into Outfitter.
- **After first external user or dogfood install:** record whether the user reached Pi from the default path without operator intervention. Roll back or patch if onboarding requires undocumented setup steps.

## Feature flags and rollout plan

- Feature flag: Not needed — M1 is the initial release onboarding surface, and hiding it would remove the release's primary customer value.
- Preview cohort: maintainer dogfood from clean temporary homes and local packaged builds.
- Rollout cohort: first public initial-release users.
- Full release: publish once automated validation and one dogfood transcript pass.
- Rollback path: hold or deprecate the release artifact; patch the setup/welcome command path; keep credential/login handling inside Pi.

## Acceptance criteria

- A fresh user CAN complete Pi-native onboarding without profile/source/extension spelunking.
- The recommended path SHOULD select founder when the synced default catalog contains it.
- Interactive first-run/setup paths in M1 scope MUST run guided native `/outfitter` onboarding before setup writes.
- Project-target first-run installs SHOULD create home setup state to avoid repeated onboarding on later launches.
- Completed onboarding SHOULD synchronize configured sources and restart/relaunch so the installed profile is active.
- Missing Pi login state MUST be handled by Pi's `/login` flow, not by Outfitter credential collection.
- Requirement 2's merged welcome-flow work MUST be associated with M1 onboarding scope through GitHub milestone metadata or a follow-up governance commit.
- Release handoff MUST include automated validation evidence and at least one dogfood transcript or equivalent session log.

## Risks and open questions

- **Merged PR scope drift:** The welcome-flow PR was merged before this milestone dossier; mitigate by amending metadata where safe or adding a follow-up governance commit.
- **Prompt regression:** Setup-source and first-run setup paths can diverge; mitigate with tests covering accepted, declined, and setup-source paths.
- **Credential boundary:** Login convenience can accidentally become credential handling; keep `/login` inside Pi and test non-interactive output streams.
- **Missing durable KPIs:** Outfitter has requirements but no mission KPI table; add project KPIs after M1 planning if governance needs release-over-release measurement.
