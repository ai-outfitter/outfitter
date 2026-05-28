# AGENTS.md

## Architecture essentials

- Bridl is a TypeScript CLI for assembling and launching reproducible agent-CLI profiles; `pi` is the first and primary supported target.
- Treat any `bridle` spelling in docs, prompts, examples, or generated text as the typo `bridl`.
- Use generic profile controls at the product boundary, then translate them through agent adapters into CLI-specific files, flags, and environment variables.
- Prefer pi terminology, behavior, and native mechanisms whenever generic Bridl controls conflict with pi conventions.
- Persist user-editable config as YAML and validate every persisted YAML format with JSON Schema at read boundaries.
- Keep settings merging deterministic with precedence from highest to lowest: project-local, project, user, then built-in defaults.
- Keep profile resolution deterministic with precedence from highest to lowest: project-local, project, user, URI/cache by source order, explicit inheritance, implicit user default, then built-in defaults.
- Warn to stderr when an adapter cannot support a requested control; `--hard-tack` must make unsupported controls or tack assembly warnings fatal.
- Implement non-trivial CLI behavior as command objects with explicit dependencies and typed inputs/outputs, not parser callback logic.
- A tack is the temporary runtime configuration directory assembled for one profile and agent CLI run; Bridl owns the tack lifecycle while the child agent runs.
- Pi is the only day-one adapter. Claude is roadmap-only unless requirements change.

## Project checks

- Run `npm run check` for local verification. It runs ESLint with auto-fixing enabled, then runs the coverage test suite.
- Run `npm run check-ci` for CI-equivalent verification. It runs the same lint and coverage checks without modifying files.
- `npm run coverage` enforces the configured Vitest coverage thresholds.
- Coverage includes all `src/**/*.ts` files, so new source files need tests even if they are only scaffolding.

## Notes

- Prefer `npm run check` before handing work back if auto-fixable lint issues may exist.
- Use `npm run check-ci` when you need a non-mutating validation pass, such as in CI or before reviewing the final diff.
- When adding files or changing directory layout, first check `doc/file_structure.md` for current structure and update the relevant documentation afterward.
- When adding tests that validate formal requirements, include the required two-line traceability comment immediately before the relevant `it(...)` or `describe(...)` block.
