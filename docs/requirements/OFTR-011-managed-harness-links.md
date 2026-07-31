# OFTR-011: Managed Harness Links

## Overview

Outfitter resolves one `.agents` catalog, but a user's coding harnesses each read their own
user-global configuration directory. Without a managed path, every user hand-maintains symlinks
from `~/.claude`, `~/.codex`, `~/.gemini`, and `~/.copilot` back into that catalog, and those links
silently drift: a second config directory is missed, a renamed skill leaves a dangling link, and a
harness that needs a translated format gets a symlink that never loads.

`outfitter link` is the opt-in provisioning command that owns those links. It is deliberately
separate from `outfitter run`: `run` assembles a temporary composite runtime directory and deletes
it when the child exits, while `link` writes persistent files into directories the harness owns and
then exits. This document governs the persistent path only, and implements the managed-projection
half of the deferred scope tracked in issue #187.

The governing safety property is that Outfitter must never destroy configuration a user wrote by
hand. Every rule below follows from it.

## Requirements

### OFTR-011.1: Harness Registry

1. Outfitter MUST declare, for each supported harness, its user-global config directory and the
   location of every resource surface it manages.
2. A resource kind absent from a harness's declared surfaces MUST be treated as unsupported for
   that harness, and MUST NOT be projected to a guessed location.
3. Declared surfaces MUST correspond to locations the harness actually reads, verified against an
   installed harness release rather than inferred from documentation alone.
4. The registry MUST record which projection strategy each surface uses: a managed symlink, a
   generated file, or a merge into a harness settings document.
5. Requesting an unsupported resource-and-harness combination MUST be reported to the user, and
   MUST fail the command under `--strict`.

### OFTR-011.2: Ownership and Conflict Safety

1. Outfitter MUST record every path it creates in a persistent ownership manifest.
2. Outfitter MUST NOT overwrite, adopt, or delete a path absent from that manifest, regardless of
   the path's current content or link target.
3. An unmanaged path at a target location MUST be reported as a conflict and left unchanged.
4. `--force` MUST be required to replace an unmanaged path, and MUST report each replacement.
5. The ownership manifest MUST be stored as machine-local state outside the `.agents` tree.
6. A missing or malformed manifest MUST be treated as "nothing is managed", so recovery reports
   conflicts rather than deleting user configuration.
7. Hook entries merged into a harness settings document MUST carry an ownership marker on each
   generated entry, because a path-level manifest cannot express ownership of array elements.
8. Merging hooks MUST preserve every unmanaged key and every hand-written hook entry in the target
   settings document.
9. A harness settings document that cannot be parsed MUST be left unchanged and reported.

### OFTR-011.3: Reconciliation

1. Running `link` repeatedly with an unchanged catalog MUST NOT modify any path.
2. A managed link whose source moved MUST be repointed.
3. A managed path whose catalog resource no longer exists MUST be removed.
4. `--dry-run` MUST report exactly the changes a real run would make, and MUST write nothing,
   including to the ownership manifest.
5. `--remove` MUST remove every managed path and forget the manifest.
6. `--remove` MUST strip Outfitter's marked hook entries from a merged settings document without
   deleting that document or disturbing any other key or hand-written entry.
7. Withdrawing every hook declaration MUST strip Outfitter's marked entries on the next run, so a
   removed declaration does not linger in harness configuration.

### OFTR-011.4: Format Adapters

1. A resource whose catalog format matches the harness format MUST be projected as a symlink, so
   catalog edits take effect without re-running `link`.
2. A resource whose harness format differs MUST be generated, and the generated file MUST identify
   itself as generated.
3. Harness-neutral hook events declared in settings MUST be translated to each harness's native
   event name.
4. A neutral hook event with no native equivalent MUST be reported as unsupported rather than
   mapped to an approximate event.

### OFTR-011.5: Settings Surface

1. Users MUST be able to select which harnesses are provisioned through the `harnesses` settings
   block.
2. The default selection MUST provision only harnesses whose config directory already exists, so
   Outfitter never creates configuration for an uninstalled harness.
3. Users MUST be able to declare more than one config directory per harness, because a harness can
   have several live config roots.
4. Users MUST be able to restrict which resource kinds a harness receives.
5. The `harnesses` block MUST follow Outfitter's standard settings precedence.
6. Hook declarations across settings layers MUST accumulate lowest-precedence first, so a project
   adds to the user's hooks rather than replacing them.
