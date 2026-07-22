# AGENTS.md

@CONTRIBUTING.md

## Architecture essentials

- Outfitter is a TypeScript CLI for assembling and launching reproducible agent-CLI profiles.
- Use generic profile controls at the product boundary, then translate them through agent adapters into CLI-specific files, flags, and environment variables.
- Prefer pi terminology, behavior, and native mechanisms whenever generic Outfitter controls conflict with pi conventions.
- Persist user-editable config as YAML and validate every persisted YAML format with JSON Schema at read boundaries.
- Keep settings merging deterministic with precedence from highest to lowest: project-local, project, user, then built-in defaults.
- Keep profile resolution deterministic with precedence from highest to lowest: project-local, project, user, URI/cache by source order, explicit inheritance, implicit user default, then built-in defaults.
- Warn to stderr when an adapter cannot support a requested control; `--strict` must make unsupported controls or composite profile assembly warnings fatal.
- Implement non-trivial CLI behavior as command objects with explicit dependencies and typed inputs/outputs, not parser callback logic.
- A composite profile is the temporary runtime configuration directory assembled for one profile and agent CLI run; Outfitter owns the composite profile lifecycle while the child agent runs.
- Pi is the primary and most complete adapter. A Claude Code adapter ships as well (OFTR-006) and is supported with gaps; unsupported controls must warn rather than fail unless `--strict` is set.
- When adding files or changing directory layout, first check `docs/architecture/file_structure.md` for the current structure and update the relevant documentation afterward.
- When adding tests that validate formal requirements, include the required two-line traceability comment immediately before the relevant `it(...)` or `describe(...)` block.
