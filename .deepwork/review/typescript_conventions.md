# TypeScript Conventions

This project is planned as a TypeScript CLI/wrapper.
Until implementation code exists, use these placeholder conventions as reviewable defaults.

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

- Every TypeScript source file must have a concise comment near the top that describes the file's function.
- All declarations and behavior in a file must be consistent with that top-of-file function description.
- The top-of-file function description must stay simple; descriptions with many conjunctions, long comma chains, or multiple unrelated responsibilities are a code smell that the file's encapsulation may be unclear or too complex.
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
