## Validating Requirements with Tests, DeepSchemas, and Review Rules

Formal requirements use RFC 2119 keywords such as MUST, SHOULD, and MAY.
Each requirement needs an appropriate validation mechanism.

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

Do not use fragile keyword tests for judgment requirements.
A test such as `expect(text).toContain("safe")` does not prove that a prompt or policy meaningfully enforces safety.

Do not spend reviewer judgment on facts that TypeScript tests or JSON Schema can verify exactly.

### Test traceability comment format

Tests that validate a formal requirement should use a durable comment immediately before the relevant `it(...)`, `test(...)`, or `describe(...)` block:

```ts
// THIS TEST VALIDATES A HARD REQUIREMENT (APPLEPI-REQ-008.3).
// YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
it('rejects stale requirement traceability comments', () => {
  // ...
});
```

Comments should explain durable policy intent.
They should not reference source line numbers, pull request numbers, or one-time migration context.
