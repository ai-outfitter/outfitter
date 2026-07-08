# ai-outfitter marketing research and plan

Date: 2026-07-08. Sources: local repos under `ai-outfitters/` (outfitter, actions, outfitter-profile-catalog, deepwork, link, link-agent-workflows, actions-design-considerations, dot-github). All product claims below are grounded in repo READMEs, docs, and action.yml; aspirational items are marked.

## 1. Mission

Outfitter exists to make coding agents *expeditious* — not just effective, but fast. An agent loaded with every tool, prompt, and extension ever collected spends its context window carrying baggage instead of thinking; a tight, purpose-built profile preserves context headroom, which translates directly into better decisions and shorter paths to completion. Outfitter makes those profiles first-class artifacts: small, composable, versioned configurations of context, tools, prompts, skills, extensions, subagents, and workflows that individuals build for their own recurring modes of work, teams share through catalog repositories, and organizations publish as pinned, reviewable catalogs — then launches them through wrapped agent CLIs (Pi first, Claude Code supported, more adapters planned), interactively on a laptop or headless in CI. (Synthesized from `outfitter/docs/philosophy.md` and the org profile README.)

**Elevator pitch:** Outfitter is dotfiles for your coding agent — make, share, and switch the profiles your agents use, manually at your terminal or programmatically in GitHub Actions.

## 2. Product summary and features

### outfitter (the CLI — core product)

TypeScript CLI, published as `@ai-outfitter/outfitter` on npm (`npx @ai-outfitter/outfitter` to try). What it does today, per README and docs:

- **Profiles** — YAML files composing controls: provider/model/thinking selection, system prompt and `append_system_prompt` (including content pulled from repo files like `docs/architecture.md`), extensions, skills, prompt templates, environment/credentials, session directory, pass-through args, and DeepWork job selection.
- **Deterministic composition** — profiles resolve with documented precedence (project-local → project → user → catalog → inheritance → defaults); each run assembles a temporary "composite profile" config directory that Outfitter owns for the child agent's lifetime.
- **Adapters** — Pi is primary and most complete; a Claude Code adapter ships with documented gaps (see `docs/documentation/support-matrix.md`). Unsupported controls warn to stderr; `--strict` makes warnings fatal.
- **Profile sources** — sync shared catalogs from GitHub shorthand (`owner/repo`), any git URI, or local paths (`outfitter sync`); `outfitter setup` bootstraps a new machine from the default catalog.
- **Onboarding docs** for two audiences: first-time agent-CLI users and people migrating an existing Claude Code/Codex/Pi setup ("Switching to Outfitter").

### actions (GitHub Action wrapper)

`ai-outfitter/actions@v1` runs an Outfitter profile headless (`pi -p`) from any workflow trigger — one unit of work per run, then exit. Documented recipes: cron commit review, review on `ready_for_review`, path-sensitive audits (`infra/`, `auth/`, migrations), and "assigned to bot → complete the task and push a PR." Inputs cover profile id, profile source + pinned ref, agent adapter (`pi` or `claude`), token, git identity, strict mode. Notably strong security documentation: least-privilege `GITHUB_TOKEN`, dedicated machine accounts with fine-grained PATs (`docs/bot-account.md`, `docs/token-permissions.md`), prompt-injection trust boundaries, and pinning catalogs you don't own. The `actions-design-considerations` repo adds a scaling guide: per-automation profiles → repo-local reusable workflow → org-level reusable workflows (and why to avoid a single dispatcher).

### outfitter-profile-catalog (default-profiles)

The default profile source used by `outfitter setup`. Ships four profiles — `founder`, `engineer`, `data_analyst`, `reviewer` — plus a `personas` skill and prompts. The `data_analyst` profile demonstrates the depth possible: bundled DeepWork jobs (ad-hoc research reports, Finder pattern discovery, datasource onboarding, metric definition, experiment review, executive reports) and a `/demos` skill.

### deepwork (Pi extension package)

Native Pi package (`pi install git:github.com/ai-outfitter/deepwork`) providing DeepWork workflows, DeepWork Reviews, and DeepSchema — structured multi-step jobs, quality-gate reviews, and schema-validated writes — via native `deepwork_*` tools, `/review` and `/deepwork` commands, bundled standard jobs, and skills. No MCP server required. Licensed BSL-1.1 (the rest of the surveyed repos are MIT). Profiles can select DeepWork jobs, which is how the catalog's analyst bundle works.

### link / link-agent-workflows

