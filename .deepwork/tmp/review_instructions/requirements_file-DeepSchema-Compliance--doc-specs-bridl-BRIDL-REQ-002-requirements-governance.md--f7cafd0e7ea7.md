# Review: requirements_file DeepSchema Compliance — doc/specs/bridl/BRIDL-REQ-002-requirements-governance.md

## Project Root

**All file paths in this document are relative to `/Users/noah/Documents/GitHub/bridl`.** When reading any file below with Pi file-reading tools, you MUST construct the absolute path by prepending this project root. Do NOT read files relative to your current working directory — it may differ from the project root.

## Review Instructions

doc/specs/bridl/BRIDL-REQ-002-requirements-governance.md is an instance of requirements_file.
Requirement specification markdown files.

Instructions for dealing with these files:
Requirement files capture formal project obligations. Review them for stable
IDs, RFC 2119 language, testability, and an appropriate validation mechanism.
Prefer TypeScript tests for deterministic behavior, DeepSchemas for file-level
semantic contracts, and DeepReview rules for broad judgment-based policies.


Please review for compliance with the following requirements. You must fail reviews over anything that is MUST. You must fail reviews over any SHOULD that seems like it could be easily followed but is not. You should give feedback but not fail over anything else applicable. You can ignore N/A requirements.

- **rfc-2119-language**: Each numbered requirement statement MUST use at least one RFC 2119 keyword such as MUST, MUST NOT, SHOULD, SHOULD NOT, MAY, REQUIRED, RECOMMENDED, or OPTIONAL.

- **stable-section-ids**: Each requirement section heading MUST follow `### {PREFIX}-REQ-NNN.M: Title`, where `{PREFIX}-REQ-NNN` matches the requirement file name prefix.

- **specific-and-verifiable**: Each requirement MUST be specific enough to verify by TypeScript test, DeepSchema, DeepReview rule, or direct reviewer judgment.

- **validation-mechanism-fit**: Requirements MUST choose an appropriate validation mechanism: deterministic facts belong in TypeScript tests or JSON Schema, single-file judgment belongs in DeepSchemas, and broad judgment-based policy belongs in DeepReview rules.

- **no-fragile-keyword-tests**: Requirements and their validation notes MUST NOT endorse fragile keyword searches as proof of judgment-based behavior.

## Relevant File Contents

### doc/specs/bridl/BRIDL-REQ-002-requirements-governance.md

File under review

```markdown
# BRIDL-REQ-002: Requirements Governance

## Overview

Bridl requirements define reviewable project obligations. Each requirement should be traceable to TypeScript implementation, tests, DeepSchemas, or DeepReview rules depending on what kind of validation is appropriate.

## Requirements

### BRIDL-REQ-002.1: Requirement File Format

1. Requirement files MUST live under `doc/specs/` and use filenames matching `{PREFIX}-REQ-NNN-<topic>.md`.
2. Requirement section headings MUST use the format `### {PREFIX}-REQ-NNN.M: Title`.
3. Requirement statements MUST use RFC 2119 keywords such as MUST, MUST NOT, SHOULD, SHOULD NOT, MAY, REQUIRED, RECOMMENDED, or OPTIONAL.
4. Requirement numbering within each section SHOULD be sequential without gaps.
5. Each requirement MUST be specific enough to verify by automated test, DeepSchema, DeepReview rule, or direct reviewer judgment.

### BRIDL-REQ-002.2: Validation Mechanism Selection

1. Machine-verifiable requirements MUST be validated by automated TypeScript tests when the implementation exists.
2. Single-file semantic requirements SHOULD be validated by anonymous DeepSchemas placed next to the governed file.
3. Broad judgment-based requirements SHOULD be validated by `.deepreview` rules.
4. Tests MUST NOT use fragile keyword checks to pretend to validate judgment-based requirements.
5. Review rules SHOULD NOT ask reviewers to verify exact values, paths, or schema shapes that an automated test or JSON Schema can verify deterministically.

