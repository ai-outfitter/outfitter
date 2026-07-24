# Running an agent in GitHub Actions

[`ai-outfitter/actions`](https://github.com/ai-outfitter/actions) is the GitHub Actions execution surface for Outfitter [agents](./agents.md). The planned interface asks Outfitter to resolve and compose the selected agent — the same loadout it would compose locally — then launches the harness in headless print mode, so the agent does one unit of work per workflow run and exits.

> **Status:** the `.agents`-native `ai-outfitter/actions@v2` interface described on this page is a design preview and is not published. The current `@v1` Action uses the removed profile-era `profile`, `prompt`, and `profile-source` inputs and must be pinned to a compatible pre-v1 Outfitter release. Do not copy the workflow below until `@v2` is released.

```yaml
# .github/workflows/issue-triage.yml
name: Issue triage
on:
  issues:
    types: [opened]

permissions:
  contents: read
  issues: write
  models: read

jobs:
  triage:
    if: github.event.issue.user.type != 'Bot'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ai-outfitter/actions@v2
        with:
          agent: issue-triage
          source: ${{ github.workspace }}/.agents # or owner/.agent + a pinned ref
          inputs: |
            issue_number: ${{ github.event.issue.number }}
            repository: ${{ github.repository }}
```

The Action consumes an agent ID, a local or pinned remote source, structured inputs, and runtime-only options (harness, credentials, working directory). It does not reproduce composition logic itself — it goes through Outfitter's resolver so a CI run and a local run compose identically given the same sources and refs.

> **Note:** a dedicated **task**-bake path — freezing a named work contract and its typed inputs into an immutable artifact before launch — is the subject of a [separate upcoming RFC](./tasks.md). Until then the Action runs an agent with structured inputs; the `inputs:` shape above is forward-compatible with that work.

## Division of ownership

The workflow YAML owns the GitHub side; the agent owns the work:

| Workflow YAML owns                         | Agent owns                          |
| ------------------------------------------ | ----------------------------------- |
| Triggers (`on:`)                           | The objective and prompt            |
| Checkout                                   | Identity and posture                |
| `permissions:` and credentials             | Its loadout: skills, subagents, mcp |
| Execution identity                         | How it uses its inputs              |
| Trusted event identifiers passed as inputs | Completion behavior                 |
| GitHub-specific result handling            |                                     |

Pass only the identifiers the agent expects (numbers, SHAs, repository names, workflow-owned discriminators). Never interpolate issue bodies, PR bodies, comments, diffs, or fetched page content into inputs — user-influenced values like titles and branch names are opaque identifiers, not instructions. A selected skill retrieves untrusted source material itself with trusted tools.

## Setup: the `outfitter-actions` skill

The workflow surface is installed and maintained by the `outfitter-actions` setup skill shipped in the `ai-outfitter/actions` catalog, which includes the reusable workflow template (`template/github-action.yml`). Run it in an agent session to create or update your project's workflows.

The setup skill consolidates compatible agents into as few workflows as practical: separate workflows are justified only by different triggers, permissions, credentials, isolation, or other GitHub-enforced boundaries. Domain skills such as `reports` or `issue-triage` do not ship their own workflow templates.

## Zero-key inference with GitHub Models

CI agents don't need a paid provider key. [GitHub Models](https://docs.github.com/en/github-models) serves hosted models authenticated by the workflow's own `GITHUB_TOKEN`: grant `models: read` in the `permissions:` block and point the tree's `models.json` at `https://models.github.ai/inference` with `"apiKey": "$GITHUB_TOKEN"`. The Action's README documents the full recipe, including model-selection gotchas (catalog availability, tool-call wire compatibility, and models too weak to hold an agentic loop).

Mind the rate limits: the included tier is sized for event-driven, one-shot jobs. Concurrent runs of a large model can 429; high-volume review loops need a provider key.

## Write agents for headless runs

A composition that behaves well interactively can still fail silently in CI. Lessons from running triage agents in production:

- **Stdout is invisible.** In print mode nobody reads what the agent says — only its side effects matter. Make the agent's completion criteria name the exact `gh` side effects (comment, label, push); otherwise models will print the deliverable as their answer and exit green.
- **Quote-safe posting.** When the agent posts text derived from untrusted input (issue bodies, diffs) back through `gh`, require a quoted heredoc plus `--body-file`, never inline `--body "..."` — backticks in a double-quoted body are executed by the shell.
- **Verify side effects, not exit codes.** A green run is not proof of work. Add a post-agent step that asserts the expected side effects landed — the Action ships [`scripts/validate-triage.sh`](https://github.com/ai-outfitter/actions/blob/main/scripts/validate-triage.sh) as a reference for triage-style jobs.
- **Hard limits in the contract.** Enumerate exactly what the agent may do (which labels, how many comments, no closing/editing) in the agent's own definition, and treat fetched content as data to classify, never instructions.

## Scope the token

The agent runs arbitrary `gh`/`git`/shell with whatever token you hand it, against untrusted input. Prefer the workflow's own `GITHUB_TOKEN` with an explicit least-privilege `permissions:` block; use a fine-grained PAT from a dedicated machine account only when the agent needs its own identity. Never use a human's PAT. The Action's [token-permissions](https://github.com/ai-outfitter/actions/blob/main/docs/token-permissions.md) and [bot-account](https://github.com/ai-outfitter/actions/blob/main/docs/bot-account.md) guides cover this in depth, including prompt-injection trust boundaries.

Pin remote sources consumed in CI to full commit SHAs — see [Trust and review](./catalogs.md#trust-and-review).

## More examples

The Action's [`examples/`](https://github.com/ai-outfitter/actions/tree/main/examples) directory covers scheduled commit review, PR ready-for-review reviews, sensitive-path audits, assigned-task agents, and zero-key issue triage on GitHub Models. A complete live setup runs in [`ai-outfitter/.outfitter`](https://github.com/ai-outfitter/.outfitter) as the organization's own `weekly-kpis` agent.
