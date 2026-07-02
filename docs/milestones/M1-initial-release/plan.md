> **Execution**: Before starting implementation, complete the DeepPlan
> workflow by calling `deepwork_finished_step` on the `present_plan` step, then
> call `deepwork_start_workflow` with job_name=`<session_job_name>`, workflow_name=`main`.

# M1 Initial Release Implementation Plan

## Goal

Ship Outfitter M1 Initial Release readiness by completing the enterprise/business-license boundary work. Onboarding and welcome-flow implementation are considered complete; M1 release creation will be handled by release-please/release automation, not by a manual release PR in this plan.

## Execution note: 2026-07-02 onboarding maintenance

After this plan was written, maintainer/user direction added urgent M1 onboarding requirements: project-target first-run setup must create home setup state, installed profiles should auto-sync, and Outfitter should restart/relaunch after install. Those requirements are tracked in `docs/requirements/OFTR-004-sync-and-setup.md`, `docs/requirements/OFTR-010-onboarding-welcome.md`, and `evidence/onboarding-pr-94.md`; they do not reopen the older terminal-only welcome direction.

## Scope correction from maintainer feedback

Maintainer direction supersedes the earlier onboarding-heavy draft:

- Do **not** plan more onboarding implementation for M1; it is done.
- Do **not** plan manual release creation; release-please owns release generation.
- Focus M1 execution on enterprise business-license changes.
- The `code/enterprise` subtree must carry a different restrictive license.
- Use the Panopticon licensing pattern from `https://github.com/Unsupervisedcom/panopticon/blob/main/LICENSE`.

The referenced Panopticon root license pattern says, in substance:

- content under the enterprise directory is licensed under that directory's license;
- content outside that restricted directory remains under the root open license.

## Current repository observations

- Current root license file: `LICENSE.md`
- Current package metadata: `package.json` has `"license": "BUSL-1.1"`
- Current npm package files include `LICENSE.md`, but do not include a `code/enterprise` entry.
- No `code/enterprise` directory currently exists in the M1 worktree.
- The currently checked-in `LICENSE.md` is already a Business Source License 1.1 for Outfitter.

## Product/legal implementation decision

M1 should establish a clear split-license layout:

1. Root project files and non-enterprise code use the primary project license declared at the repository root.
2. `code/enterprise/**` uses its own restrictive enterprise license from `code/enterprise/LICENSE`.
3. Root license text must conspicuously point readers to the enterprise carve-out, following the Panopticon root-license pattern.
4. Package metadata and published package contents must not accidentally hide or misrepresent the enterprise license boundary.

Because the public Panopticon repository currently exposes the root split-license notice but does not expose an `enterprise/LICENSE` file, implementation should use the root notice pattern exactly and place Outfitter's restrictive Business Source License terms in `code/enterprise/LICENSE` unless maintainers provide a different enterprise license text before execution.

## PR plan and expected commits

### PR 1 — Split-license governance and repository metadata

**Branch:** `chore/m1-enterprise-license-boundary`  
**Title:** `chore(license): define enterprise license boundary`

Expected commits:

- `chore(license): define enterprise license boundary`

Likely affected files:

- `LICENSE.md`
- `code/enterprise/LICENSE` (new)
- `code/enterprise/README.md` (new, if needed for discoverability)
- `package.json`
- `README.md` or docs license page if one exists

Implementation checklist:

- Update root `LICENSE.md` to use the Panopticon-style split-license notice:
  - enterprise subtree: `code/enterprise/**` is licensed under `code/enterprise/LICENSE`;
  - everything outside that subtree is licensed under the root license terms.
- Create `code/enterprise/LICENSE` with the restrictive enterprise/business license text.
  - Default license text: current Outfitter Business Source License 1.1 terms from existing `LICENSE.md`.
  - If legal/maintainers provide a different enterprise license, use that exact text instead.
- Add `code/enterprise/README.md` only if helpful to make the boundary obvious to package consumers and contributors.
- Update `package.json` license metadata to avoid falsely describing the whole package as a single uniform license if root code becomes open while enterprise remains restricted.
  - Preferred SPDX expression if compatible with final root license: `MIT AND LicenseRef-Outfitter-Enterprise` or similar.
  - If the project remains all-BUSL outside enterprise, keep `BUSL-1.1` but still include the enterprise carve-out.
- Update package `files` only if `code/enterprise` is intended to be published.
  - If enterprise code should be published, include `code/enterprise` and its license.
  - If enterprise code should not be published, explicitly document that and ensure package contents do not include it accidentally.

Acceptance criteria:

