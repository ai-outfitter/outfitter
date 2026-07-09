# SkillOpt Integration Plan

_2026-07-08. Decisions locked with Tyler this session. Companion context: microsoft/SkillOpt (arXiv:2605.23904), ai-outfitter/deepwork (Pi-native port), 2119 (enforcement kernel, just started at ~/experiments/2119)._

## Framing (agreed)

- SkillOpt and DeepWork are complements: DeepWork/2119 = runtime **enforcement** (hooks, gates — guarantees, at 2–3x run cost); SkillOpt = train-time **optimization** (skill markdown as the trainable parameter — near-zero runtime cost, probabilistic compliance).
- Max value is not distributing our own skills; it is making it easy for users to turn DeepWork jobs and agent sessions into trained skills. Compiler metaphor: **job.yml = source + test suite; trainer = compiler; skill.md = binary; outfitter = package manager.**
- DeepWork's review blocks + `process_requirements` are ready-made SkillOpt scorers (hard = structural checks, soft = LLM judge running the rubric text). Confirmed: the guided `new_job` flow already forces reviews on every deliverable-producing step ("Define Quality Reviews", Step 4), so guided jobs always have a scorer; hand-written jobs get reviews auto-generated as autoimprove's first stage.

## Locked decisions

1. **Phase 0 engine**: upstream Python SkillOpt as-is (custom env adapter). Port only after results justify it, with upstream as the reference baseline.
2. **Packaging**: standalone trainer lib in a new small repo under ai-outfitter (name TBD); ai-outfitter/deepwork and outfitter consume it as a dependency via thin integrations.
3. **Optimizer model**: configurable slot speaking OpenAI/Anthropic-compatible endpoints. Default = the user's harness model; one-line swap for provider/model; local models (Ollama/MLX) work through the same config. Suggested default tier: **mid-cost** (Sonnet-class) — optimizer calls are a small share of run cost but drive all edit quality; cheap-model optimizers measurably underperform in SkillOpt's own ablations.
4. **Sessions→skills scope**: multi-source from day one via an adapter interface — **pi, claude code, codex, hermes, openclaw, opencode**.

## Phase 0 candidate decision

**`daily_blog_ideas`** (~/experiments/202509-website) — freeze job.yml once Tyler finishes building it (soon). Chosen because: not yet in production (no output pollution), replayable by design (`npm run blog:ideas -- --as-of DATE` gives date-parameterized historical tasks → instant backfill + clean train/val/test split by date), and every stage has MUST-based review rubrics that convert directly to scorers.

Rejected for Phase 0 (both viable later):
- **Browser Anthropologist**: pollution solvable (per-day JSON replay in sandbox), but trajectories contain private personal data — needs the local-optimizer path first; also mostly deterministic sync plumbing, few skill-optimizable steps (analyze_patterns, write_journal).
- **A customer daily-context job**: prepare/apply split already isolates side effects, but live Slack inputs are non-replayable (breaks the validation gate) and trajectories contain customer data.
- **2119 dogfood** (phase 0.5, later): once 2119 development generates engineering trajectories, run the objective-scorer experiment (tests-green) there.

## Workstreams

### A — Phase 0 experiment (upstream Python; gates everything else)
1. Wait for blog job completion; freeze job.yml (record content hash).
2. Build the SkillOpt env (~100 lines + YAML): dataloader over historical run dates (backfill via scanner `--as-of`; target ≥30–60 dates, split ~2:1:7); rollout executes the daily_loop headless (pi -p or claude -p) in a scratch worktree with the candidate skill injected as system-prompt append; scorer auto-generated from job.yml review blocks (hard = outputs exist, required sections present, artifact paths resolve, no-draft-before-feedback ordering; soft = LLM judge running rubric text verbatim).
3. Human-in-the-loop step handling: `editorial_feedback` comes from the spawning session in production — for offline rollouts, replace with a frozen editorial-persona judge prompt so tasks stay replayable. (Open item: Tyler to sanity-check the persona prompt.)
4. Arms: (1) full DeepWork enforcement (current baseline), (2) bare agent + trained skill, (3) bare agent, no skill, (4) trained skill + light gates (2119-style MUST checks only). Metrics: rubric pass rate, hard score, $ cost, wall-clock.
5. Success criteria: validation gate accepts ≥1 edit; arm 2 or 4 closes a majority of the rubric-pass gap vs arm 1 at materially lower cost.

### B — Standalone trainer lib (TS, new ai-outfitter repo; can start in parallel — cheap)
- Implements the paper's loop, not a port of their code: rollout interface → reflect → bounded add/delete/replace patches with textual learning rate → held-out validation gate → rejected-edit buffer. Slow/meta updates = v2.
- Model access solely via OpenAI/Anthropic-compatible endpoint config (decision 3).
- Acceptance test: reproduce upstream Phase 0 results on the same env within noise.
- Naming TBD by Tyler.

### C — `deepwork autoimprove` (thin integration in ai-outfitter/deepwork, after A+B)
Pipeline: ensure reviews exist (auto-generate via new_job Step-4 instructions if missing) → compile job.yml into env (dataloader from run history, scorer from reviews/process_requirements) → train via lib → stage `proposed_SKILL.md` + diff + report for human adoption → optionally publish adopted skill as an outfitter profile asset with validation provenance.

### D — Sessions→skills (after B; independent of A's outcome)
- `SessionSource` adapter interface (discover sessions, normalize to a common trajectory format) with readers for pi, claude code, codex, hermes, openclaw, opencode. Outfitter's adapter layer already knows each harness's state dirs — natural home for discovery.
- Borrow SkillOpt-Sleep's pipeline shape: mine recurring tasks → replay offline → optional synthesized ("dream") training variants with the never-in-val/test invariant → gate on held-out real tasks → stage proposals, human-approved adoption.

### E — Upstream contributions (after A; requires Tyler's explicit approval before any GitHub action)
- DeepWork/job-rubric env adapter example to microsoft/SkillOpt.
- Fixes toward their plugin self-containment issues (#106/#107).

## Sequencing

A first (B may start in parallel) → C after A validates and B passes acceptance → D after B → E after A. 2119 continues independently as the enforcement kernel; skill-promotion path ("promote a skill into a 2119-gated job when guarantees are needed") stays on the roadmap.

## Open items

- Trainer lib name (Tyler).
- Editorial-persona judge prompt for Phase 0 rollouts (Tyler sanity-check).
- How far back the blog scanner's sources actually reach (determines backfill task count) — verify when the job is frozen.
