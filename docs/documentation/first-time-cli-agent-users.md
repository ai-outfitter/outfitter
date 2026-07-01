# First-time CLI agent users

This guide is for people who have never used Claude Code, Codex, Pi, or another terminal agent. Outfitter gives you a curated Pi setup; this page explains the working model so the first session feels powerful instead of mysterious.

## Start with YOLO mode, then understand permissions

Most people first enjoy agent CLIs when they let the agent act: read the repo, edit files, run tests, and iterate without stopping for every tiny approval. That is the “YOLO mode” feeling: the agent can move at software speed while you steer the goal.

Use it intentionally:

```text
Goal: make the failing test pass.
You may inspect files, edit code, and run project tests.
Ask before deleting files, changing dependencies, touching credentials, or publishing anything.
```

Permissions are the safety boundary. A good session says what the agent may do, what it must ask about, and what evidence proves the job is done. Outfitter’s default profile catalog is meant to provide useful defaults, but you still own the trust decision for each project and command.

Good first permission rules:

- Let the agent read project files and run local tests.
- Let it make small edits in a git branch or worktree.
- Require approval for dependency changes, destructive shell commands, production data, credentials, publishing, releases, payments, legal filings, merges, and force-pushes.
- Ask for a short plan before broad rewrites.

## Context engineering

Agent CLIs work best when you shape the context, not when you paste everything. Basic context engineering starts with `AGENTS.md`: a repository-local instruction file that tells the agent how the project works, what commands are safe, what evidence matters, and what rules must survive across sessions.

A useful first `AGENTS.md` can be small:

```md
# Agent instructions

- Read `README.md` and `package.json` before changing code.
- Use `npm test -- --runInBand path/to/test` for narrow test runs when possible.
- Ask before deleting files, changing dependencies, or editing release config.
- Treat docs in `docs/requirements/` as product requirements.
```

Then ask the agent to use that context:

```text
Read AGENTS.md, the README, package scripts, and the failing test before editing.
Then propose a three-step plan with acceptance criteria.
```

Outfitter profiles can store reusable personal context, while `AGENTS.md` keeps project context in the repo. Pi also supports extension-provided tools and skills; the default profile catalog may include skills that add project-governance, review, or browser/testing instructions to the session.

## Planning mode

Planning mode is provided by the plan Pi extension installed in the current Outfitter profile. In the default Outfitter Pi setup, use the plan-mode keybinding (`Shift+Tab`) to toggle from build mode into plan mode before broad changes. Plan mode keeps the agent in an investigation/design posture: read, inspect, and propose; do not write the implementation yet.

Use the plan-mode keybinding when:

- the change spans multiple files;
- you do not know the repo conventions;
- the task mixes product, docs, and code;
- the cost of a wrong edit is high.

Example after toggling plan mode:

```text
Goal: add a settings flag for quiet startup.
Find the relevant command, settings schema, tests, and docs.
Return the expected commits and validation commands.
```

A strong plan includes checkable requirements: “MUST update the schema,” “MUST preserve non-interactive behavior,” “SHOULD add a regression test.” Toggle back to build mode when you want the agent to implement the approved plan.

## Subagents

A subagent is another agent process given a focused task. Use subagents when one agent should keep the main plan while another does isolated research or implementation.

Two common patterns:

```text
One focused agent:
Fix this bug in the current branch. Inspect, edit, test, and report the diff.
```

```text
One agent managing subagents:
Create a plan. Delegate implementation to a subagent in a worktree. Review the subagent diff before committing.
```

Subagents are useful for:

- independent research;
- code review;
- implementation in a clean worktree;
- comparing approaches;
- keeping risky experiments away from the main checkout.

Whether subagents are available depends on the active Pi/Outfitter profile and extensions. The default profile catalog may include subagent definitions or guidance; vanilla agent CLIs differ in what they provide out of the box.

## Skills

A skill is packaged instruction for a recurring job. Inside Pi, active skills are invoked as slash commands, for example `/skill:generated-daily-report`. Instead of teaching the agent your report, review, or research process every time, a skill can define how to run it, what files matter, and what “done” means.

Try inside Pi:

```text
/skill:generated-daily-report
```

Then provide the goal or inputs the skill asks for. Other examples might be project review, browser testing, release notes, or incident summaries, depending on what the active profile installed.

Skills may come from Pi packages, from the Outfitter default profile catalog, or from a project-local `.outfitter` profile. If a skill is not active, ask Pi what skills it can see before relying on it.

## Extensions and tools

Extensions add tools and UI affordances to Pi. For example, an extension can expose a browser tool, a structured question UI, a GitHub helper, or an Outfitter setup command. These are not all vanilla Pi features; they appear when the active profile loads the relevant Pi package or extension.

Ask:

```text
What tools and skills are active in this session? Which came from Pi, which came from Outfitter, and which came from project-local config?
```

That question teaches you the session’s actual capability boundary before you depend on a tool.

## First useful session script

Paste this into your first serious agent session:

```text
I am new to CLI agents.
Goal: help me make one small, safe improvement in this repo.
First, inspect the repo entry points and explain the project shape.
Second, propose a plan with acceptance criteria.
Third, wait for my approval before editing.
You may read files and run non-destructive discovery commands.
Ask before deleting files, changing dependencies, pushing, publishing, or touching credentials.
```

After a few sessions, move the reusable parts into an Outfitter profile so every launch starts with your preferred operating style.
