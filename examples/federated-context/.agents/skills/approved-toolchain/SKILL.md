---
name: approved-toolchain
description: Fictional organization tool and permission policy.
---

# Approved toolchain

- Read files and run declared build, test, lint, and local git commands without asking.
- Ask before publishing, deploying, migrating databases, deleting branches, force-pushing, or using new credentials.
- Use repository-pinned tools; never install global tools on shared runners.
- Secrets come from environment or vault and never enter files, logs, commits, or fixtures.
