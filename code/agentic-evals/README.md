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

| Eval | Profile | Workflow | Expected artifact |
| --- | --- | --- | --- |
| `data-analyst-healthcare-report` | `data_analyst` | Run through the data-analyst demo against a healthcare dataset | An HTML report summarizing the healthcare data |
| `founder-demo-video` | `founder` | Feed the founder profile a recorded product demo (video/transcript) | A usable output derived from the recording (e.g. summary, launch notes, follow-ups) |
| `engineer-code-review` | `engineer` | Run the code-review agent against an example project seeded with a known-ugly bit of code | A review finding that identifies the planted code smell |
| `engineer-hidden-tests` | `engineer` | Implement the task described in a gitignored `TASK.md`, HackerRank-style: unit tests exist but are hidden from the agent | The hidden test suite passes after the agent's implementation |

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
profile: data_analyst          # profile under test
agent: pi                      # pi today; claude planned
workflow:
  prompt: |
    Run through the demo using the healthcare dataset and produce a report.
inputs:
  - path: fixtures/healthcare.csv
outputs:
  - path: report.html          # artifact that MUST exist after the run
    assertions:
      - kind: exists
      - kind: contains
        value: "<html"
questions:                     # graded Q&A against the run's output
  - ask: "Which condition had the highest readmission rate?"
    expect: "heart failure"
```

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

## Layout

```
code/agentic-evals/
├── README.md                # this file
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

## Status

Only this README exists so far. The eval definitions, fixtures, and harness
are not yet implemented — this document is the design to review before work
starts.
