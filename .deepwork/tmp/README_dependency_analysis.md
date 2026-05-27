# Document Dependency Analysis

## Document Under Analysis
- **Path**: README.md
- **Summary**: Describes the project intent for `bridl`, a planned TypeScript-based wrapper around `pi` profiles, including launch examples, a draft profile model, design direction, current status, and future work.

## Identified Dependencies

### Direct Dependencies
| Source File | Reason |
|-------------|--------|
| recommendation.md | README.md explicitly links to this file as the current notes on pi startup behavior and wrapper strategy. Changes to the recommendation can make the README's design-direction summary stale. |

### Structural Dependencies
| Source File/Directory | Reason |
|----------------------|--------|
| README.md | Edits to the README itself should be reviewed for internal consistency and accuracy. |
| package.json / tsconfig.json / src/ / bin/ | The README currently states that no CLI implementation or stable profile schema exists. Adding TypeScript package manifests, source directories, CLI entrypoints, or schema files can invalidate that status and future-work list. |

### Behavioral Dependencies
| Source File | Reason |
|-------------|--------|
| (none yet) | This repository is currently a skeleton with no TypeScript source files. Future implementation files should be added to the rule when they exist or covered by a broader source pattern then. |

## Strategy Decision

**Strategy**: Narrow

**Rationale**: The repository currently contains only two project documentation files and no implementation source. README.md's concrete dependency set is still small and can be captured with a few targeted TypeScript-project placeholder globs for likely future implementation entrypoints without matching every repository file.

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

No overlapping documentation update rules found. Existing rules are general DeepWork native review rules (`prompt_best_practices` and `suggest_new_reviews`) and do not enforce documentation freshness for README.md.
