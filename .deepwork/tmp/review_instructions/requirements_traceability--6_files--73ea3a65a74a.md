# Review: requirements_traceability — 6 files

## Project Root

**All file paths in this document are relative to `/Users/noah/Documents/GitHub/bridl`.** When reading any file below with Pi file-reading tools, you MUST construct the absolute path by prepending this project root. Do NOT read files relative to your current working directory — it may differ from the project root.

## Review Instructions

Review the changed files for requirements traceability.

Requirements live in `doc/specs/` as `{PREFIX}-REQ-NNN-<topic>.md`,
with individually numbered items such as `BRIDL-REQ-002.3`. Each
requirement should be validated by TypeScript tests, DeepSchemas, or
`.deepreview` rules using the mechanism that fits the requirement.

Mechanism selection:
- **TypeScript tests**: deterministic behavior, exact values, paths,
  generated CLI args, validation outcomes, or structured data.
- **DeepSchemas**: file-level structural or semantic contracts.
- **DeepReview rules**: broad judgment-based policies spanning many files.

Flag these anti-patterns:
- Fragile keyword tests for judgment requirements, such as proving a
  policy by only checking `text.includes("safe")`.
- Review rules for exact facts that TypeScript tests or JSON Schema can
  verify deterministically.
- Requirement changes without corresponding test, DeepSchema, or review
  policy updates when validation is feasible.

Produce a structured review with Coverage Gaps, Mechanism Mismatches,
Traceability Comment Issues, and a PASS/FAIL summary.

See doc/specs/validating_requirements_with_rules.md for project guidance.

## Files to Review

Use Pi's file-reading tools to inspect these paths under the Project Root. Do not rely on Claude-specific @path auto-read behavior.

- .deepreview
- .deepwork/review/typescript_conventions.md
- .deepwork/schemas/requirements_file/deepschema.yml
- .deepwork/schemas/test_traceability_comments/deepschema.yml
- doc/specs/bridl/BRIDL-REQ-001-profile-wrapper.md
- doc/specs/bridl/BRIDL-REQ-002-requirements-governance.md

## After Review

Report findings with file paths and line references when possible. If this review passes with no actionable findings, call the native Pi tool `deepwork_mark_review_as_passed` with:
- `review_id`: `"requirements_traceability--6_files--73ea3a65a74a"`
Do not mark this review as passed while actionable findings remain.

---

This review was requested by the policy at `.deepreview:70`.
