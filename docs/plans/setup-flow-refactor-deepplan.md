# DeepPlan: Refactor Outfitter setup flows

> **SUPERSEDED**: OFTR-010 replaced the terminal-driven setup flow described in
> this plan with pi-native onboarding (the branded welcome and profile
> selection now run inside the agent session). This document is retained as
> historical planning context only; consult `docs/requirements/OFTR-010-onboarding-welcome.md`
> and `docs/architecture/onboarding.md` for current behavior.

> **Execution**: Before starting implementation, complete the DeepPlan
> workflow by calling `deepwork_finished_step` on the `present_plan` step, then
> call `deepwork_start_workflow` with job_name=`outfitter_setup_flow_refactor_plan`, workflow_name=`main`.

## Purpose

Refactor Outfitter setup so the standard development workflow is predictable:

- `outfitter setup <local-path>` MUST read the live local source `.outfitter`, not stale setup cache state.
- Local symlink mode MUST actually symlink the selected target `.outfitter` to the source `.outfitter`.
- Local symlink mode MUST NOT copy files, create profile directories, or mutate source settings unexpectedly.
- Copy mode MUST preserve flat profiles such as `.outfitter/profiles/leader.yml` and shared resources.
- Every interactive setup flow MUST render the required branded Outfitter ASCII welcome.
- Setup MUST NOT hardcode profile-repo choices or profile-repo product knowledge. It MUST display loaded profile `id`, `label`, and `description` from configured sources.
- The setup prompt default SHOULD be source-driven: use an explicit source `default_profile` when present and valid; otherwise use the first loaded profile from the relevant source.
- The `analysis` profile MUST NOT be introduced by setup code; `data_analyst` is the intended public data analyst profile ID unless a configured profile source explicitly contains another profile.

## Current-state diagnosis

### Setup local source discovery can use stale cache

`src/cli/commands/SetupCommand.ts` currently prepares setup sources through `prepareStarterLayout(...)`, which creates a setup-source cache path and synchronizes via the setup-source synchronizer. That means a local command such as:

```sh
outfitter-dev setup ~/repos/example-org/profile-catalog
```

can prompt from cached/stale source contents instead of the live `~/repos/example-org/profile-catalog/.outfitter` tree. This explains stale choices such as `project-lead` after the live catalog source moved to flat `leader.yml` / `platform.yml` profiles.

### Symlink mode mixes source-of-truths

Setup-source onboarding can discover profiles from the starter/cache layout, while symlink application later resolves the live local `.outfitter`. This permits the user to choose stale cached profiles and then symlink a different live source.

### Symlink mode still runs mutation logic

`applySetupSourceImport(...)` creates the symlink, then still calls helpers that ensure profile sources and update `default_profile`. If the target `.outfitter` is a symlink, these calls mutate the source `.outfitter/settings.yml` through the symlink. Symlink setup should be atomic and should not mutate the source unexpectedly.

### Flat profile support exists below setup

`src/profiles/ProfileLoader.ts` supports both directory profiles and flat files. Setup orchestration is the layer that still has legacy assumptions around fallback profile paths and piecemeal resource copying.

### Plain setup bypasses ASCII welcome

`src/cli/commands/WelcomeCommand.ts` owns `writeWelcomeIntro(...)`, including the required ASCII welcome. Setup-source onboarding uses it. Plain interactive setup still prints a short hardcoded two-line intro in `selectDefaultProfileIfInteractive(...)` and loses the ASCII requirement.

### Setup contains hardcoded prompt choices

`SetupCommand.ts` contains `builtInSetupProfileChoices` for setup prompts. That violates the new requirement: setup must not know profile-repo options. Choices must come from loaded profile sources and must preserve profile-provided labels/descriptions.

## Design decision

Use the conservative refactor path first.

The aggressive alternative would redefine setup sources strictly as `.outfitter` bundles and reject legacy root-level `settings.yml`/`profiles` setup sources. That is cleaner, but it changes existing setup-source compatibility and existing tests with hard requirement comments. The conservative path fixes the user-visible failures while preserving remote/root setup-source compatibility until a separate migration can intentionally remove it.

## Implementation phases

### Phase 1 — Normalize setup-source resolution

Modify `src/cli/commands/SetupCommand.ts` to distinguish local live setup sources from remote/cache setup sources.

Recommended shape:

```ts
interface StarterLayout {
  readonly cachePath: string;
  readonly settingsPath?: string;
  readonly profilesPath?: string;
  readonly sourceOutfitterPath?: string;
  readonly sourceKind: 'local-live' | 'remote-cache';
}
```

Behavior:

- Local setup source:
  - Resolve relative paths against `projectDirectory`.
  - If the source path ends in `.outfitter`, use it directly.
  - Otherwise use `<source>/.outfitter` when it exists.
  - Read `settings.yml`, `profiles`, and shared resources from the live local source.
  - Do not git-clone/pull/cache local setup sources for setup prompts/import.
- Remote setup source:
  - Preserve existing cache/synchronizer behavior.
  - Preserve root-level and `.outfitter` nested layout detection for compatibility.

Acceptance criteria:

- `setup ~/repos/example-org/profile-catalog` reads live `profile-catalog/.outfitter/profiles`.
- Stale setup cache cannot cause local setup-source prompts to offer `project-lead` when live source only contains `leader`/`platform`.
- Existing remote setup-source tests still pass.

### Phase 2 — Make symlink import atomic

Split `applySetupSourceImport(...)` into copy and symlink paths, or return early for symlink mode.

Symlink mode MUST:

1. Validate source `.outfitter/settings.yml` exists and loads.
2. Validate source `.outfitter/profiles` exists and loads at least the promptable selected/default profile.
3. Refuse to replace a non-empty target `.outfitter`.
4. Create target `.outfitter` as a directory symlink to source `.outfitter`.
5. Report copied profile/resource counts as `0`.
6. Skip fallback default-profile creation.
7. Skip `ensureLocalProfileSource(...)`.
8. Skip `updateSettingsDefaultProfile(...)` unless a future explicit option says source mutation is intended.

Recommended behavior when selected profile differs from the symlinked source `default_profile`:

- Do not mutate source settings.
- Launch explicitly with `--profile <selected>` for the immediate post-setup launch when possible.
- Message that plain `outfitter` uses the linked source default.

Acceptance criteria:

- Target `.outfitter` is a symlink to source `.outfitter`.
- Source `.outfitter/settings.yml` remains byte-for-byte unchanged in symlink mode.
- No `profiles/<id>/profile.yml` directory is created for a flat source profile.
- Symlink mode does not copy profiles/resources.

### Phase 3 — Preserve flat profiles and resources in copy mode

Keep compatibility with existing copy behavior, but simplify the implementation where safe.

Minimum fix:

- Continue copying profile/source contents recursively without overwrite.
- Copy shared resource directories required by flat profiles: `prompts`, `deepwork`, `skills`.
- Ensure selected flat profile detection checks `<id>.yml` and `<id>.yaml` before falling back to `<id>/profile.yml`.
- Create fallback directory placeholder only when the selected profile truly does not exist after copy.

Preferred later simplification:

- For `.outfitter` bundle sources, copy the bundle as a unit into target `.outfitter` with non-overwrite behavior.
- Preserve root-level remote setup-source compatibility separately until deprecated.

Acceptance criteria:

- Copy mode preserves `.outfitter/profiles/leader.yml` and `.outfitter/profiles/platform.yml`.
- Copy mode does not create `.outfitter/profiles/leader/profile.yml` when `leader.yml` exists.
- Copy mode copies required `prompts`, `deepwork`, and `skills` resources.

### Phase 4 — Centralize the ASCII welcome

Use `writeWelcomeIntro(...)` from `WelcomeCommand.ts` for every interactive setup prompt path.

Changes:

- Replace the hardcoded two-line intro in `selectDefaultProfileIfInteractive(...)` with `writeWelcomeIntro(resolvePromptOutput(dependencies))`.
- Ensure setup-source onboarding continues to call the shared renderer.
- Avoid duplicate welcome output in first-run welcome handoff paths.

Acceptance criteria:

- `outfitter setup` prints the ASCII banner before profile prompts.
- `outfitter setup <source>` prints the ASCII banner before setup-source prompts.
- Tests assert an ASCII substring such as `____        _    __ _ _   _`.

### Phase 5 — Remove hardcoded setup profile choices

Remove `builtInSetupProfileChoices` from setup profile prompt selection.

Rules:

- Setup choices come from loaded profile sources only.
- Setup prompt labels/descriptions come from profile YAML metadata.
- If no profiles are discoverable, the prompt may show only the current `default_profile` as a minimal fallback ID, but setup MUST NOT invent repo-specific profiles such as `engineer`, `founder`, `analysis`, or `data_analyst`.
- `analysis` appears only when a configured profile source actually contains an `analysis` profile.
- `data_analyst` appears only when a configured profile source actually contains `data_analyst`.

Acceptance criteria:

- A fixture with only `data_analyst` offers only `data_analyst`.
- A fixture without `analysis` never offers `analysis`.
- A fixture with custom profiles offers those custom profiles and their labels/descriptions.

### Phase 6 — Source-driven prompt default ordering

Add a helper that determines the prompt default from source data:

```ts
const choosePromptDefault = (
  profiles: readonly SetupProfileChoice[],
  explicitDefault: string | undefined,
  fallbackDefault: string,
): string => {
  if (explicitDefault !== undefined && profiles.some((profile) => profile.id === explicitDefault)) {
    return explicitDefault;
  }

  return profiles[0]?.id ?? fallbackDefault;
};
```

Rules:

- For `setup <source>`:
  - If source settings declare a valid `default_profile`, make that profile first/default.
  - Otherwise, default to the first loaded profile from the source.
- For plain `setup`:
  - If the current settings default resolves among loaded choices, it MAY remain the prompt default.
  - Otherwise, default to the first loaded profile.

Open detail:

- `ProfileLoader` currently sorts some choices by ID in setup discovery. If “first option” must mean profile repo declaration order, remove prompt sorting and preserve loader/source order. If source order is not stable enough, support explicit order through settings `only` or source `default_profile`.

Recommended acceptance:

- Source `default_profile` is the strongest ordering signal.
- Without source default, use loaded source order, not hardcoded setup order.

## Requirements updates

### `docs/requirements/OFTR-004-sync-and-setup.md`

Add or amend:

- Interactive setup MUST render the shared Outfitter branded ASCII welcome before prompts.
- Setup MUST derive profile prompt choices from loaded profile sources or the provided setup source; setup code MUST NOT hardcode profile-repo IDs, labels, or descriptions.
- Setup prompts MUST display profile `id`, `label`, and `description` from loaded profile documents.
- When local setup source symlink mode is selected, setup MUST symlink the target `.outfitter` to the source `.outfitter` and MUST NOT copy files, create fallback profile directories, or mutate source settings without explicit user intent.
- Local setup source discovery MUST read the live source `.outfitter`, not a setup-source cache.
- Copy setup MUST preserve flat profile files and shared setup resources.

### `docs/requirements/OFTR-010-onboarding-welcome.md`

Clarify:

- The branded ASCII welcome requirement applies to every interactive setup path, not only first-run welcome onboarding.

### `docs/requirements/OFTR-003-profiles.md`

Clarify:

- Flat profiles are first-class setup-source profiles.
- Profile `label` and `description` are the source of interactive setup display metadata.

## Test plan

### Unit tests

Target: `tests/unit/setup-command.test.ts`

Add/update tests:

1. Plain interactive setup prints ASCII welcome.
2. Setup-source interactive flow still prints ASCII welcome.
3. Local setup source discovery reads live `.outfitter/profiles` and ignores stale cache.
4. Local symlink mode creates a symlink at target `.outfitter`.
5. Local symlink mode does not mutate source settings.
6. Local symlink mode does not create profile directory placeholders for flat profiles.
7. Local symlink mode reports zero copied files/resources.
8. Copy mode preserves flat profile files and copies `prompts`, `deepwork`, and `skills` resources.
9. Setup prompts display loaded labels/descriptions.
10. Setup prompts do not include `analysis` unless loaded from a configured source.
11. Setup prompts do not include hardcoded `engineer`/`data_analyst` unless loaded from a configured source.
12. Source explicit `default_profile` appears first/default.
13. Without explicit source default, first loaded source profile is prompt default.

### Integration tests

Target: `tests/integration/setup-source-symlink.test.ts`

Add/update tests:

1. catalog-like flat-profile source symlinks cleanly.
2. Symlinked target resolves `leader` and `platform` from source.
3. Source settings remain unchanged after symlink setup.

### Manual validation

From `/home/user/repos/example-org`:

```sh
rm -rf .outfitter
outfitter-dev setup ~/repos/example-org/profile-catalog
```

Expected:

