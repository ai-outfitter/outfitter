# Shared conventions without duplication

Every agent that touches a repository should write [Conventional Commits](https://www.conventionalcommits.org/): the engineer agent, the marketing agent that occasionally commits copy, the CI bot that opens automated PRs. The rule is universal — and that is exactly what makes it dangerous to manage naively.

## The failure mode

The naive path pastes the rule into every `agent.md`, every project's `CLAUDE.md`, every teammate's personal prompt. Now there are N copies: they drift as people tweak wording, every copy occupies every context window on every run, and a new agent starts without the rule until someone remembers. Making it a skill is the subtler mistake — a skill implies an _activation decision_, and no agent should ever spend a thought deciding whether commit formatting applies. It should simply always be true.

## The composition

Author the rule **once, at the most general layer where it holds**, and let every layer below inherit it:

```markdown
<!-- org catalog: .agents/agents.md -->

Use Conventional Commits for every commit message, with scopes
(for example `fix(setup): ...`, `docs(runtime): ...`).
```

- **Every user, every project, every agent** composed from the org catalog now carries the rule — one authored copy, zero activation cost, no per-agent duplication.
- **A single user** who wants it everywhere on one machine before the org adopts it drops the same line in `~/.agents/system-prompt.md` — the quickest way to give everything you run a shared rule.
- **A project that differs** (say, a repo that squash-merges with its own title format) ships its own shared context in `<repo>/.agents/` — workspace precedence wins for that repo only. Note the granularity: today the root shared-context file wins _whole_, not line by line (fragment-level override is the [roadmap primitive](../conventions.md#roadmap-a-shareable-prompt-fragment)), so the project file deliberately carries the shared context it still wants — a reviewable replacement in the repo it affects.
- **Enforcement stays deterministic** — a `commit-msg` [hook](../hooks.md) or release tooling backstops the rule mechanically; the ambient line keeps the model writing it right the first time.

The same placement works for every ambient rule: secret hygiene, small reversible changes, "write decisions into repository files." The test is the [conventions](../conventions.md) split — if the agent should never _decide_ about it, it belongs in shared context, not in a skill.

## A second fragment: repository layout

A second convention of the same shape — illustrative here, and the kind of rule a default catalog adopts as `project-repos` — standardizes where code lives on a machine:

```markdown
<!-- default catalog shared context -->

Repositories are checked out at `~/repos/<org-or-username>/<repo>/`;
linked worktrees live beside them at
`~/repos/<org-or-username>/<repo>.worktrees/`.
```

The value is ambiguity reduction: every agent — and every skill that clones, opens a worktree, or navigates between projects — knows where a repository lives without asking or guessing, and automation composed from the catalog can rely on the same paths on every machine. A user who keeps a different layout supplies their own amended shared context in `~/.agents` (a whole-file replacement today — per-fragment override is the [roadmap primitive](../conventions.md#roadmap-a-shareable-prompt-fragment)) and keeps using the shared profiles unchanged — or builds their own profiles from scratch. Either way the catalog never forks over a filesystem preference.

## Reaching native harness runs

Composition only helps runs that go through it — the rule should also reach a bare `claude` session that never touches Outfitter. The porting design ([Porting a Claude Code setup](../porting-claude.md)) maps `~/.claude/CLAUDE.md` to `~/.agents/agents.md` with a symlink back, so native Claude Code reads the protocol tree and editing either view edits the same file; managed porting and persistent harness symlinks — including the generalization of projecting composed shared context into each harness's home-level memory file — are deferred to [#187](https://github.com/ai-outfitter/outfitter/issues/187).

## Payoff

One rule, authored once, inherited by every user, org, and project layer; overridable exactly where it should differ; enforced mechanically; visible in native harnesses. The context cost across the whole fleet is a single line — and when the org rewords the rule, one PR to one file updates every agent's next run.
