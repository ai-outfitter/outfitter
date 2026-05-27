# AGENTS.md

## Project checks

- Run `npm run check` for local verification. It runs ESLint with auto-fixing enabled, then runs the coverage test suite.
- Run `npm run check-ci` for CI-equivalent verification. It runs the same lint and coverage checks without modifying files.
- `npm run coverage` enforces the configured Vitest coverage thresholds.

## Notes

- Prefer `npm run check` before handing work back if auto-fixable lint issues may exist.
- Use `npm run check-ci` when you need a non-mutating validation pass, such as in CI or before reviewing the final diff.