Link "orchestrates project mission success": define and quantify what success means (KPIs), prioritize work against it, and measure the impact of what ships — built on deepwork primitives, with its own mission/KPI docs and an example project. `link-agent-workflows` is a near-identical copy of `link` (only `.github` and git metadata differ) — apparently a workflow-experimentation fork. Link is early/pre-launch: its own KPIs list baselines as "unknown" and its registry as "planned." Treat as an emerging application of the suite, not a shipped product.

### Supporting repos

- **dot-github** — the org profile README; also lists smaller Pi extensions (`ulta-tasklist`, `file-talk`, `bash-saver`) not present locally.
- **outfitter-cadence** — empty directory locally; nothing to market yet.

### How they fit together

Outfitter is the composition and launch layer; the profile catalog is the shared content that makes it useful on day one; deepwork supplies the workflow/review substrate profiles can bundle; the Action takes the exact same profiles into CI, so a profile tested locally (`outfitter run --profile pr-reviewer`) is the profile that runs headless on every PR. Link shows the ceiling: whole project-governance processes packaged as profiles + workflows.

## 3. Customer persona

### Primary: Maya Chen, staff engineer / de-facto "AI lead" on a platform team

**Role and context.** Staff engineer at a ~60-person product company, on a 6-person platform team. Nobody hired an "AI enablement" person, so Maya became one: she went deep on agent CLIs early, and now every team's agent setup is informally her problem.

**Day-to-day workflow.** She lives in a terminal agent (Pi or Claude Code) for her own work — refactors, reviews, infra changes — with a heavily tuned personal setup: system-prompt rules, skills, a couple of extensions, permission posture she trusts. She also fields a steady stream of "how did you set up your agent?" DMs, pastes config snippets into Slack, and watches teammates run bloated, inconsistent setups that produce slow sessions and un-reviewable agent behavior.

**The problem she is trying to solve.** Agent configuration at her company is tribal knowledge. Concretely:

- Every engineer's agent behaves differently; there is no reviewed, versioned "this is how our agents work here."
- Onboarding a new engineer to a good agent setup takes an afternoon of screen-sharing and still diverges within a week.
- Her own setup is a single ever-growing config that serves no task particularly well — the "composition over accumulation" failure mode the philosophy doc names.
- She wants agents in CI (PR review, path audits, issue-to-PR), but hand-rolling that means duplicating prompts inside workflow YAML, inventing a token model, and worrying about prompt injection with no reference to point security at.

**What success looks like.** A profile catalog repo in the org: `engineer`, `reviewer`, `platform-operator` profiles that are pinned, code-reviewed like any other artifact, and identical between a teammate's laptop and the CI reviewer. New hire setup is `outfitter setup` + pick a profile. Prompt changes are prose diffs in the catalog, not YAML escaping in workflows. When security asks "what can the CI agent do?", she points at a `permissions:` block and a fine-grained PAT doc instead of shrugging.

**Product-to-pain mapping.**

| Pain | Product answer |
| --- | --- |
| Tribal-knowledge agent config, inconsistent across the team | Outfitter profiles + catalog repos: versioned, shared, deterministic composition (org catalog use-case doc) |
| Bloated single setup, slow sessions | Small composable profiles; the philosophy's context-headroom argument is her lived experience |
| New-machine / new-hire setup cost | `outfitter setup <catalog>` bootstraps approved defaults |
| Wants CI reviewers/task agents without a platform build-out | `ai-outfitter/actions@v1` + example workflows; design-considerations doc gives the scaling path she'd otherwise have to derive |
| Security review of agents-with-tokens | token-permissions.md, bot-account.md, pinned `profile-source-ref` — reviewable answers, not vibes |
| Repeatable multi-step processes with quality gates | deepwork jobs/reviews, bundled per-profile (as the data_analyst catalog profile demonstrates) |

### Secondary (subordinate): Sam, solo power user

An indie developer or early-stage founder who runs several distinct modes of work — building, writing, analysis — from one terminal. Sam's problem is smaller: switching between good loadouts without hand-editing config. The `founder` and `data_analyst` catalog profiles and the "Switching to Outfitter" migration guide serve Sam directly. Sam matters mainly as a funnel: today's solo power user is next year's Maya, and `npx @ai-outfitter/outfitter` is the zero-commitment entry point.

## 4. Positioning

In Maya's language:

