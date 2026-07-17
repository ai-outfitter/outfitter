# State persistence

Outfitter launches agent CLIs from a temporary baked composition. During a run, Pi, Claude Code, or another adapter may write state such as settings, sessions, plugin installs, caches, auth metadata, or MCP configuration.

Outfitter does not silently copy every file back into your `.agents` tree. Instead, each adapter declares the state paths it understands, chooses safe defaults, and lets settings override how writes to those paths are handled.

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
  sessions/: symlink # Session/project state is durable unless overridden.
  unknown: warn # Unexpected writes are visible and not silently persisted.
```

Some generated runtime files, such as transformed settings or keybindings, may be treated as one-run generated files even though the underlying state path normally defaults to `symlink`. This keeps Outfitter-managed launch reconciliation from becoming accidental user state.

## How state works

Outfitter separates runtime files into three groups:

1. **Generated composition files** — files Outfitter bakes from the resolved `.agents` layers and adapter rules. These are temporary and reproducible.
2. **Declared state paths** — files or directories the selected agent CLI is expected to read or write, such as `settings.json`, `mcp.json`, `plugins/`, or `sessions/`.
3. **Unknown writes** — anything the agent writes outside declared state paths. Outfitter never silently persists these because it does not know their owner or merge rules.

Only declared state paths can be persisted automatically. Baked artifacts and [dumps](./dump-and-bake.md) never contain persisted state — state is runtime, not configuration.

## Configuring persistence

Set `state_persistence` in [settings](./settings.md) — globally, per project, or in `settings.local.yml` for one machine:

```yaml
# .agents/settings.yml — a stricter policy for a CI project
state_persistence:
  settings.json: error # Fail if the agent changes settings during the run.
  mcp.json: error # Fail if tool/server config changes during the run.
  plugins/: error # Fail if plugin state changes during the run.
  unknown: error # Fail if the agent writes an undeclared file.
```

## Strategies

`state_persistence` values can be:

```yaml
state_persistence:
  auth.json: symlink # Persist writes through a durable native CLI path.
  cache/: discard # Allow writes, then throw them away when the run ends.
  plugins/: warn # Allow writes, discard them, and report them after the run.
  settings.json: error # Allow the run, then fail if this path changed.
  mcp.json: prompt # Ask after the run: persist, discard, or always persist.
```

Use `symlink` for state you want to keep, such as login state, durable settings, MCP config, or plugin installs. Use `discard`, `warn`, or `error` for state that should not become durable. Use `prompt` when you want to decide interactively after each run.

## Prompt strategy

When a `prompt` path changed during a run and both stdin and stdout are interactive terminals, Outfitter asks what to do with the change after the agent exits:

- **persist** — copy the change to the path's durable destination for this run only.
- **discard** — throw the change away with the rest of the baked composition.
- **always** — persist the change and record a `state_persistence: <path>: symlink` override in the editable settings scope, so future runs persist writes to that path automatically. Outfitter never mutates a synced catalog cache: if the active configuration comes from a remote source, the change is persisted once and a warning explains that the choice could not be recorded.

In non-interactive sessions (CI, scripts, piped stdio), `prompt` falls back to `warn` and Outfitter prints an explicit `prompt skipped: non-interactive` notice.

Undeclared writes governed by `unknown: prompt` cannot be persisted because they have no durable destination; Outfitter reports them as warnings and says so.

## Temporary directory cleanup

Baked composition directories are created under the system temporary directory and removed automatically when the Outfitter process exits or receives a handled signal. Removal deletes symlink entries without following them, so the durable auth/settings state the links point at is never touched. Pass `--debug` to keep the directory for inspection; Outfitter prints its path.

Each startup also best-effort sweeps `outfitter-*` directories older than seven days from the temporary root. The sweep never follows symlinks, so a stale directory's links are removed while their targets survive.

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
# Story: A team publishes a shared .agents catalog.
# Goal: MCP config can come from the catalog, but one user's random runtime files
# should not become shared team state.
state_persistence:
  mcp.json: symlink # Keep intentional tool/server config durable.
  unknown: warn # Report unexpected writes instead of silently sharing them.
```

### Make CI reproducible

```yaml
# Story: A platform engineer runs a baked Outfitter task in CI.
# Goal: CI should prove the composition is complete, not depend on hidden runtime mutation.
state_persistence:
  settings.json: error # Settings drift means the composition is incomplete.
  mcp.json: error # Tool config drift should fail the job.
  plugins/: error # Plugin installs/updates should be explicit in the tree.
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

## Where durable state lives

When a path uses `symlink`, the durable destination is the native CLI state location — `~/.pi/agent/...` for Pi, `~/.claude/...` for Claude Code. The native location is not another configuration layer: it does not participate in resolution or merge precedence; it only provides a durable destination for state paths.

For a [ported Claude Code setup](./porting-claude.md), `~/.claude` configuration entries are themselves symlinks into `~/.agents/`, so persisted configuration state lands in the protocol tree while session and auth state stays native.

For the complete adapter contract and rationale, see [State writeback strategy](../architecture/state_writeback_strategy.md).
