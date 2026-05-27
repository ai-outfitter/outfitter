# Review: prompt_best_practices — .deepwork/review/typescript_conventions.md

## Project Root

**All file paths in this document are relative to `/Users/noah/Documents/GitHub/bridl`.** When reading any file below with Pi file-reading tools, you MUST construct the absolute path by prepending this project root. Do NOT read files relative to your current working directory — it may differ from the project root.

## Review Instructions

## Job Context

This job manages .deepreview configuration files, which define automated code review
rules for DeepWork Reviews. Reviews are triggered when files matching specified glob
patterns change in a PR or commit.

For the .deepreview file format, key concepts, and rule naming conventions, read
`deepreview_reference.md` (relative to this job's directory).


This review is being run as a DeepWork workflow quality gate for job 'deepwork_reviews', workflow 'discover_rules', step 'add_language_reviews'.

## Work Summary

Added a TypeScript convention file for the planned TypeScript project and a typescript_code_review .deepreview rule. The rule uses strategy individual, targets **/*.ts and **/*.tsx, excludes generated/vendor/build outputs, references the convention file, and explicitly checks DRY violations and comment accuracy/test comments.

Review this markdown file as a prompt or instruction file, evaluating it
against Anthropic's prompt engineering best practices.

For each issue found, report:
1. Location (section or line)
2. Severity (Critical / High / Medium / Low)
3. Best practice violated
4. Description of the issue
5. Suggested improvement

Check for:
- Clarity and specificity (concrete criteria vs vague language)
- Structure and formatting (XML tags, headers, numbered lists for distinct sections)
- Role and context (enough context for the AI, explicit assumptions)
- Examples for complex/nuanced tasks
- Output format specification
- Prompt anti-patterns (contradictions, instruction overload, buried critical instructions)
- Variable/placeholder clarity

Use judgment proportional to the file's complexity. A short, focused
instruction for a simple task does not need few-shot examples or XML tags.
Do not flag issues for best practices that are irrelevant to the file's purpose.

## Relevant File Contents

### .deepwork/review/typescript_conventions.md

File under review

```markdown
# TypeScript Conventions

This project is planned as a TypeScript CLI/wrapper. Until implementation code exists, use these placeholder conventions as reviewable defaults.

## General style

- Prefer explicit, narrow types at module boundaries and exported APIs.
- Keep profile/configuration data structures serializable and validation-friendly.
- Prefer small pure functions for profile resolution, environment construction, and command argument generation.
- Avoid hidden global state except for intentional process environment handling at launch boundaries.

## Error handling

- Return structured errors or throw errors with actionable messages at CLI boundaries.
- Do not swallow errors from filesystem, config parsing, or child process launch operations.
- Include enough context in error messages to identify the profile, file, or setting involved.

## Comments and documentation

- Comments should explain non-obvious policy decisions, security boundaries, or pi startup-order constraints.
- Do not restate what the TypeScript syntax already says.
- Keep comments accurate when behavior changes; stale comments should be updated or removed in the same change.

## Tests

- Test names should describe the policy or behavior being enforced.
- Tests for policy decisions should include comments only when the reason for the policy is not obvious from the assertion.
- Test comments must stay tied to the behavior under test and must not describe obsolete requirements.
- Prefer table-driven tests for profile resolution and CLI/env translation cases.

## Review focus

Reviewers should check for duplicated profile/policy logic, stale comments, unsafe credential handling, and behavior that diverges from the requirements or documentation.

```


## Files to Review

Use Pi's file-reading tools to inspect these paths under the Project Root. Do not rely on Claude-specific @path auto-read behavior.

- .deepwork/review/typescript_conventions.md

## After Review

Report findings with file paths and line references when possible. If this review passes with no actionable findings, call the native Pi tool `deepwork_mark_review_as_passed` with:
- `review_id`: `"prompt_best_practices--.deepwork-review-typescript_conventions.md--ef4c31a981b4"`
Do not mark this review as passed while actionable findings remain.

---

This review was requested by the policy at `.deepreview:1`.
