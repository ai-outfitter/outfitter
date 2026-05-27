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
