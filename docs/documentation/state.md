# State persistence

Outfitter launches agent CLIs from a temporary composite profile. During a run, Pi, Claude Code, or another adapter may write state such as settings, sessions, plugin installs, caches, auth metadata, or MCP configuration.

Outfitter does not silently copy every file back into your profiles. Instead, each adapter declares the state paths it understands, chooses safe defaults, and lets profiles override how writes to those paths are handled.

## Default behavior

Most users do not need to configure `state_persistence` at all. By default, Outfitter keeps known agent CLI state durable and reports unexpected writes.

```yaml
# This is the behavior most users get without writing any state_persistence block.
# Known Pi and Claude Code state paths default to symlink, so normal setup survives.
# Unknown writes default to warn, so surprising files are reported instead of silently persisted.
state_persistence:
  auth.json: symlink # Pi login/auth state survives future runs.
  settings.json: symlink # Native CLI settings stay durable.
  mcp.json: symlink # MCP/server configuration stays durable.
  plugins/: symlink # Installed plugins can be reused.
  cache/: symlink # Useful package/cache state can be reused.
  sessions/: symlink # Session/project state is durable unless a profile overrides it.
  unknown: warn # Unexpected writes are visible and not silently copied into a profile.
```

Some generated Pi runtime files, such as transformed settings or keybindings, may be treated as one-run generated files even though the underlying state path normally defaults to `symlink`. This keeps Outfitter-managed launch reconciliation from becoming accidental user state.

## How state works

Outfitter separates runtime files into three groups:

1. **Generated profile files** — files Outfitter builds from settings, profiles, templates, and adapter rules. These are temporary and reproducible.
2. **Declared state paths** — files or directories the selected agent CLI is expected to read or write, such as `settings.json`, `mcp.json`, `plugins/`, or `sessions/`.
3. **Unknown writes** — anything the agent writes outside declared state paths. Outfitter never silently persists these because it does not know their owner or merge rules.

Only declared state paths can be persisted automatically.

## Profile option

Use `state_persistence` in a profile to override adapter defaults:

```yaml
id: strict-ci
label: Strict CI

# Omitted paths use the selected adapter's default strategy.
# This profile only overrides paths where CI should be stricter than normal.
state_persistence:
  settings.json: error # Fail if the agent changes settings during the run.
  mcp.json: error # Fail if tool/server config changes during the run.
  plugins/: error # Fail if plugin state changes during the run.
  unknown: error # Fail if the agent writes an undeclared file.

controls:
  thinking: high
```

## Strategies

`state_persistence` values can be:

```yaml
state_persistence:
  auth.json: symlink # Persist writes through a durable profile-managed or native CLI path.
  cache/: discard # Allow writes, then throw them away when the run ends.
  plugins/: warn # Allow writes, discard them, and report them after the run.
  settings.json: error # Allow the run, then fail if this path changed.
  mcp.json: prompt # Reserved for future interactive handling; currently diagnostic where allowed.
```

Use `symlink` for state you want to keep, such as login state, durable settings, MCP config, or plugin installs. Use `discard`, `warn`, or `error` for state that should not become part of the durable profile.

## User stories

### Keep login working

```yaml
# Story: A developer connects Pi to a model provider during first-run setup.
# Goal: The next `outfitter` launch remembers the login instead of asking again.
state_persistence:
  auth.json: symlink # Keep provider login/auth metadata durable.
  models.json: symlink # Keep discovered/configured model metadata durable.
```

### Keep shared catalogs clean

```yaml
# Story: A team publishes a shared engineering profile catalog.
# Goal: MCP config can come from the catalog, but one user's random runtime files
# should not become shared team state.
state_persistence:
  mcp.json: symlink # Keep intentional tool/server config durable.
  unknown: warn # Report unexpected writes instead of silently sharing them.
```

### Make CI reproducible

