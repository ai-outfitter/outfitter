# Tool policy: approved toolchain (fictional example)

Organization-wide rules for what agents may run and touch.

- Allowed without asking: read files, run the repository's declared build/test/lint commands, and use git for local branches and commits.
- Ask a human first: package publishes, deploys, database migrations, deleting branches, force pushes, and any command that needs new credentials.
- Never install global tools on shared runners; use the repository's pinned toolchain (Maven wrapper, npm scripts, uv).
- Secrets come from the environment or the org vault. Never write a secret into a file, log line, or commit — including test fixtures.
- Generated artifacts (lockfiles excepted) do not get committed unless the repository's docs say otherwise.
