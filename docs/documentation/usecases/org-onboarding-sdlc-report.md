# Onboard an organization with an SDLC report

A runbook for the first engineer who brings agentic engineering to their
organization. The output is two artifacts: a baseline **SDLC report** that
says where the org sits on the [adoption ramp](../../philosophy.md), and the
org's **`.agents` repository** with that report as its first commit. The
report's gaps become the backlog; the repository becomes the place the org's
agent configuration lives from day one.

Who runs this: an engineer who already uses a local coding harness (Pi,
Claude Code, or similar) and has read access to the org's repositories. No
org-wide rollout, approval, or infrastructure is required — the whole runbook
is one person, one afternoon, read-only until the final step.

## 1. Prerequisites

- A local coding harness with the `sdlc-report` skill available in its
  catalog.
- An authenticated forge CLI (`gh` for GitHub; `tea` or API tokens for
  Forgejo) with read access to the org.
- Optional but valuable: your existing local checkouts of org repositories.
  The assessment reads them in addition to the forge API — local working
  trees show practice the forge cannot see, such as harness configs and
  instruction files that were never committed.

## 2. Run the assessment

Ask your agent for an SDLC report of the org. The `sdlc-report` skill:

- confirms scope with you (org, sample size, whether private repos are in
  scope), capped at roughly 30 repos;
- gathers evidence from **both sources**: the forge API for org-wide
  inventory, workflows, required checks, and PR metrics, and your local
  checkouts for the ground truth of daily practice — every claim records
  which source it came from;
- never clones repositories and never writes to the forge;
- rates each repo and the org on the ramp (level 0–5), derives PR cycle time
  and rework rate where the forge data supports it, and lists what the scan
  could not see in `evidence_limits`.

You get `sdlc-report.json` (schema-validated, comparable across runs) and
`sdlc-report.md` (verdict, evidence, gaps, recommendations).

Read the recommendations before moving on. Each targets the org's next rung,
not the top of the ramp — typically: automate a single workflow end to end
before generalizing, and consolidate tools that multiple teams built
independently.

## 3. Create the org `.agents` repository

Create `<org>/.agents` on your forge and commit the report as its first
content. Repository hygiene, learned the hard way:

- The repository MUST NOT be public — private or internal visibility only.
  The report is an honest map of your org's gaps.
- If the repository already exists, commit only the report files. Leave any
  uncommitted work in the checkout untouched, and if the default branch is
  behind or checked out elsewhere, say so rather than silently moving it.

```text
<org>/.agents/
  README.md                      # what this repo is; link to the report
  reports/
    sdlc/
      YYYY-MM-DD-initial/
        sdlc-report.json
        sdlc-report.md
```

The initial report is the baseline: re-run the assessment after each change
(a quarterly cadence works, or after each rung climb) into a new dated
directory, and the diff between reports is your progress measure — cycle
time, rework rate, and rung movements, not anecdotes.

This repository is also where the org's shared agent configuration grows: an
`agents.md` with shared operating rules, role agents, skills, and a pinned
`settings.yml`, following the [organization catalog](./organization-profile-catalog.md)
conventions. Starting it with the report means the catalog's first commit
explains *why* the org is adopting agents and what it will measure — every
later addition traces back to a gap in the baseline.

## 4. Act on the report

1. Pick the top recommendation and automate that one workflow end to end —
   for example, feature idea → reviewed PR ([Actions](../actions.md),
   [in-cluster](../in-cluster.md)).
2. Add the shared resources the duplication findings call for, so the next
   team composes instead of rebuilding.
3. Wire session-log capture into the automated workflow before merge — the
   report's governance section will have told you where records currently go,
   which is usually nowhere. Owning that record is what makes the next report
   measurable, and it is the raw material for evals and improvement
   ([philosophy](../../philosophy.md)).
4. Schedule the re-run ([recurring runs](../recurring-runs.md)) and commit
   each new report beside the baseline.

## Boundaries

The assessment is read-only; creating the `.agents` repository in step 3 is
the runbook's first write, done by you deliberately — the skill itself asks
before it creates anything beyond the report files. The report contains repo
names, paths, and counts, never credentials or session content. Treat it as
internal: it is an honest map of your org's gaps.