```yaml
# Story: A platform engineer runs an Outfitter profile in CI.
# Goal: CI should prove the profile is complete, not depend on hidden runtime mutation.
state_persistence:
  settings.json: error # Settings drift means the profile is incomplete.
  mcp.json: error # Tool config drift should fail the job.
  plugins/: error # Plugin installs/updates should be explicit in the profile.
  unknown: error # Any undeclared write is a reproducibility problem.
```

### Avoid cross-project leakage

```yaml
# Story: A consultant switches between client repositories.
# Goal: Sessions, caches, and temp files from one client should not show up in another.
state_persistence:
  sessions/: discard # Throw away conversation/session state after the run.
  cache/: discard # Throw away cache data tied to this run.
  tmp/: discard # Throw away temporary runtime artifacts.
  unknown: warn # Still report surprising writes for investigation.
```

### Experiment without losing visibility

```yaml
# Story: An engineer tries new plugins or package installs locally.
# Goal: Let the experiment run, but report what changed so the user can decide
# whether to make it durable later.
state_persistence:
  plugins/: warn # Allow plugin changes, but do not persist silently.
  unknown: warn # Surface other writes that may need a policy.
```

## Pi state paths

The Pi adapter declares these paths:

```yaml
state_persistence:
  auth.json: symlink # Login/auth state; allowed: symlink, error, prompt.
  settings.json: symlink # Pi settings; generated launch transforms may be one-run.
  keybindings.json: symlink # Pi keybindings; Outfitter may generate launch keybindings.
  mcp.json: symlink # MCP/server configuration.
  models.json: symlink # Model/provider metadata.
  trust.json: symlink # Pi trust decisions.
  plugins/: symlink # Pi plugins.
  cache/: symlink # Pi cache data.
  sessions/: symlink # Pi sessions.
  npm/: symlink # Pi npm package installs.
  git/: symlink # Pi git package checkouts.
  tmp/: symlink # Pi temporary runtime tree; allowed: symlink, discard.
  utilities/: symlink # Shared utility binaries such as rg/fd.
  bin/: symlink # Utility binary links.
  unknown: warn # Undeclared writes; allowed: discard, warn, error, prompt.
```

## Claude Code state paths

The Claude Code adapter declares these paths:

```yaml
state_persistence:
  settings.json: symlink # Claude Code settings.
  agents/: symlink # Claude agent definitions.
  skills/: symlink # Claude skills.
  commands/: symlink # Claude commands/prompts.
  plugins/: symlink # Claude plugins.
  projects/: symlink # Claude project/session state.
  debug/: symlink # Claude debug state.
  unknown: warn # Undeclared writes; allowed: discard, warn, error, prompt.
```

Claude Code project/session state is represented through `projects/`. If a profile sets `controls.session_directory` or `controls.claude.session_directory`, Outfitter uses that location for Claude project state.

## Where durable state lives

When a path uses `symlink`, Outfitter looks for a matching file or directory under the selected profile's CLI-specific resources:

```text
profiles/
  default/
    profile.yml
    cli_specific/
      pi/
        settings.json
        mcp.json
      claude/
        settings.json
        skills/
```

If no profile-managed source exists, Outfitter falls back to the native CLI state location for most paths, such as `~/.pi/agent/...` for Pi or `~/.claude/...` for Claude Code.

This fallback is not another profile layer. It does not participate in inheritance, merge precedence, or profile controls; it only provides a durable destination for state paths.

## When to change defaults

Most users can keep the adapter defaults. Override `state_persistence` when you need a profile with a specific state policy:

```yaml
state_persistence:
  cache/: discard # Throwaway demos, sessions, or caches.
  plugins/: warn # Local experimentation is okay but should be visible.
  settings.json: error # CI, reproducibility checks, or locked-down project profiles.
  auth.json: symlink # Intentional durable setup.
```

For the complete adapter contract and rationale, see [State writeback strategy](../architecture/state_writeback_strategy.md).
