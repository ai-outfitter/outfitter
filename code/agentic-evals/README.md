# Agentic Evals

End-to-end evaluations that exercise a specific workflow with a specific
[profile](../../docs/documentation/profiles.md) and assert that the run
produces an expected artifact. Where unit tests verify Outfitter's plumbing,
agentic evals verify the outcome: "when a user with this profile runs this
workflow, do they end up with the thing they came for?"

Each eval takes the shape:

```
profile + workflow (prompt / recorded input) ──▶ agent run ──▶ expected artifact
```

The artifact might be a generated HTML report, a code-review finding, a
passing hidden test suite, or answers to a set of questions — anything that
can be checked declaratively after the run completes.

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHALL**, **SHALL NOT**,
**SHOULD**, **SHOULD NOT**, **RECOMMENDED**, **MAY**, and **OPTIONAL** in this
document are to be interpreted as described in
[RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

## Planned evals

| Eval                             | Profile        | Workflow                                                                                                                 | Expected artifact                                                                   |
| -------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `data-analyst-healthcare-report` | `data_analyst` | Run through the data-analyst demo against a healthcare dataset                                                           | An HTML report summarizing the healthcare data                                      |
| `founder-demo-video`             | `founder`      | Feed the founder profile a recorded product demo (video/transcript)                                                      | A usable output derived from the recording (e.g. summary, launch notes, follow-ups) |
| `engineer-code-review`           | `engineer`     | Run the code-review agent against an example project seeded with a known-ugly bit of code                                | A review finding that identifies the planted code smell                             |
| `engineer-hidden-tests`          | `engineer`     | Implement the task described in a gitignored `TASK.md`, HackerRank-style: unit tests exist but are hidden from the agent | The hidden test suite passes after the agent's implementation                       |

Notes on the two engineer evals:

- **engineer-code-review** seeds an example project with a deliberately ugly
  bit of code or code smell (e.g. a copy-pasted function with a subtle
  divergence, a mutable default, an N+1 query). The eval passes if the
  review output flags the planted smell.
- **engineer-hidden-tests** ships a `TASK.md` (gitignored so it never lands
  in the example project's history) describing what to build. The unit tests
  that grade the implementation are withheld from the agent's context — the
  harness runs them only after the agent finishes, like a HackerRank hidden
  test case.

## Declarative eval definitions

Every eval is described by a declarative YAML file — inputs, outputs,
question/answer checks, and the profile under test — so evals can be added
without touching the harness.

Illustrative shape (subject to change until the harness lands):

```yaml
# code/agentic-evals/evals/data-analyst-healthcare-report/eval.yml
id: data-analyst-healthcare-report
profile: data_analyst # profile under test
agent: pi # pi today; claude planned
workflow:
  prompt: |
    Run through the demo using the healthcare dataset and produce a report.
inputs:
  - path: fixtures/healthcare.csv
outputs:
  - path: report.html # artifact that MUST exist after the run
    assertions:
      - kind: exists
      - kind: contains
        value: '<html'
questions: # graded Q&A against the run's output
  - ask: 'Which condition had the highest readmission rate?'
    expect: 'heart failure'
```

## Profile matrix

Evals are not just pass/fail gates — they are how we measure which profile
configurations actually work better. Each eval can declare a **matrix** of
profile variants, and the harness runs the same workflow once per variant so
results are directly comparable: skill vs. append_system_prompt, subagents
enabled vs. disabled, tool-call limits, different models, thinking levels
on/off, and so on.

```yaml
# eval.yml (continued)
matrix:
  base_profile: engineer
  variants:
    - id: skill
      overrides:
        skills: [code-review]
    - id: system-prompt
      overrides:
        skills: []
        controls:
          append_system_prompt:
            - repo_file: prompts/code-review.md
    - id: no-subagents
      overrides:
        controls:
          subagents: false
    - id: haiku-low-thinking
      overrides:
        controls:
          model: claude-haiku-4-5
          thinking: low
    - id: thinking-off
      overrides:
        controls:
          thinking: off
  repeat: 3 # runs per variant, for pass-rate stability
```

Each variant is the base profile plus a set of declarative overrides — the
same control surface profiles already expose. A variant id combined with the
eval id and run number identifies every result.

## Metrics and recorded results

Every run records a standard set of metrics alongside the pass/fail grading,
and results are committed so we can track profile performance over time and
across the matrix.

Standard metrics per run:

| Metric                                   | Description                                                                             |
| ---------------------------------------- | --------------------------------------------------------------------------------------- |
| `wall_time_seconds`                      | Total run duration                                                                      |
| `tokens_in` / `tokens_out`               | Prompt and completion tokens consumed                                                   |
| `tool_calls`                             | Total tool invocations, plus a per-tool breakdown                                       |
| `turns`                                  | Agent turns taken to finish                                                             |
| `coverage_percent`                       | Test coverage of the produced code (only for evals that declare a coverage requirement) |
| `lines_changed`                          | Lines of code added/removed vs. the fixture                                             |
| `assertions_passed` / `assertions_total` | Grading outcome per run                                                                 |
| `cost_usd`                               | Estimated spend, when the adapter exposes it                                            |

An eval opts into task-specific metrics declaratively:

```yaml
# eval.yml (continued)
metrics:
  coverage:
    command: npm test -- --coverage # run by the harness after the agent finishes
    minimum: 80 # optional gate: below this, the run fails
```

Results are written as one JSON file per run and committed to the repo:

```
code/agentic-evals/results/
└── engineer-hidden-tests/
    └── 2026-07-02T14-30-00Z/         # one directory per harness invocation
        ├── summary.json               # matrix-wide rollup
        ├── skill/run-1.json
        ├── skill/run-2.json
        ├── system-prompt/run-1.json
        └── ...
```

```json
// results/engineer-hidden-tests/2026-07-02T14-30-00Z/skill/run-1.json
{
  "eval": "engineer-hidden-tests",
  "variant": "skill",
  "run": 1,
  "agent": "pi",
  "passed": true,
  "assertions": { "passed": 6, "total": 6 },
  "metrics": {
    "wall_time_seconds": 412,
    "tokens_in": 184223,
    "tokens_out": 22190,
    "tool_calls": 47,
    "turns": 19,
    "coverage_percent": 91.4,
    "lines_changed": 312
  }
}
```

## Agent-graded evaluation

Mechanical assertions can't rank qualitative outputs — two variants may both
produce a working design, an HTML report, or a refactor, and we still want to
know which is better. For that, an eval can declare an **evaluator**: an
agent run that receives the artifacts from two or more variants and grades
them against a rubric.

```yaml
# eval.yml (continued)
evaluation:
  mode: pairwise # pairwise | rubric | rank
  evaluator_profile: engineer # profile used for the judging run
  inputs:
    - artifact: report.html # what the judge sees from each variant
  rubric:
    - criterion: 'Correctly identifies the top-level findings'
      weight: 3
    - criterion: 'Design is clear and self-explanatory'
      weight: 2
    - criterion: 'No fabricated data'
      weight: 5
  blind: true # judge MUST NOT know which variant produced which artifact
```

The judge's scores land in `summary.json` next to the mechanical metrics, so
a matrix comparison reads as: pass rate, cost, speed, and judged quality per
variant.

## Requirements

### Eval definitions

1. Each eval **MUST** live in its own directory under
   `code/agentic-evals/evals/<eval-id>/` with a declarative `eval.yml` as its
   single source of truth.
2. An eval definition **MUST** declare the profile under test, the workflow
   input (prompt and/or recorded input), and at least one expected output.
3. Inputs, expected outputs, and question/answer checks **MUST** be expressed
   declaratively in YAML; eval-specific imperative scripts **SHOULD NOT** be
   required and, when unavoidable, **MUST** be invoked from the YAML rather
   than hard-coded in the harness.
4. Fixtures an eval depends on (datasets, example projects, recordings)
   **MUST** be checked in under the eval's directory or fetched
   deterministically by the harness — an eval **MUST NOT** depend on
   undeclared network or machine state.
5. For hidden-test evals, the grading tests **MUST NOT** be visible to the
   agent during the run (excluded from the composite profile / working tree),
   and task files like `TASK.md` that are injected at runtime **MUST** be
   gitignored in the example project.

### Harness and execution

6. The harness **MUST** launch runs through Outfitter-managed profiles using
   `pi -p` (non-interactive prompt mode) and **SHOULD** be built so that
   `claude -p` can be added as a second adapter without changing eval
   definitions.
7. Runs **MUST** be non-interactive: an eval that stalls waiting for human
   input is a failure, and the harness **MUST** enforce a per-eval timeout.
8. Each run **MUST** execute in an isolated workspace (fresh copy of the
   fixture project) so evals cannot contaminate each other or the repo.
9. The harness **MUST** grade every declared output assertion and every
   question/answer check, and **MUST** report pass/fail per assertion, not
   just per eval.
10. The harness **SHOULD** capture the full agent transcript and produced
    artifacts for each run so failures can be inspected after the fact.
11. Evals **MAY** be non-deterministic; the harness **SHOULD** support
    repeating an eval N times and reporting a pass rate rather than a single
    boolean.

### Grading

12. Artifact assertions (file exists, contains, matches) **MUST** be graded
    mechanically by the harness.
13. Question/answer checks **MAY** be graded by an LLM judge; when they are,
    the judge prompt and expected answer **MUST** come from the eval's YAML,
    and the judge **MUST NOT** see the agent's transcript beyond what the
    eval declares.
14. A planted-defect eval (e.g. `engineer-code-review`) **MUST** define what
    counts as "finding" the defect precisely enough that grading is
    reproducible.

### Profile matrix

15. An eval **MAY** declare a matrix of profile variants; when it does, each
    variant **MUST** be expressed as a set of declarative overrides on a base
    profile using the same controls profiles already expose (skills,
    `append_system_prompt`, subagents, tool-call limits, model, thinking
    level, etc.).
16. The harness **MUST** run every declared variant through the identical
    workflow and fixtures, differing only in profile configuration, so
    results are directly comparable.
17. Every result **MUST** be attributable to a specific eval id, variant id,
    and run number.
18. Matrix evals **SHOULD** declare a `repeat` count; single-run comparisons
    between variants **SHOULD NOT** be treated as significant.

### Metrics and recorded results

19. The harness **MUST** record wall time, token usage (in/out), tool-call
    count, and turn count for every run, and **SHOULD** record per-tool
    breakdowns and estimated cost when the adapter exposes them.
20. Evals whose task produces code **MAY** declare a coverage metric; when
    declared, the harness **MUST** run the coverage command after the agent
    finishes and record coverage relative to the produced code, and **MAY**
    enforce a declared minimum as a gate.
21. Results **MUST** be written as machine-readable JSON, one file per run
    plus a matrix-wide summary, and **MUST** be committed to the repository
    under `code/agentic-evals/results/` so profile performance can be
    compared over time.
22. Result files **MUST NOT** be edited by hand; the harness is the only
    writer.

### Agent-graded evaluation

23. An eval **MAY** declare an evaluator that grades or ranks variant
    artifacts (e.g. competing designs) that mechanical assertions cannot
    differentiate.
24. Evaluator runs **MUST** be driven by a rubric declared in the eval's
    YAML, with per-criterion weights, and the judge's scores **MUST** be
    recorded in the results alongside mechanical metrics.
25. When comparing variants, the evaluator **MUST** be blind: it **MUST
    NOT** be told which profile variant produced which artifact.
26. Agent-graded scores **SHOULD** complement, not replace, mechanical
    assertions — an eval **SHOULD NOT** rely on a judge for anything a file
    assertion or test run can check.

## Layout

```
code/agentic-evals/
├── README.md                # this file
├── src/                     # the harness (loader, adapters, grading, runner, CLI)
├── tests/                   # harness unit tests + mock-adapter end-to-end test
├── results/                 # committed harness-written run results (JSON)
└── evals/
    ├── data-analyst-healthcare-report/
    │   ├── eval.yml
    │   └── fixtures/
    ├── founder-demo-video/
    │   ├── eval.yml
    │   └── fixtures/
    ├── engineer-code-review/
    │   ├── eval.yml
    │   └── fixtures/        # example project with the planted smell
    └── engineer-hidden-tests/
        ├── eval.yml
        ├── TASK.md          # gitignored in the fixture project
        ├── hidden-tests/    # withheld from the agent, run by the harness
        └── fixtures/
```

## Running

From `code/agentic-evals/` (part of the npm workspace; `npm install` at the
repo root first):

```bash
node src/cli.ts list
node src/cli.ts run engineer-hidden-tests
node src/cli.ts run engineer-code-review --variant baseline --repeat 1
npm test        # harness unit + end-to-end tests (mock adapter, no agent needed)
```

`run` launches the eval's profile through `outfitter run --profile <id>
--agent pi -- -p "<prompt>"` by default (`launcher: direct` in eval.yml runs
`pi -p` / `claude -p` directly). To validate an eval's fixtures and grading
without spending an agent run, substitute a reference solution for the agent:

```bash
node src/cli.ts run engineer-hidden-tests --agent mock \
  --mock-command "node /path/to/reference-solution.mjs" --repeat 1
```

## Status

Implemented: the declarative `eval.yml` loader, the pi/claude/mock adapters
(requirement 6), isolated per-run workspaces, matrix expansion with variant
profiles materialized as project-local profiles, output/check/question
grading, the coverage metric with its gate, per-run JSON results plus the
matrix summary, and the CLI. All four eval definitions and fixtures ship, and
`engineer-hidden-tests` is validated end-to-end against a reference solution
(see `results/`).

Not yet implemented: agent-graded evaluation (requirements 23–26), the
`tool_calls`/`lines_changed` metrics for the pi adapter, and LLM-judge
grading of questions (today they are case-insensitive substring matches
against the answers file).
