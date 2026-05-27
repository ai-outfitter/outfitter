# Review: requirements_file DeepSchema Compliance — doc/specs/bridl/BRIDL-REQ-001-profile-wrapper.md

## Project Root

**All file paths in this document are relative to `/Users/noah/Documents/GitHub/bridl`.** When reading any file below with Pi file-reading tools, you MUST construct the absolute path by prepending this project root. Do NOT read files relative to your current working directory — it may differ from the project root.

## Review Instructions

doc/specs/bridl/BRIDL-REQ-001-profile-wrapper.md is an instance of requirements_file.
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

### doc/specs/bridl/BRIDL-REQ-001-profile-wrapper.md

File under review

```markdown
# BRIDL-REQ-001: Profile Wrapper Foundation

## Overview

Bridl provides a TypeScript-based wrapper for launching `pi` with repeatable, profile-scoped configuration. This placeholder requirement file captures the initial product direction while implementation details are still being designed.

## Requirements

### BRIDL-REQ-001.1: Profile Selection

1. The system MUST provide a way to select a named profile before launching `pi`.
2. Profile names MUST be stable identifiers suitable for use in commands, logs, and documentation.
3. The system SHOULD provide inspection output that explains which configuration sources a profile will apply.

### BRIDL-REQ-001.2: Pi Launch Environment

1. The system MUST treat `PI_CODING_AGENT_DIR` as the primary isolation boundary for profile-scoped pi configuration.
2. The system MUST support profile-controlled environment variables and pi CLI arguments.
3. The system SHOULD support explicit bootstrap extension injection with `--extension` or `-e` when profile behavior must run inside pi.
4. The system MUST NOT rely on pi extensions to choose the initial pi config directory, because extension loading happens after initial config directory discovery.

### BRIDL-REQ-001.3: Project Overrides

1. Each profile MUST define whether project-local `.pi` configuration is allowed, merged, or isolated away.
2. The selected project override policy MUST be visible in profile inspection output.
3. The system SHOULD provide a safe default that preserves pi's normal project-local behavior unless a profile explicitly requests stricter isolation.

### BRIDL-REQ-001.4: Credential Boundaries

1. The system MUST NOT copy credentials between profiles unless a requirement or explicit profile setting authorizes that behavior.
2. The system MUST support credential injection through environment variables or pi-supported auth mechanisms.
3. Profile documentation MUST state whether credentials are profile-local, environment-provided, or externally managed.

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

- doc/specs/bridl/BRIDL-REQ-001-profile-wrapper.md

## After Review

Report findings with file paths and line references when possible. If this review passes with no actionable findings, call the native Pi tool `deepwork_mark_review_as_passed` with:
- `review_id`: `"requirements_file-DeepSchema-Compliance--doc-specs-bridl-BRIDL-REQ-001-profile-wrapper.md--d25051536413"`
Do not mark this review as passed while actionable findings remain.

---

This review was requested by the policy at `.deepwork/schemas/requirements_file/deepschema.yml:0`.