- **vs. raw Pi / Claude Code:** "The agent CLI is the engine; Outfitter is how I stop hand-tuning the engine before every drive. My teammates get my best setup as `outfitter run --profile engineer`, not a Slack paste. And when the profile is wrong, the fix is a reviewed diff in a repo, propagated by `outfitter sync`." Outfitter wraps the CLIs rather than replacing them — the support matrix is explicit about what translates per adapter and warns (or fails with `--strict`) on what doesn't, so there's no illusion of abstraction.
- **vs. dotfile-managing agent config by hand (symlinked `~/.claude`, checked-in `CLAUDE.md`s):** dotfiles capture one setup; profiles capture many, compose (personal baseline + team convention + task role), resolve deterministically, and are agent-CLI-portable at the control level.
- **vs. hosted "AI teammate" reviewers (Copilot-style):** the Action's pitch is literally "build your own Copilot-style reviewer" — except you own the prompt (in a reviewable profile), the model choice, the token scope, and the trigger logic, and the same profile runs on your laptop for debugging. No new SaaS, no data leaving your existing model-provider relationship.
- **vs. agent-orchestration frameworks:** Outfitter doesn't orchestrate multi-agent graphs; it makes single-agent runs reproducible and shareable, which is the layer teams actually lack. DeepWork adds structured workflows *inside* a run without an MCP server or extra infrastructure.

The honest caveat to keep in the open: Pi is the primary adapter and Claude Code support has documented gaps. Lead with Pi users and Pi-curious teams; sell Claude Code support as real but partial (which the support matrix already does well).

## 5. Marketing plan

Everything below targets reaching Maya (and Sam as funnel). Channels appropriate to a developer-tools OSS org: GitHub itself, npm, launch posts, and content that demonstrates rather than asserts.

### First 30 days (foundation — make discovery convert)

1. **GitHub Marketplace listing for `ai-outfitter/actions`** (highest leverage; the action.yml already has branding/description). Marketplace is where Maya searches "AI PR review action." The README's four trigger recipes are the listing copy. *Reaches Maya at the moment she's evaluating CI agents.*
2. **README/docs pass across the org.** The outfitter and actions READMEs are already strong; fix gaps: the org profile README points at `ai-outfitter/default-profiles` while the local repo is `outfitter-profile-catalog` — make naming consistent; fold `actions-design-considerations/docs/design-considerations.md` into the actions repo docs (it currently lives in a separate near-duplicate repo); resolve the `docs/architecture` vs `docs/archtecture` typo directory in outfitter; add a 60–90 second asciinema/GIF of `npx @ai-outfitter/outfitter` → setup → profile run at the top of the outfitter README. *First impression for every persona.*
3. **npm package page hygiene** — keywords, description, repo links for `@ai-outfitter/outfitter` so `npm search`/npmjs.com discovery works.
4. **Ship the demo profile catalog as the template** — add a "Use this template" catalog repo so Maya can fork an org catalog in one click (the org-profile-catalog use-case doc is the narrative; the default-profiles repo is the code).

### Days 31–60 (launch — earn the first wave of stars)

5. **Launch post: "Dotfiles for your coding agent."** The philosophy doc (expeditious agents, composition over accumulation, individual→team→enterprise stair-step) is already the essay; publish it with the demo GIF. Targets: Hacker News (Show HN), lobste.rs, r/LocalLLaMA / r/ExperiencedDevs, and the Pi community specifically (Outfitter is "the quickest path to a recommended Pi loadout" — that's a ready-made post for Pi's channels).
6. **Second post, for the Action: "Build your own PR-review agent in 20 lines of YAML — and scope its token properly."** The security docs are a genuine differentiator; almost nobody writing "AI in CI" content covers machine accounts, `permissions: {}`, and prompt-injection trust boundaries this concretely. This is the piece Maya forwards to her security team. *Directly answers her adoption blocker.*
7. **Example gallery in the actions repo** — the four example workflows exist; add real screenshots/links of runs (a bot PR comment, an audit finding) so the outcome is visible before anyone installs anything.

### Days 61–90 (content cadence and community)

