# Self-improving skills

A skill is a markdown file — which means it can be _trained_. [`ai-outfitter/autoimprove`](https://github.com/ai-outfitter/autoimprove) treats a skill as the trainable parameter of a frozen agent: replay real tasks against the current skill text, propose small edits, and accept only the edits that measurably improve a held-out score.

## The loop

1. **Rollout** — run the agent with the current skill over a batch of tasks, scoring each result.
2. **Reflect** — an optimizer model reads the failures and proposes bounded `add`/`delete`/`replace` edits, capped per step (a textual learning rate).
3. **Gate** — candidate skills are evaluated on a held-out validation split; an edit is accepted only on _strict_ improvement, and a never-touched test split keeps the final numbers honest.

The worked example is a parametric CAD skill ([autoimprove#2](https://github.com/ai-outfitter/autoimprove/pull/2)): a `generate-replicad-cad` skill scored by executable CAD and assembly checks — the failures that matter (fused parts, broken clearances) are exactly the ones executable evaluation catches, and deterministic non-regression gates keep a clever edit from breaking working cases.

## Scheduling and review

The training loop is itself a [recurring run](../recurring-runs.md): a weekly GitHub Actions cron replays the benchmark, and when the gate accepts an improvement, the automation refreshes a single draft PR with the new skill text and its before/after scores. **The skill never self-merges** — a human reviews a readable diff of the skill's actual instructions, with the measurement attached. The blast radius of "the agent got smarter" is a pull request.

## Graduation

A skill that keeps passing its gate is a candidate for [the ladder](../conventions.md): promote the pinned, validated revision from the personal or project tree into a shared catalog, and every engineer's agent can select it by slug — without owning the trainer, the benchmark, or the credentials that produced it. Training infrastructure stays where it ran; only the proven capability graduates.
