# `profile_bundled_agent_resources`

This fixture models a repository profile stack that bundles launch resources — MCP server fragments and Agent Skills — for the Claude Code adapter, with an inherited base layer contributing its own resources.

## Setup

- `home/.outfitter/settings.yml` defines a personal `default` profile, a `./cache` cache directory, and the personal profile source.
- `home/.claude/skills/personal-notes/` is a personal native Claude skill.
- `project/.outfitter/settings.yml` declares the user profile source first and the repository profile source second.
- `project/.outfitter/profiles/resource-base/profile.yml` is the inherited base layer.
  Its `cli_specific/claude/.mcp.json` contributes the `shared-tracker` and `docs-search` MCP servers, and its `skills/` folder bundles `release-notes` plus a `changelog-writer` skill that the selected profile shadows.
- `project/.outfitter/profiles/resource-review/profile.yml` is the selected profile.
  Its `cli_specific/claude/.mcp.json` overrides `shared-tracker` and adds `review-db`, and its `skills/changelog-writer/` shadows the inherited skill of the same name.

## Expected behavior

Running the selected `resource-review` profile with the claude adapter should merge the inherited and selected `cli_specific/claude/.mcp.json` fragments into a generated composite `.mcp.json`, replacing whole MCP server definitions by name with the higher-precedence layer winning.
The launch plan should load the generated config through Claude Code's `--mcp-config` flag pointing inside the composite profile.

Profile-bundled skills should be materialized as one symlink per skill inside the composite `skills/` directory: the selected profile's `changelog-writer` wins the name conflict, the inherited `release-notes` remains available, and the personal `personal-notes` skill is mirrored so native skills stay reachable.

## Mutation/write-back behavior

The generated `.mcp.json` is a merge transform, not durable symlinked state; the MCP-focused launcher performs no writes, and no state write-back warnings are expected.
The skills-focused launcher creates a new top-level skill inside the composite `skills/` directory, which should be diagnosed as a non-persisted `warn` state write without mutating any skill source.
