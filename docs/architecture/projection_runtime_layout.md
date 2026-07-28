# Projection Runtime Layout

This document specifies where a projection lives on disk, how long it survives, and which
directories Outfitter owns. It is the companion to
[State Writeback Strategy](./state_writeback_strategy.md), which specifies what happens to writes
_inside_ a projection: that document answers which writes persist, this one answers where the
projection itself lives and who cleans it up.

Everything here is target architecture. The gap against current behavior is recorded in
[Implementation gap](#implementation-gap).

## Two cache roots

Outfitter has two unrelated cache locations, and conflating them is the easiest mistake to make in
this area:

- **`<cache_directory>`** — the `.agents` source cache, holding synced remote catalogs under
  `repos/`. Default `~/.agents/cache`, overridable in settings, specified by OFTR-004.
- **Outfitter cache root** — `$XDG_CACHE_HOME/outfitter`, else `~/.cache/outfitter`. Machine-local
  build artifacts that are cheap to recreate and belong in no protocol tree.

This document uses the Outfitter cache root. `<cache_directory>` appears here only where the
writeback strategy already places something in it.

## Lifetime classes

Every file an adapter causes to exist belongs to exactly one class. The class is a property of the
data, not of the adapter that wrote it, and it determines the location.

| Class          | Definition                                                 | Location                                |
| -------------- | ---------------------------------------------------------- | --------------------------------------- |
| Projection     | Generated from the composition; reproducible by re-running | Runtime root                            |
| Native state   | Durable agent state the CLI owns                           | Native CLI location, reached by symlink |
| Build artifact | Expensive to rebuild, reusable across runs and agents      | Outfitter cache root                    |
| Source cache   | Synced remote catalogs                                     | `<cache_directory>` (OFTR-004)          |

The rule for classifying a new file: if losing it costs only time, it is a build artifact; if losing
it costs user work, it is native state; if it derives from the `.agents` tree, it is projection.

## Runtime root

The projection root resolves in order:

1. `$XDG_RUNTIME_DIR/outfitter` when set and writable
2. `<outfitter-cache-root>/run` otherwise
3. Launch fails with an explicit diagnostic when neither is writable, rather than falling back to a
   world-readable location

`$XDG_RUNTIME_DIR` is preferred because it is tmpfs on Linux: credentials reached through a
projection never touch persistent storage, the directory is already `0700`, and it is cleared on
logout. It is unset on macOS and Windows, where the fallback applies.

Each run gets `outfitter-<agent>-<harness>-<pid>-<nonce>/` with mode `0700`. The agent and harness
are retained from the current naming so `ps` and `lsof` output stays readable; the pid is added so
the sweeper can test liveness without a registry.

The root reaches the child through the harness's own configuration variable — `PI_CODING_AGENT_DIR`
for Pi, `CLAUDE_CONFIG_DIR` for Claude Code — which is why a projection can stand in for the native
directory at all.

### Path length

Every path segment stays within 255 bytes. This is a per-segment filesystem limit rather than a
total-path limit, and macOS and most Linux filesystems reject a longer segment with `ENAMETOOLONG`.

No segment embeds unbounded user input. Where a path must encode a remote URI, it uses a
fixed-length digest rather than an encoding that grows with the input.

## Cleanup

Cleanup needs two mechanisms because one of them cannot be made reliable.

**Normal exit** removes the projection root when the child exits, including on error.

**Crash exit** cannot. A `finally` block does not run on `SIGKILL`, on an OOM kill, or when the
terminal disappears. `SIGINT` reaches the entire foreground process group, so interrupting the agent
interrupts Outfitter at the same moment — the common case, not an edge case. Signal handlers narrow
this window without closing it.

Outfitter therefore sweeps sibling `outfitter-*` roots on startup, under a single precedence rule:

1. Liveness determinable and the pid is live — keep, whatever the age.
2. Liveness determinable and the pid is dead — sweep.
3. Liveness not determinable — sweep when the mtime exceeds a bounded age (24 hours by default).

The age bound is not a backstop against pid reuse; under reuse the encoded pid is live and rule (1)
correctly declines to delete a directory it can no longer prove is stale. The residual cost of pid
reuse is a leaked root, not a deleted live one, which is the right direction to fail. Reuse can be
narrowed further by recording process start time alongside the pid where the platform exposes it.

Two further details:

- **Startup race.** A root would otherwise exist before its process is observable under the encoded
  pid. The root is named with the creating process's own pid, closing the window at `mkdir` time.
- **Windows liveness.** POSIX `kill(pid, 0)` has no direct Node equivalent on Windows, so rule (3)
  is the normal path there. It delays reclamation rather than risking a live root.

## Build artifacts

The Outfitter cache root holds data that is expensive to rebuild and safe to lose:

```text
<outfitter-cache-root>/
├── run/                   # projection roots, when XDG_RUNTIME_DIR is unavailable
└── extensions/<harness>/  # harness extension installs
```

Placing `run/` under a cache root is a deliberate exception to "cache is safe to delete at any
time", and it is why the sweeper keys on pid liveness rather than age alone. Anything walking this
tree must treat `run/` as live data.

Extension installs stay out of the native agent directory. A harness records installed packages in
its own manifest, so installing there would merge Outfitter's composition-derived list with the
user's manual installs into one list neither side owns, and dropping an extension from a loadout
would never uninstall it. The cost is a duplicate install when a user installs the same extension
both ways.

The extension cache needs a defined reclamation path: it grows monotonically as loadouts change, and
nothing removes an install no agent references.

## Security invariants

These are the properties that must hold regardless of cleanup succeeding. They are the strongest
candidates for promotion into a numbered OFTR section, since none is currently pinned by a test.

1. Credentials are never copied into a projection; they are reached by symlink only. No second copy
   exists to strand.
2. A projection root is created with mode `0700`.
3. A stranded projection contains no credentials. This follows from (1) — cleanup is best-effort, so
   the safety property cannot depend on it.
4. Diagnostics redact embedded credentials in paths and URIs.

## Concurrency

Concurrent runs of different agents do not interfere: projection roots are per-run, so generated
files are isolated.

Symlinked native state is shared by construction — two concurrent runs write the same
`~/.pi/agent/auth.json` and the same `sessions/`. That is intended, since the state belongs to the
user rather than to a run.

**Open question.** Whether a given harness tolerates concurrent writes to its session store and auth
file is a property of that harness and is unverified. It should be determined per adapter before its
state paths default to `symlink`. If a harness does not tolerate it, the adapter declares the
affected path non-durable; the runtime layout does not add locking, because a lock on shared state
would serialize runs against each other and defeat the isolation projections exist to provide.

## Platform matrix

| Platform | Runtime root                 | Notes                                                                                     |
| -------- | ---------------------------- | ----------------------------------------------------------------------------------------- |
| Linux    | `$XDG_RUNTIME_DIR/outfitter` | tmpfs, `0700`, cleared on logout                                                          |
| macOS    | `<outfitter-cache-root>/run` | No `XDG_RUNTIME_DIR`; 255-byte segment limit                                              |
| Windows  | `<outfitter-cache-root>/run` | No `XDG_RUNTIME_DIR`; symlinks need developer mode or elevation; pid liveness unavailable |

The Windows symlink constraint belongs to the writeback strategy rather than the layout, and that
document does not currently specify what happens when a symlink cannot be created. It needs to: the
only safe answer is that the adapter reports the path as non-durable, because silently copying
instead would reintroduce the stranded-credential case invariant (1) removes.

## Implementation gap

Current behavior diverges in five ways, each user-visible.

The state model itself is the largest of them: `state_persistence` is parsed and merged in settings
but never consumed, and no adapter implements the declared `state_paths`. The divergences below are
therefore unimplemented design rather than defects in shipped behavior.

**Credentials are copied, not symlinked.** `auth.json` and `models.json` are copied into the
projection before launch and back out after exit. The writeback strategy declares `auth.json` as
`default_strategy: symlink`, and this copy creates the stranded-credential case invariant (1)
exists to prevent.

**`models-store.json` is undeclared and silently lost.** Pi writes it into the agent directory, but
it appears in no adapter `state_paths` declaration and is not in the copied set, so it is discarded
on every run. It is either native state that should be declared, or a cache file that should be
named as such.

**Sessions are discarded.** `sessions/` is declared `default_strategy: symlink` with a native
fallback, but no adapter acts on that declaration and the projection root is deleted wholesale on
exit, so transcripts written during a run are destroyed. They survive only when Outfitter crashes, which strands them instead. Sessions
started through Outfitter and sessions started by running the harness directly do not share a
history.

**The extension cache is harness-specific.** Installs live at `<outfitter-cache-root>/pi-extensions`
rather than `extensions/<harness>/`, so a second harness would need a second convention.

**Projections are created in the system temporary directory** and leak on interrupt. Measured on one
developer machine over the seven days ending 2026-07-25: 32 stranded roots, 7 containing
`auth.json`. On a typical Linux system that directory is persistent storage with a multi-day reaping
policy, so stranded credentials survive reboots and enter filesystem snapshots.

## Non-goals

- Changing any harness's own directory layout. Outfitter adapts to native locations.
- Generic copy-back or structured merge-back, per the writeback strategy. The one-time copy offered
  by its `prompt` strategy is unaffected.
- Migrating or deleting projections left by earlier Outfitter versions in the system temporary
  directory. Removing files a prior version created, in a location shared with other software, is
  not a safe default.
- Specifying the source cache layout beyond the classification above, which is OFTR-004.
