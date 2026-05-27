# Review: requirement_file_format — doc/specs/bridl/BRIDL-REQ-001-profile-wrapper.md

## Project Root

**All file paths in this document are relative to `/Users/noah/Documents/GitHub/bridl`.** When reading any file below with Pi file-reading tools, you MUST construct the absolute path by prepending this project root. Do NOT read files relative to your current working directory — it may differ from the project root.

## Review Instructions

Review this requirements specification file for format correctness.

Check the following:

1. **RFC 2119 keywords**: Every numbered requirement statement MUST use
   at least one RFC 2119 keyword (MUST, MUST NOT, SHALL, SHALL NOT,
   SHOULD, SHOULD NOT, MAY, REQUIRED, RECOMMENDED, OPTIONAL).

2. **Stable requirement IDs**: Each section heading MUST follow the
   pattern `### {PREFIX}-REQ-NNN.M: Title` where `{PREFIX}-REQ-NNN`
   matches the filename prefix, such as `BRIDL-REQ-001`.

3. **Sequential numbering**: Within each section, numbered requirements
   SHOULD be sequential without gaps or out-of-order numbers.

4. **Section ID consistency**: The section ID prefix MUST match the
   requirement file name prefix.

5. **Testability**: Each requirement MUST be specific enough to verify by
   TypeScript test, DeepSchema, DeepReview rule, or direct reviewer judgment.

Output Format:
- PASS: All requirements are properly formatted.
- FAIL: Issues found. List each with the section ID, requirement number,
  and a concise description of the issue.

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


## Files to Review

Use Pi's file-reading tools to inspect these paths under the Project Root. Do not rely on Claude-specific @path auto-read behavior.

- doc/specs/bridl/BRIDL-REQ-001-profile-wrapper.md

## After Review

Report findings with file paths and line references when possible. If this review passes with no actionable findings, call the native Pi tool `deepwork_mark_review_as_passed` with:
- `review_id`: `"requirement_file_format--doc-specs-bridl-BRIDL-REQ-001-profile-wrapper.md--d25051536413"`
Do not mark this review as passed while actionable findings remain.

---

This review was requested by the policy at `.deepreview:36`.
