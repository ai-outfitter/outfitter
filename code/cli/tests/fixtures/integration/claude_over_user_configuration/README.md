# `claude_over_user_configuration`

This fixture models the ordinary case: someone who already uses Claude Code on this machine runs an
Outfitter profile in a workspace their native Claude session trusts.

## Setup

- `home/.agents/settings.yml` selects the `reviewer` profile and the Claude harness. It sets no
  `isolation`, so the run inherits — that is the default.
- `home/.claude/settings.json` is the user's own Claude configuration: a permission allowlist, a
  deny rule, `defaultMode: auto`, and an enabled plugin. None of it is Outfitter's to decide.
- `home/.claude.json` carries the account, the user's own `user-notes` MCP server, and the trust
  decisions. Note that the project directory itself records `hasTrustDialogAccepted: false` while
  its parent records `true`: native Claude resolves trust through the ancestor chain, which is why
  an inherited run must not hand-pick the exact-path entry.
- `project/.agents/` holds the composition: a system prompt, a `repo-audit` skill, and a `reviewer`
  agent selecting that skill, the `github` MCP server, and a model.

## Expected behavior

An inherited run sets no `CLAUDE_CONFIG_DIR`. The composition reaches the session as a plugin —
`.claude-plugin/plugin.json` named for the profile slug, passed through `--plugin-dir` — so the
user's trust, permissions, plugins, and `user-notes` MCP server all still apply, and the profile's
`github` server merges with them rather than replacing them. `expected/claude/warnings.json` is
empty: nothing about this run is degraded.

`--isolated` (or `isolation: isolated` in the home-scope settings) produces
`expected/claude/composite-profile-summary-isolated.json` instead: `CLAUDE_CONFIG_DIR` points at the
composite profile, `--strict-mcp-config` suppresses `user-notes`, and the durable-state bridge seeds
credentials, the narrow `.claude.json` subset, and this project's session history into the
projection.

## Mutation/write-back behavior

An inherited run has no write-back step at all. Claude reads and writes `~/.claude` directly, so
permission approvals, trust decisions, and session transcripts persist the way they do in a native
session — and nothing Outfitter does can race the user's other concurrent Claude sessions.

An isolated run keeps the existing narrow bridge: `.credentials.json` copied back when the run
changed it and the durable copy did not, `oauthAccount` merged into `~/.claude.json`, and this
project's session files merged under `~/.claude/projects/`. Everything else the run wrote into the
projection is discarded with the temporary directory.