### BRIDL-REQ-002.3: Test Traceability Comments

1. Tests that validate a formal requirement MUST include a traceability comment immediately before the test case or test block.
2. Traceability comments MUST identify at least one requirement ID using the pattern `BRIDL-REQ-NNN.M`.
3. Traceability comments MUST state that the test validates a hard requirement and MUST NOT be modified unless the requirement changes.
4. Test comments MUST describe durable behavior or policy intent rather than transient line numbers, pull request numbers, or current-diff context.
5. Test comments MUST be updated or removed when the tested behavior changes.

### BRIDL-REQ-002.4: Traceability Reviews

1. Changes to requirement files MUST trigger review of requirement formatting and traceability.
2. Changes to TypeScript source or tests SHOULD trigger review for missing requirement coverage when they introduce or change product behavior.
3. Changes to DeepSchemas or `.deepreview` policies MUST preserve references to the requirement IDs they enforce when applicable.

```
### ../../../doc/specs/validating_requirements_with_rules.md

Guidance for choosing tests, DeepSchemas, or DeepReview rules for requirements validation.

```markdown
## Validating Requirements with Tests, DeepSchemas, and Review Rules

Formal requirements use RFC 2119 keywords such as MUST, SHOULD, and MAY. Each requirement needs an appropriate validation mechanism.

### Use automated TypeScript tests for deterministic requirements

Use tests when a requirement can be checked by exact values, paths, return values, emitted CLI arguments, or structured data.

Examples:

- `PI_CODING_AGENT_DIR` MUST be set to the selected profile directory → assert the generated launch environment contains that exact value.
- A profile name MUST be rejected when it contains whitespace → assert validation returns an error.
- The wrapper MUST pass `--extension` for configured bootstrap extensions → assert generated argv contains the expected flag and path.

### Use DeepSchemas for file-level contracts

Use DeepSchemas when a file must satisfy structural or semantic constraints.

- Named DeepSchemas are useful for classes of files, such as all requirement specs.
- Anonymous DeepSchemas are useful when a rule governs one specific file.
- Put exact structural checks in JSON Schema when the target file is structured data.
- Put semantic RFC 2119 requirements in the DeepSchema `requirements` section when judgment is required.

### Use `.deepreview` rules for broad judgment-based policies

Use DeepReview rules when the reviewer must compare changed files, requirements, tests, documentation, or conventions across multiple files.

Examples:

- Requirement files MUST follow the project requirement format.
- Tests that claim requirement coverage MUST use durable traceability comments.
- Documentation MUST stay consistent with TypeScript source behavior.

### Anti-patterns

Do not use fragile keyword tests for judgment requirements. A test such as `expect(text).toContain("safe")` does not prove that a prompt or policy meaningfully enforces safety.

Do not spend reviewer judgment on facts that TypeScript tests or JSON Schema can verify exactly.

### Test traceability comment format

Tests that validate a formal requirement should use a durable comment immediately before the relevant `it(...)`, `test(...)`, or `describe(...)` block:

```ts
// THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-002.3).
// YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
it("rejects stale requirement traceability comments", () => {
  // ...
});
```

Comments should explain durable policy intent. They should not reference source line numbers, pull request numbers, or one-time migration context.

```


## Files to Review

Use Pi's file-reading tools to inspect these paths under the Project Root. Do not rely on Claude-specific @path auto-read behavior.

- doc/specs/bridl/BRIDL-REQ-002-requirements-governance.md

## After Review

Report findings with file paths and line references when possible. If this review passes with no actionable findings, call the native Pi tool `deepwork_mark_review_as_passed` with:
- `review_id`: `"requirements_file-DeepSchema-Compliance--doc-specs-bridl-BRIDL-REQ-002-requirements-governance.md--f7cafd0e7ea7"`
Do not mark this review as passed while actionable findings remain.

---

This review was requested by the policy at `.deepwork/schemas/requirements_file/deepschema.yml:0`.
