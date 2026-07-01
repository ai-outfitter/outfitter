# `profile_bundled_agent_resources`

This fixture models a repository profile stack that bundles launch resources — MCP server fragments — for the Claude Code adapter, with an inherited base layer contributing its own fragments.

## Setup

- `home/.outfitter/settings.yml` defines a personal `default` profile, a `./cache` cache directory, and the personal profile source.
- `project/.outfitter/settings.yml` declares the user profile source first and the repository profile source second.
- `project/.outfitter/profiles/resource-base/profile.yml` is the inherited base layer.
  Its `cli_specific/claude/.mcp.json` contributes the `shared-tracker` and `docs-search` MCP servers.
- `project/.outfitter/profiles/resource-review/profile.yml` is the selected profile.
  Its `cli_specific/claude/.mcp.json` overrides `shared-tracker` and adds `review-db`.

## Expected behavior

Running the selected `resource-review` profile with the claude adapter should merge the inherited and selected `cli_specific/claude/.mcp.json` fragments into a generated composite `.mcp.json`, replacing whole MCP server definitions by name with the higher-precedence layer winning.
The launch plan should load the generated config through Claude Code's `--mcp-config` flag pointing inside the composite profile.

## Mutation/write-back behavior

The generated `.mcp.json` is a merge transform, not durable symlinked state; the launcher performs no writes, and no state write-back warnings are expected.
