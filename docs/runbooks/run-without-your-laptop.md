# Run it without your laptop

**You are here:** your team shares a catalog, and an agent does real work — but only while someone sits in front of it. Close the laptop and the work stops. Nothing an agent did is reviewable after the terminal scrolls away.

**This runbook gets you to:** a workflow an event triggers, whose output lands through the same review gate a human's would, with the session transcript attached. That is rung 3 of [the adoption ramp](../philosophy.md#the-ramp-to-an-autonomous-lifecycle) — automated.

**Prerequisite:** [Share one catalog](./share-one-catalog.md). A triggered agent resolves its profile from a catalog; without one you are pinning nothing and every run can differ.

## 1. Pick a workflow you already do by hand

Not the most valuable one — the one you understand best. Issue triage, a release note, a dependency bump, a first-pass review.

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

## 4. Capture the session

The transcript is the difference between "the agent did something" and an auditable record. The action uploads the full session as a workflow artifact:

```yaml
- uses: ai-outfitter/actions@v1
  with:
    transcript-artifact: agent-session
    # …
```

`transcript-artifact-url` comes back as a step output, so the workflow can post the link on the pull request it opened. A reviewer then reads what the agent was asked and what it did, not just the diff.

Capture the session before the change lands, not after. A transcript attached to a merged change nobody read is a log; a transcript on the pull request is evidence a reviewer can use.

## Done when

Run an organization SDLC assessment. Three signals define this rung:

- `triggered-agents` — agents run from events rather than from a laptop.
- `protected-landing` — every repository where an agent lands changes enforces branch protection.
- `session-capture` — sessions are captured before a change lands.

## Your first step on the next rung

Notice what the workflow above cannot do: it wakes for one event, in one repository, and forgets everything when the job ends. It cannot be assigned an issue and pick it up, and it has no memory between runs.

Give one agent a name, an account, and somewhere to live — [Give the agent a residence](./give-the-agent-a-residence.md).