- A reader can determine the license for `code/enterprise/**` without ambiguity.
- A reader can determine the license for all non-enterprise repository content without ambiguity.
- Root license file follows the Panopticon-style enterprise carve-out.
- The restrictive enterprise license is present in `code/enterprise/LICENSE`.
- Package metadata and package contents reflect the split-license model.
- No onboarding code changes are included in this PR.

Validation evidence:

```bash
npm run typecheck
npm run lint
npm test
npm pack --dry-run
```

Manual validation:

- Inspect `npm pack --dry-run` output and confirm the intended license files are included.
- Confirm `LICENSE.md` and `code/enterprise/LICENSE` are both present where expected.
- Confirm package metadata does not claim a misleading single license for differently licensed content.

### PR 2 — Enterprise subtree scaffolding/package safeguards, if needed

**Branch:** `chore/m1-enterprise-package-safeguards`  
**Title:** `chore(enterprise): guard licensed package boundaries`

Expected commits:

- `chore(enterprise): guard licensed package boundaries`

Likely affected files:

- `code/enterprise/**`
- `.npmignore` or `package.json` `files`
- `scripts/*` if a packaging/license verification script is added
- `tests/*` only if the repo has package-manifest tests

Implementation checklist:

- Decide whether `code/enterprise` is included in the public npm package.
- Add a lightweight package/license verification check if current tooling has no coverage.
- Ensure future enterprise code added under `code/enterprise` cannot be published without its license notice.
- Ensure generated artifacts do not copy enterprise code into a differently licensed path without preserving notice.

Acceptance criteria:

- `npm pack --dry-run` proves the intended inclusion/exclusion of `code/enterprise`.
- If enterprise files are included, their restrictive license file is included.
- If enterprise files are excluded, the root docs still explain where enterprise code lives in source and why it is not in the package.
- CI or documented release validation includes a package license-boundary check.

Validation evidence:

```bash
npm pack --dry-run
npm run check-ci
```

If `check-ci` is unavailable or too broad for the branch, run:

```bash
npm run typecheck
npm run lint
npm test
```

## Onboarding / welcome-flow disposition

No new onboarding work is planned. Existing M1 onboarding and welcome-flow work remains associated with M1 as already merged. If metadata can be edited safely in GitHub, add the relevant merged PR/commit to the `Initial Release` milestone. Do not rewrite published history solely to amend commit metadata.

## Release automation disposition

No manual release PR is planned. Release-please should create release artifacts after the M1 branch has the required license-boundary commits and validation passes.

Release validation before allowing release-please to proceed should include:

```bash
npm run typecheck
npm run lint
npm test
npm pack --dry-run
```

## KPI expectations

The maintainer-confirmed M1 implementation focus is licensing/release readiness, while onboarding implementation is already complete. KPI evidence should therefore be recorded as follows:

- `M1-KPI-1` — First-run happy-path completion: use existing onboarding validation evidence from the merged welcome/onboarding work; no new onboarding implementation required.
- `M1-KPI-2` — Prompt count on accepted path: use existing welcome/onboarding validation evidence; no new onboarding implementation required.
- `M1-KPI-3` — Welcome requirement coverage: use existing test/session evidence from merged onboarding work; no new onboarding implementation required.
- `M1-KPI-4` — Enterprise license boundary readiness: `code/enterprise/LICENSE`, root carve-out notice, package metadata, and package dry-run evidence are complete before release automation.

## E2E / release-readiness test plan

1. Run existing onboarding validation/tests to confirm no regression from license-only changes.
2. Run `npm pack --dry-run`.
3. Inspect package contents for license files and `code/enterprise` inclusion/exclusion.
4. Confirm root `LICENSE.md` points to `code/enterprise/LICENSE` for enterprise code.
5. Confirm release-please sees only the intended commits and can generate the release without manual release-file edits.

## Feature flag and rollout

- Feature flag: not needed. License-boundary changes are repository/package governance, not runtime behavior.
- Rollout path: merge license-boundary PR(s) into the M1 milestone branch, validate package contents, then allow release-please to create the release.
- Rollback path: revert the license-boundary commit(s) before release if legal/package validation fails. If already released, publish a corrected patch release and update repository license notices immediately.

## Dependencies

No new runtime dependencies are planned. No new product libraries are needed.

## Open questions for execution

- What is the intended root non-enterprise license after adopting the Panopticon pattern: MIT like Panopticon, current BUSL-1.1, or another license?
- Should `code/enterprise` be included in the npm package or kept source-only?
- Is current Outfitter `LICENSE.md` the desired restrictive enterprise license text, or will legal provide a different `code/enterprise/LICENSE`?
