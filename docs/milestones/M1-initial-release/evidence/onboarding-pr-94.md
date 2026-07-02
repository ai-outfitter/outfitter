# M1 onboarding evidence: PR #94

## Provider metadata

- GitHub PR: <https://github.com/ai-outfitter/outfitter/pull/94>
- PR title: `feat(onboarding): add pi-native first-run setup`
- Merge commit: `65037fc3399826871768bd594340caee217a74e4`
- Merged: 2026-06-30
- GitHub milestone action: assigned PR #94 to milestone `Initial Release` on 2026-07-02 through `gh pr edit 94 --milestone "Initial Release"`.
- History action: no commit was amended and no published history was rewritten.

## M1 requirement coverage

### Requirement 1 — Easy onboarding

PR #94 moved first-run setup into Pi-native `/outfitter` onboarding. The implementation launches Pi with a bootstrap extension when interactive first-run settings are absent, synchronizes the default profile catalog, presents catalog/profile/install-target choices, and keeps non-interactive launches from prompting or mutating settings.

Follow-up work in this branch tightens the first-run project-install path: when a fresh user chooses a project install, Outfitter also creates valid home setup state, then syncs and relaunches after install so the selected profile can become active without a manual second command.

### Requirement 2 — Welcome flow and credential boundary

PR #94 registers a native Pi command with `pi.registerCommand("outfitter", ...)`, opens it without sending an agent/model message, renders Outfitter-branded startup/onboarding copy, and delegates missing provider setup to Pi's `/login` flow. Outfitter does not collect, echo, or persist provider credentials.

## Requirement traceability

- `docs/requirements/OFTR-010-onboarding-welcome.md`
  - OFTR-010.1: native Pi first-run entry, extension command dispatch, non-interactive no-mutation boundary, exact project trust.
  - OFTR-010.2: setup mode, synced default catalog, profile picker, install target, project/home persistence, home setup state for first-run project installs, sync/restart after install.
  - OFTR-010.3: Pi UI surface and credential-prompt boundary.
  - OFTR-010.4: Pi `/login` handoff and no Outfitter credential handling.
  - OFTR-010.5: explicit terminal setup compatibility through Pi-native setup launch behavior.
- `docs/requirements/OFTR-004-sync-and-setup.md`
  - OFTR-004.1: `setup` launches Pi-native onboarding and preserves `setup <source>`.
  - OFTR-004.1.6: first-run project setup-source installs create home setup state.
  - OFTR-004.2.18: sync resolves setup-style cached `.outfitter/settings.yml` when `path: settings.yml` is configured and no root file exists.

## Validation evidence from this branch

- `npm test --workspace @ai-outfitter/outfitter -- tests/unit/pi-login-launch.test.ts tests/unit/run-command.test.ts tests/unit/setup-command.test.ts tests/unit/setup-sources.test.ts tests/unit/profile-command.test.ts` — 5 files, 76 tests passed.
- `npm run typecheck` — passed.
- `npm run lint` — passed.

## Scope caveats

- GitHub fetch through the configured SSH remote failed with `Permission denied (publickey)`; latest `main` was fetched through a one-off HTTPS fetch without changing remotes.
- No target conformance report was generated.
- Release creation, publishing, tagging, and pushing were not performed.
