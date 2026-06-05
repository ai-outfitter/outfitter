# APPLEPI-REQ-008: Requirements Governance

## Overview

ApplePi requirements define reviewable project obligations.
Each requirement should be traceable to TypeScript implementation, tests, DeepSchemas, or DeepReview rules depending on the appropriate validation mechanism.

## Requirements

### APPLEPI-REQ-008.1: Requirement File Format

1. Requirement files MUST live under `requirements/` and use filenames matching `APPLEPI-REQ-NNN-<topic>.md`.
2. Requirement files MUST begin with a top-level heading matching `# APPLEPI-REQ-NNN: Title`.
3. Requirement files MUST include an `## Overview` section before requirements.
4. Requirement files MUST include an `## Requirements` section.
5. Requirement section headings MUST use the format `### APPLEPI-REQ-NNN.M: Title`.
6. Requirement statements MUST use RFC 2119 keywords such as MUST, MUST NOT, SHOULD, SHOULD NOT, MAY, REQUIRED, RECOMMENDED, or OPTIONAL.
7. Requirement section ID numbering within each file MUST be sequential without gaps.
8. Each requirement MUST be specific enough to verify by automated test, DeepSchema, DeepReview rule, or direct reviewer judgment.

### APPLEPI-REQ-008.2: Validation Mechanism Selection

1. Machine-verifiable requirements MUST be validated by automated TypeScript tests when the implementation exists.
2. Single-file semantic requirements SHOULD be validated by anonymous DeepSchemas placed next to the governed file.
3. Broad judgment-based requirements SHOULD be validated by `.deepreview` rules.
4. Tests MUST NOT use fragile keyword checks to pretend to validate judgment-based requirements.
5. Review rules SHOULD NOT ask reviewers to verify exact values, paths, or schema shapes that an automated test or JSON Schema can verify deterministically.

### APPLEPI-REQ-008.3: Test Traceability Comments

1. Tests that validate a formal requirement MUST include a traceability comment immediately before the test case or test block.
2. Traceability comments MUST identify at least one requirement ID using the pattern `APPLEPI-REQ-NNN.M`.
3. Traceability comments MUST state that the test validates a hard requirement and MUST NOT be modified unless the requirement changes.
4. Test comments MUST describe durable behavior or policy intent rather than transient line numbers, pull request numbers, or current-diff context.
5. Test comments MUST be updated or removed when the tested behavior changes.

### APPLEPI-REQ-008.4: Traceability Reviews

1. Changes to requirement files MUST trigger review of requirement formatting and traceability.
2. Changes to TypeScript source or tests SHOULD trigger review for missing requirement coverage when they introduce or change product behavior.
3. Changes to DeepSchemas or `.deepreview` policies MUST preserve references to the requirement IDs they enforce when applicable.
4. The requirements DeepSchema MUST include a filename regex that matches the `APPLEPI-REQ-NNN-<topic>.md` naming style.