- ASCII banner appears.
- Local setup source detected.
- Symlink option is offered.
- Profile choices come from live `profile-catalog/.outfitter/profiles`.
- Choices include `leader - Project Leader` and `platform - Platform Engineer` when those files exist in the catalog source.
- Choices do not include stale `project-lead`.
- Choosing project target + symlink creates `/home/user/repos/example-org/.outfitter` as a symlink to `/home/user/repos/example-org/profile-catalog/.outfitter`.

Then:

```sh
outfitter-dev profile list
outfitter-dev run --profile leader --agent pi --smoke
outfitter-dev run --profile platform --agent pi --smoke
```

Expected:

- `leader` and `platform` resolve.
- No profile directories are generated under the symlinked/copy target for flat profiles.

### CI validation

From `/home/user/repos/example-org/outfitter`:

```sh
npm test -- tests/unit/setup-command.test.ts
npm test -- tests/unit/setup-sources.test.ts
npm test -- tests/integration/setup-source-symlink.test.ts
npm run build
```

If available in the repo workflow:

```sh
npm run lint
npm run check-ci
```

## Expected commits by repo

### `/home/user/repos/example-org/outfitter`

Commit 1:

```text
fix(setup): render branded welcome across interactive setup
```

Contents:

- Replace plain setup short intro with shared ASCII welcome renderer.
- Add/update ASCII setup tests.
- Update OFTR-010/OFTR-004 requirement text.

Commit 2:

```text
fix(setup): resolve local setup sources from live outfitter folders
```

Contents:

- Normalize local vs remote setup-source resolution.
- Local setup source reads live `.outfitter` directly.
- Add stale-cache regression test.

Commit 3:

```text
fix(setup): make local symlink imports atomic
```

Contents:

- Split symlink import path from copy mutation path.
- Prevent source settings mutation through symlink.
- Prevent fallback profile directory creation in symlink mode.
- Add symlink behavior tests.

Commit 4:

```text
fix(setup): preserve flat setup-source profiles and resources
```

Contents:

- Ensure copy mode preserves flat profile files.
- Ensure shared resources are copied.
- Add catalog-like flat-profile copy tests.

Commit 5:

```text
fix(setup): derive setup choices from loaded profiles
```

Contents:

- Remove hardcoded setup profile prompt choices.
- Display loaded profile labels/descriptions.
- Implement source/default-first prompt behavior.
- Add `analysis`/`data_analyst` regression tests proving setup does not invent profile IDs.

### `/home/user/repos/example-org/profile-catalog`

Commit:

```text
chore: publish flat outfitter setup profiles
```

Contents:

- Ensure `.outfitter/profiles/leader.yml` exists with `id: leader` and `label: Project Leader`.
- Ensure `.outfitter/profiles/platform.yml` exists with `id: platform` and `label: Platform Engineer`.
- Ensure `.outfitter/settings.yml` uses the intended source default.
- Ensure no directory profile layout is used for catalog setup profiles.

### `/home/user/repos/example-org`

Commit only if this root repo tracks `.outfitter`:

```text
chore: link root outfitter setup to link profiles
```

Contents:

- Remove accidental generated/copy root `.outfitter` files.
- Replace root `.outfitter` with a symlink to `profile-catalog/.outfitter` if the root repo intentionally tracks that symlink.

If root `.outfitter` is local machine state and not tracked, do not commit it; just validate manual setup creates the intended symlink.

## Risks and mitigations

- **Symlink default mismatch:** If selected profile differs from source `default_profile`, preserving source settings means plain `outfitter` uses source default. Mitigate with explicit launch guidance and tests.
- **Profile order ambiguity:** Filesystem order is unstable. Mitigate by honoring explicit source `default_profile`; decide whether settings `only` order should define first loaded profile.
- **Compatibility risk:** Avoid removing root-level setup-source compatibility in this refactor. Defer strict `.outfitter` bundle-only behavior to a separate milestone.
- **Welcome duplication:** Add tests around first-run welcome and plain setup to avoid duplicate ASCII output.
- **Existing tests with hard requirement comments:** Update requirement docs before modifying tests that encode changed behavior.

## Non-goals

- Do not publish, tag, merge, or deploy.
- Do not mutate `/home/user/repos/example-org/.outfitter` during implementation except as a manual validation step after explicit approval.
- Do not remove legacy root-level setup-source compatibility in this plan.
- Do not decide default profile repo contents inside setup code.
