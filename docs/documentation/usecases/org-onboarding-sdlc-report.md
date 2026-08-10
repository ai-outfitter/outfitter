# Onboard an organization with an SDLC report

A runbook for the first engineer who brings agentic engineering to their
organization. The output is two artifacts: a baseline **SDLC report** that
says where the org sits on the [adoption ramp](../../philosophy.md), and the
org's **`.agents` repository** with that report as its first commit. The
report's gaps become the backlog; the repository becomes the place the org's
agent configuration lives from day one.

Who runs this: an engineer with read access to the org's repositories. No
org-wide rollout, approval, or infrastructure is required, and no agent
session either — the scan is one command. The whole runbook is one person,
one sitting, read-only until you create the repository.

## 1. Prerequisites

- `npx` (node 20.19+) or Docker.
- An authenticated `gh` CLI with read access to the org.
- Optional but valuable: your existing local checkouts of org repositories.
  The scanner reads them in addition to the forge API — local working trees
  show practice the forge cannot see, such as `.agents/` trees in progress
  and instruction files that were never committed.

## 2. Run the assessment

[`@ai-outfitter/link`](https://github.com/ai-outfitter/link) audits the org
against the catalog's governance baseline. Write the report straight into
the dated directory it will be committed from:

```sh
npx @ai-outfitter/link@1 report <org> \
  --out ~/repos/<org>/.agents/reports/sdlc/$(date +%F)-initial
```

Or with Docker, if you would rather not install anything:

```sh
docker run --rm -e GH_TOKEN="$(gh auth token)" -v "$PWD:/work" \
  ghcr.io/ai-outfitter/link:1 report <org>
```

Add your local checkouts as sources to widen the evidence — a single repo, an
owner folder of clones, or a whole `~/repos/` root:

```sh
npx @ai-outfitter/link@1 report <org> ~/repos/<org>
```

The scan is read-only: it lists repositories, reads git trees, and reads
effective branch rules. It never clones and never writes to the forge. It
samples at most the 30 most recently pushed repositories, and takes seconds
rather than minutes.

Naming a target scopes the report to it, so the file you are about to commit
into `<org>`'s repository describes `<org>` and nothing else.

You get one file, `report.json`, plus a copy in
`$XDG_DATA_HOME/outfitter-link/`. It contains, for each repository, a
maturity-ramp placement (level 0–5), the tree-derived signals behind it
(instruction files, `.agents/` trees, agent workflows, deploy manifests), and
a per-rule audit against the governance baseline. At org level it carries the
milestones that gate each rung, the `gaps` blocking the next one, and
`evidence_limits` — what the scan could not see, which bounds every claim in
it.

Read the `gaps` before moving on. They name what blocks the next rung, not
the top of the ramp.

To see the report rendered, with the workflow definitions beside it, clone
the repository and run `link web`.

### What the scan does not measure

The scanner decides everything from file trees and branch rules, so it is
fast, free, and reproducible — two runs of the same org agree apart from the
`generated_at` and `scanned_at` timestamps, which is what makes report diffs
a progress measure. The cost is that it reads no pull request history and
makes no judgments: no cycle time, no rework rate, no inventory of which
harnesses and model vendors are actually in use, and no duplication analysis
across teams.

When you want those, run the `sdlc-report` skill on a local coding harness as
a second, deeper pass. It answers the same question with an agent's judgment
instead of a checker's rules, and it emits recommendations. Start with
`link` — it is the cheap, repeatable baseline, and it is the one you will
re-run.

## 3. Create the org `.agents` repository

Create `<org>/.agents` on your forge and commit the report as its first
content. Repository hygiene, learned the hard way:

- The repository MUST NOT be public — private or internal visibility only.
  The report is an honest map of your org's gaps. (This organization
  publishes its own report deliberately, as a worked example. That is a
  choice about a reference; it is not the default.)
- If the repository already exists, commit only the report files. Leave any
  uncommitted work in the checkout untouched, and if the default branch is
  behind or checked out elsewhere, say so rather than silently moving it.

```text
<org>/.agents/
  README.md                      # what this repo is; link to the report
  reports/
    sdlc/
      YYYY-MM-DD-initial/
        report.json
```

The initial report is the baseline: re-run the scan after each change (a
quarterly cadence works, or after each rung climb) into a new dated
directory, and the diff between reports is your progress measure — milestones
met and rung movements, not anecdotes.

This repository is also where the org's shared agent configuration grows: an
`agents.md` with shared operating rules, role agents, skills, and a pinned
`settings.yml`, following the [organization catalog](./organization-profile-catalog.md)
conventions. Starting it with the report means the catalog's first commit
explains _why_ the org is adopting agents and what it will measure — every
later addition traces back to a gap in the baseline.

## 4. Act on the report

1. Take the first entry in `gaps` and automate that one workflow end to end —
   for example, feature idea → reviewed PR ([Actions](../actions.md),
   [in-cluster](../in-cluster.md)).
2. Add the shared resources the org lacks, so the next team composes instead
   of rebuilding. A repo whose `signals.catalog` is false is a candidate.
3. Wire session-log capture into the automated workflow before merge. The
   `session-capture` milestone is unmet in almost every first report, and it
   stays unmeasurable until workflows upload session artifacts behind a
   required check. Owning that record is what makes the next report richer,
   and it is the raw material for evals and improvement
   ([philosophy](../../philosophy.md)).
4. Schedule the re-run ([recurring runs](../recurring-runs.md)) and commit
   each new report beside the baseline.

## Boundaries

The scan is read-only; creating the `.agents` repository in step 3 is the
runbook's first write, done by you deliberately. The report contains repo
names, paths, and counts, never credentials or session content. Treat it as
internal: it is an honest map of your org's gaps.