8. **Recipe series (one per ~2 weeks), each mapping to a Maya pain:** "An org profile catalog in an afternoon," "From one agent to a fleet: scaling agentic workflows" (adapt the design-considerations doc — it's publishable as-is), "Migrating your Claude Code setup to a profile" (from switching-to-outfitter.md), "Bundling DeepWork jobs so your analyst profile ships its own workflows" (the data_analyst profile as worked example).
9. **Community surface:** enable GitHub Discussions on `outfitter` as the single front door; add a "share your profile" discussion category — profiles are small YAML, ideal community-contribution shaped objects; label good-first-issues in outfitter and the catalog.
10. **Adapter-roadmap transparency as marketing:** keep the support matrix current and public; a visible "Codex adapter" or "tool availability" roadmap column converts skeptical Mayas who need to know where the edges are.
11. **Measure:** stars on outfitter/actions, npm weekly downloads of `@ai-outfitter/outfitter`, Marketplace installs, and catalog-template forks — the same "KPIs as success signals" discipline Link preaches, applied to the org itself.

### Explicitly not yet (aspirational / unshipped — don't market)

- **Link** — pre-launch by its own KPI docs (baselines "unknown," registry "planned"). Mention only as roadmap/vision ("package whole project-governance processes as profiles") until it dogfoods successfully.
- **outfitter-cadence** — empty locally; nothing to say.
- Roadmap controls in the support matrix (tool availability, context files, theme, project override policy) — cite as roadmap, never as shipped.

## 6. Anticipated questions, objections, and points of confusion

What Maya (or her security team, or Sam) will ask or stumble on before adopting — and the doc/copy change that preempts each. These should be answered in READMEs and an FAQ before the day-31 launch posts, because launch traffic asks them all at once.

### Questions prospects will ask

| Question | Honest answer | Where to preempt |
| --- | --- | --- |
| "How is this different from just using Claude Code / Pi with a checked-in config?" | Dotfiles capture one setup; profiles compose many, resolve deterministically, and travel to CI unchanged. This is the core pitch — it must be the first paragraph of the outfitter README, not just the philosophy doc. | README opener + launch post |
| "What is Pi?" | Most of Maya's peers know Claude Code, not Pi. Every mention of Pi in outward-facing copy needs a one-line gloss and link, or the reader bounces. | READMEs, Action listing |
| "Does my code or prompt go anywhere?" | No — Outfitter wraps CLIs you already run; there's no hosted service. Say this explicitly; "AI tool" now defaults to "SaaS" in readers' minds. | FAQ, security docs |
| "What does it cost?" | The tools are free (MIT, deepwork BSL-1.1); you pay your existing model provider. State it — pricing silence reads as "pricing coming." | FAQ |
| "What happens when the CI agent does something wrong?" | Least-privilege tokens bound the blast radius; runs are one-shot; everything the agent can do is in `permissions:`. The token-permissions and bot-account docs are the answer — surface them from the Action README's first screen. | Action listing + post #6 |
| "Can I trust a profile catalog I don't own?" | Same trust model as any dependency: pin `profile-source-ref`. The action.yml already warns about unpinned sources; make the same warning prominent in CLI docs. | FAQ, sync docs |
| "Is Claude Code actually supported?" | Real but partial — the support matrix is the honest artifact. Link it wherever Claude Code is mentioned; a Maya who discovers gaps *after* adopting churns loudly. | Support matrix, everywhere |

### Points of confusion

- **Concept overload: profile vs catalog vs adapter vs agent vs job.** Five nouns before first run. A single labeled diagram (profile → composed by outfitter → launched via adapter → optionally bundling deepwork jobs; catalogs are where profiles live) belongs at the top of the outfitter README. Glossary in docs.
- **Naming drift.** Org README says `default-profiles`, the repo is `outfitter-profile-catalog`; the org is `ai-outfitter` but the local directory and some prose say `ai-outfitters`; the Action repo is just `actions` so the marketplace name ("Run Outfitter Profile") and repo name don't match. Pick one spelling of everything before launch (already flagged in plan item 2 — this is why it matters).
- **Where does configuration live?** Six-level precedence (project-local → project → user → catalog → inheritance → defaults) is a power feature that reads as complexity. Ship an `outfitter`-equivalent of `git config --show-origin` — or at minimum document a "why is my profile doing X" debugging page — before someone writes the "I couldn't tell which file won" blog comment.
- **CLI vs Action split.** Readers will ask "do I need the CLI to use the Action?" (no — the Action installs it) and "is the Action a different product?" (no — same profiles, headless). One sentence in each README pointing at the other resolves it.
- **Versioning across the suite.** The Action, the CLI, and catalogs version independently; the Action installs `@ai-outfitter/outfitter@latest` by default. That default surprises anyone who pins everything else — document the `outfitter-version` input next to the pinning guidance, and recommend pinning it in the same breath as `profile-source-ref`.
- **License split.** deepwork is BSL-1.1 while everything else is MIT. Enterprise Mayas run license scanners; a one-line "why BSL, what you can/can't do" note in deepwork's README avoids a silent disqualification.
- **`pi --print` / "one unit of work" mental model.** People expect CI agents to be long-running bots. The Action's run-once-and-exit model is simpler and safer, but say it plainly ("each trigger runs one agent session to completion — no daemon, no state") or users will look for the missing server.

Each confusion above is a support thread waiting to happen; resolving them in docs is cheaper than answering them in Discussions after launch — and several (naming drift, `@latest` default) are code/repo changes, not prose, so they belong in the first-30-days window.
