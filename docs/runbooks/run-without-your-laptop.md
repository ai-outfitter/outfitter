# Run it without your laptop

**You are here:** your team shares a catalog, and an agent does real work — but only while someone sits in front of it. Close the laptop and the work stops. Nothing an agent did is reviewable after the terminal scrolls away.

**This runbook gets you to:** a workflow an event triggers, whose output lands through the same review gate a human's would, with the session transcript attached. That is rung 3 of [the adoption ramp](../philosophy.md#the-ramp-to-an-autonomous-lifecycle) — automated.

**Prerequisite:** [Share one catalog](./share-one-catalog.md). A triggered agent resolves its profile from a catalog; without one you are pinning nothing and every run can differ.

## 1. Pick a workflow you already do by hand

Not the most valuable one — the one you understand best.

**Start with issue triage, then pull-request review.** Both are cheap to run in Actions: the trigger is a forge event the platform already delivers, and the credential is the job's own `GITHUB_TOKEN`. Both also have a prerequisite that decides how well they work. Add issue templates at `.github/ISSUE_TEMPLATE/` before triage, so the agent reads a typed form rather than guessing at prose; add `CODEOWNERS` before review, so the agent respects routing the forge already applies. `ai-outfitter/actions` ships both as examples — [`issue-triage-dispatch.yml`](https://github.com/ai-outfitter/actions/blob/main/examples/issue-triage-dispatch.yml) and [`review-undrafted-pr.yml`](https://github.com/ai-outfitter/actions/blob/main/examples/review-undrafted-pr.yml). Model configuration comes from your catalog's `models.json`, and the provider key is passed to the step as `env:`.

Run these two in Actions even if you already have a Kubernetes cluster. A cluster buys persistence between runs, runtimes longer than a job, and scope across repositories; triaging one issue and reviewing one pull request need none of the three, and a resident agent must first receive the event through a webhook receiver you build and a standing credential you rotate. Give an agent a residence when a job needs what a workflow cannot do — not for these two.

Never automate a workflow you have not first done manually. If you cannot write down what a good result looks like, you cannot tell whether the automated version worked, and you will end up trusting it because it ran rather than because it was right.

Write the acceptance criteria down before you write the workflow.

## 2. Give it a trigger

[`ai-outfitter/actions`](https://github.com/ai-outfitter/actions) runs an Outfitter profile as a GitHub Actions step. Point it at your catalog, pinned:

```yaml
- uses: ai-outfitter/actions@v1
  with:
    profile: triage
    profile-source: acme/.agents
    profile-source-ref: v0.1.0
    prompt: >-
      Triage issue #${{ github.event.issue.number }} …
```

The trigger is whatever event fits: `issues`, `pull_request`, `schedule`, `workflow_dispatch`. Start with the narrowest one that covers your case.

**Credentials.** Use the workflow `GITHUB_TOKEN` with an explicit `permissions:` block. It exists only for the job, so there is no standing credential to steal or rotate — the best case available, and the default you should have to argue your way out of.

You need more only when the agent must _be somebody_: assignable, requestable as a reviewer, or opening pull requests that trigger CI. That is a machine account with a **fine-grained** token — see [bot-account.md](https://github.com/ai-outfitter/actions/blob/main/docs/bot-account.md) and [token-permissions.md](https://github.com/ai-outfitter/actions/blob/main/docs/token-permissions.md). Never a classic PAT here; [the credential model](../architecture/forge-credential-model.md) explains why the ranking comes out this way.

## 3. Make the output land through a gate

An agent that can merge its own work is not automated, it is unsupervised. Protect the default branch and let the agent open pull requests that a human merges. Required checks apply to the agent exactly as they apply to a person.

Keep the bot out of `CODEOWNERS`, so its approval never satisfies a required review by itself.

## 4. Capture the session, then require it

The transcript is the difference between "the agent did something" and an auditable record. The action uploads the full session as a workflow artifact:

```yaml
- uses: ai-outfitter/actions@v1
  with:
    transcript-artifact: agent-session
    # …
```

`transcript-artifact-url` comes back as a step output, so the workflow can post the link on the pull request it opened. A reviewer then reads what the agent was asked and what it did, not just the diff.

Capture the session before the change lands, not after. A transcript attached to a merged change nobody read is a log; a transcript on the pull request is evidence a reviewer can use.

**Uploading is not yet a gate.** An artifact nothing requires is a courtesy — the next branch can drop the step and its change still lands. Make the capture report a status check, then require that check:

- Name the check so the convention is legible: a context under `evidence/`, or one containing `transcript`, `session-capture`, `audit-trail`, or `audit-log`.
- Require it on the default branch through a ruleset or branch protection. A ruleset file committed in the repository is an import source, not an active rule.
- Block direct pushes to the default branch. Requiring a pull request is the only preventive control available, because github.com runs no pre-receive hook; without it a commit lands having passed nothing.
- Give no actor an unconditional ruleset bypass. A break-glass path is fine, but it must be recorded and produce its own evidence — a silent exemption is not one.
- Let the check run at least once. Required and reporting are different facts, and a required check that never reports leaves a pending status and gates nothing.

The assessment reads the required check, not the uploaded file. A repository carrying every workflow and policy file that no rule requires is reported as **declared only**.

## Done when

Run `link review <org>`. Four milestones define this rung:

- `triggered-agents` — agents run from events rather than from a laptop.
- `agent-review` — adversarial review is automated. Link detects conventional
  workflow names; prepare and accept semantic evidence for a custom name.
- `protected-landing` — every repository where an agent lands changes enforces branch protection.
- `session-capture` — the capture reports a required check, direct pushes are blocked, no actor bypasses the ruleset unconditionally, and the check has actually reported on what landed.

## Your first step on the next rung

Notice what the workflow above cannot do: it wakes for one event, in one repository, and forgets everything when the job ends. It cannot be assigned an issue and pick it up, and it has no memory between runs.

Give one agent a name, an account, and somewhere to live — [Give the agent a residence](./give-the-agent-a-residence.md).
