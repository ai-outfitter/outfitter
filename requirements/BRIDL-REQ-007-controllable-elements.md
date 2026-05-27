# BRIDL-REQ-007: Controllable Elements Documentation

## Overview

Bridl maintains a generic cross-agent-CLI vocabulary for profile-controlled concepts. This vocabulary is documented separately from implementation details so companies can reason about profiles across multiple agent CLIs.

## Requirements

### BRIDL-REQ-007.1: Documentation File

1. The project MUST include documentation with the header `Controllable Elements`.
2. The controllable elements documentation MUST define each generic controllable aspect as a named term.
3. Each defined term MUST describe the equivalent name or mechanism for pi.
4. Each defined term SHOULD describe the equivalent name or mechanism for other major CLIs when those mappings are known.

### BRIDL-REQ-007.2: Support Matrix

1. The controllable elements documentation MUST include a support matrix table.
2. The support matrix MUST contain one row for each defined controllable aspect.
3. The support matrix MUST contain one column for each documented agent CLI.
4. Each support matrix cell MUST contain exactly one of `Unsupported`, `Supported`, or `Roadmap`.
5. Pi MUST be the only CLI with `Supported` entries until another adapter is implemented and tested.

### BRIDL-REQ-007.3: Initial Controllable Aspects

1. The documentation MUST include an Agent Config Directory controllable element.
2. The documentation MUST include a Session Directory controllable element.
3. The documentation MUST include Extensions, Skills, and Prompt Templates controllable elements.
4. The documentation MUST include System Prompt and Appended System Prompt controllable elements.
5. The documentation MUST include Model Selection and Credentials and Environment controllable elements.
6. The documentation MUST include Tool Availability, Context Files, Theme or UI Presentation, Project Override Policy, Working Directory, Pass-through Arguments, and Bootstrap Hook controllable elements.
