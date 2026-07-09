# Outfitter requirements

Formal, numbered project obligations live here as `OFTR-NNN-<topic>.md` files.
Their format and governance are themselves specified by
[OFTR-008: Requirements Governance](./OFTR-008-requirements-governance.md);
machine-verifiable requirements are pinned by tests carrying a
`THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-NNN.M)` traceability comment.

## Amending requirements

Pinned tests say "YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT
CHANGES" — so when reality and a requirement disagree, change the requirement
first, with a trace, then the test. The process:

1. **Amend the requirement file first.** Edit the relevant `OFTR-NNN.M`
   section in this directory. Never renumber or reassign existing statement or
   section IDs: replace a withdrawn statement in place with
   `REQUIREMENT REMOVED (YYYY-MM-DD): <rationale>` and append new statements
   at the end of the list. Add a short `Amendment (YYYY-MM-DD): ...` note
   under the section heading recording what changed and why.
2. **Then update the pinned tests.** Adjust every test whose traceability
   comment references the amended requirement so it validates the new text.
   The amendment note in step 1 is the trace that authorizes touching a
   "must not modify" test.
3. **Then change the implementation** (dependencies, behavior, config) to
   match, in the same change set, and run the full suite.

Amendments are reviewed like any other change: the requirement edit, test
edit, and implementation edit should land together so the diff shows the
whole trace. Example: the 2026-07-01 amendment to OFTR-001.5 removed the
never-adopted `typebox`, `defu`, `glob`, and `hosted-git-info` dependencies.
