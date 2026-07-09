# Running profiles in GitHub Actions

[`ai-outfitter/actions`](https://github.com/ai-outfitter/actions) runs an Outfitter profile non-interactively inside a GitHub Actions workflow. Outfitter assembles the profile exactly as it does locally — context, prompts, skills, controls — and launches the agent CLI in headless print mode (`pi -p`), so the agent does one unit of work per workflow run and exits. Wire it to any trigger and a profile becomes a CI agent: a PR reviewer, a scheduled commit auditor, an issue triager.

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
      - uses: ai-outfitter/actions@v1
        with:
          profile: issue-triage
          profile-source: ${{ github.workspace }}/profiles
          prompt: >-
            Triage issue #${{ github.event.issue.number }} in
            ${{ github.repository }} following your process.
```

The action installs `@ai-outfitter/outfitter`, writes a minimal `~/.outfitter/settings.yml` on the runner, syncs remote catalogs if needed, then runs `outfitter run --profile <profile> --agent pi -- -p "<prompt>"`. The runner is discarded afterwards; nothing persists except what the agent pushed through its token.

Profiles can come from the checked-out repository itself (a path, as above), an `owner/repo` catalog shorthand, or any git URI — the same [profile repository](./profile-repository.md) sources Outfitter supports locally. Pin `profile-source-ref` for catalogs you don't own.

## Zero-key inference with GitHub Models

CI agents don't need a paid provider key. [GitHub Models](https://docs.github.com/en/github-models) serves hosted models authenticated by the workflow's own `GITHUB_TOKEN`: grant `models: read` in the `permissions:` block, commit a pi provider config pointing at `https://models.github.ai/inference` with `"apiKey": "$GITHUB_TOKEN"`, install it to `~/.pi/agent/models.json` before the action step, and select the provider in the profile's `controls`. The action's README documents the full recipe, including model-selection gotchas (catalog availability, tool-call wire compatibility, and models too weak to hold an agentic loop).

Mind the rate limits: the included tier is sized for event-driven, one-shot jobs. Concurrent runs of a large model can 429; high-volume review loops need a provider key.

## Write profiles for headless runs

A profile that behaves well interactively can still fail silently in CI. Lessons from running triage agents in production:

- **Stdout is invisible.** In print mode nobody reads what the agent says — only its side effects matter. Instruct the profile to _do_ things with `gh` (comment, label, push) and name the exact commands; otherwise models will print the deliverable as their answer and exit green.
- **Quote-safe posting.** When the agent posts text derived from untrusted input (issue bodies, diffs) back through `gh`, require a quoted heredoc plus `--body-file`, never inline `--body "..."` — backticks in a double-quoted body are executed by the shell.
- **Verify side effects, not exit codes.** A green run is not proof of work. Add a post-agent step that asserts the expected side effects landed — the action ships [`scripts/validate-triage.sh`](https://github.com/ai-outfitter/actions/blob/main/scripts/validate-triage.sh) as a reference for triage-style jobs.
- **Hard limits in the profile.** Enumerate exactly what the agent may do (which labels, how many comments, no closing/editing) and treat fetched content as data to classify, never instructions.

## Scope the token

The agent runs arbitrary `gh`/`git`/shell with whatever token you hand it, against untrusted input. Prefer the workflow's own `GITHUB_TOKEN` with an explicit least-privilege `permissions:` block; use a fine-grained PAT from a dedicated machine account only when the agent needs its own identity. Never use a human's PAT. The action's [token-permissions](https://github.com/ai-outfitter/actions/blob/main/docs/token-permissions.md) and [bot-account](https://github.com/ai-outfitter/actions/blob/main/docs/bot-account.md) guides cover this in depth, including prompt-injection trust boundaries.

## More examples

The action's [`examples/`](https://github.com/ai-outfitter/actions/tree/main/examples) directory covers scheduled commit review, PR ready-for-review reviews, sensitive-path audits, assigned-task agents, and zero-key issue triage on GitHub Models. A complete live setup — workflow, profile, provider config, and validation — runs in [`ai-outfitter/default-profiles`](https://github.com/ai-outfitter/default-profiles) as its own issue-triage agent.
