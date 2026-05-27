# Document Dependency Analysis

## Document Under Analysis
- **Path**: recommendation.md
- **Summary**: Documents the recommended `bridl` wrapper strategy around pi startup/configuration mechanisms, including `PI_CODING_AGENT_DIR`, CLI/env layering, project `.pi` overrides, extension injection, auth/session handling, and profile modeling.

## Identified Dependencies

### Direct Dependencies
| Source File | Reason |
|-------------|--------|
| README.md | README.md summarizes this recommendation and links to it. Changes between the overview and recommendation can make the project documentation inconsistent. |

### Structural Dependencies
| Source File/Directory | Reason |
|----------------------|--------|
| recommendation.md | Edits to the recommendation itself should be reviewed for internal consistency and accuracy. |
| package.json / tsconfig.json / src/ / bin/ | Once the TypeScript implementation is added, package metadata, compiler configuration, CLI entrypoints, and source files will encode the actual wrapper behavior. Those changes can invalidate the documented startup/configuration strategy. |

### Behavioral Dependencies
| Source File | Reason |
|-------------|--------|
| src/**/*.ts | Future TypeScript source implementing profile resolution, environment construction, CLI argument translation, extension injection, session handling, auth behavior, and project override policy could make recommendation.md inaccurate. |
| bin/**/*.ts | Future TypeScript CLI entrypoints can change the launch flow and command behavior described by recommendation.md. |

## Strategy Decision

**Strategy**: Narrow

**Rationale**: The project is currently a skeleton, so the relevant dependency set can be captured with a few targeted TypeScript-project placeholder globs rather than a repository-wide rule. These patterns overlap substantially with the existing `update_readme` documentation freshness rule.

## Recommended Rule

**Rule name**: update_readme

**Match patterns**:

```yaml
include:
  - "README.md"
  - "recommendation.md"
  - "package.json"
  - "tsconfig.json"
  - "src/**/*.ts"
  - "bin/**/*.ts"
```

**Review strategy**: matches_together

## Existing Rule Assessment

Overlapping rule found: `update_readme`. Its match patterns already include `README.md`, `recommendation.md`, `package.json`, `tsconfig.json`, `src/**/*.ts`, and `bin/**/*.ts`, which substantially overlap with the proposed patterns for recommendation.md. Recommend extending that rule's instructions to monitor both README.md and recommendation.md rather than creating a separate rule.
