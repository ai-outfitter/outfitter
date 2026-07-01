# Implementation Plan

## Goal

Stop requiring routine `v8 ignore` annotations to preserve coverage by changing the CLI coverage gate from percentage chasing to an absolute uncovered-item budget.

## Branch

- **Name**: `codex/chore/coverage-policy`
- **Worktree**: `.claude/worktrees/codex-chore-coverage-policy`

## Scope

- **Change type**: TypeScript CLI workspace test/config policy
- **Build strategy**: npm validation from the repository root
- **Affected modules**: `code/cli/vitest.config.ts`, CLI source files with `v8 ignore` comments, foundation tests, contributor/architecture docs

## Validation Criteria

These criteria must be satisfied before the work is considered complete:

1. `npm test --workspace @ai-outfitter/outfitter -- tests/cli.test.ts` passes and verifies the new coverage policy text.
2. `npm run coverage` passes with absolute uncovered-item thresholds.
3. `npm run lint` passes after removing coverage comments and updating configuration.
4. `npx prettier --write <changed files>` leaves changed files formatted.

## Steps

### 1. Stabilize coverage validation

- **File**: `code/cli/src/compositeProfile/CompositeProfileWatcher.ts` or related watcher flow
- **Change**: Make the profile refresh behavior deterministic enough that the coverage suite can run reliably.

### 2. Switch coverage thresholds to absolute budgets

- **File**: `code/cli/vitest.config.ts`
- **Change**: Replace percentage thresholds with negative thresholds that cap uncovered statements, branches, functions, and lines.

### 3. Remove routine source coverage annotations

- **File**: `code/cli/src/**/*.ts`
- **Change**: Remove `v8 ignore` annotations that only exist to satisfy global percentage thresholds.

### 4. Update tests and docs

- **File**: `code/cli/tests/cli.test.ts`
- **Change**: Assert the coverage configuration uses V8 with absolute uncovered-item budgets.
- **File**: `CONTRIBUTING.md`, `docs/requirements/OFTR-001-project-foundation.md`, `docs/archtecture/README.md`
- **Change**: Document that coverage is still comprehensive, but enforced by fixed uncovered-item budgets instead of constant V8-ignore churn.

## Risks

- The uncovered-item budget must be calibrated from the coverage report after removing annotations.
- A too-large budget can hide new untested behavior, while a too-small budget recreates the original comment-chasing problem.
- The watcher test must stay aligned with OFTR-005.7 and should not weaken the requirement it validates.
