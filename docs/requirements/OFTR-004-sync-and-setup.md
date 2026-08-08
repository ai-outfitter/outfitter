# OFTR-004: Setup, Sync, and Profile Creation Commands

> **Amended (RFC [#165](https://github.com/ai-outfitter/outfitter/issues/165) and
> [#184](https://github.com/ai-outfitter/outfitter/issues/184), 2026-07-25):** the `.agents`-native
> `setup` and `sync` commands are implemented. See [OFTR-010](OFTR-010-onboarding-welcome.md) for
> onboarding. The profile-era `profile create` / `profile list` commands (OFTR-004.3/.5) remain
> removed/deferred.

## Overview

Outfitter provides setup and maintenance commands that onboard a new user, synchronize remote `.agents` sources, and (in future) scaffold resources.

## Requirements

### OFTR-004.1: Setup Command

1. Outfitter MUST provide a `setup` command.
2. The `setup` command MUST run the interactive `.agents` onboarding flow defined in OFTR-010 (write
   `default_agent`/`default_harness` and a starter agent), sharing one implementation with the
   implicit first-run entry from `run`.

### OFTR-004.2: Sync Command

1. Outfitter MUST provide a `sync` command.
2. The `sync` command MUST read and validate settings before synchronizing sources.
3. The `sync` command MUST synchronize locally configured `remote_settings` first, reload the
   merged settings, and then synchronize every remote `sources` entry in the resulting settings.
   Local `path:` sources MUST remain live and MUST NOT be copied into the cache.
4. The `sync` command MUST store every URI or GitHub repository under
   `<cache_directory>/repos/<encoded-uri-and-ref>/`. The default `cache_directory` is
   `~/.agents/cache`; the selected value MUST be shared by sync, remote-settings loading, layer
   discovery, and default-catalog bootstrap.
5. The encoded URI cache path MUST support non-GitHub URIs.
6. The `sync` command MUST validate fetched remote settings against the settings schema and validate
   fetched `.agents` payloads before making them active.
7. The `sync` command MUST report `updated`, `unchanged`, `skipped`, or `failed` for each configured
   remote and MUST exit nonzero when any required remote fails or merged settings are invalid.
8. Fetch and validation MUST occur in a temporary sibling directory. A successful checkout MUST be
   swapped into place atomically; any fetch, checkout, validation, or swap failure MUST preserve an
   existing valid cache. The first version of `sync` MUST NOT require lockfiles or provenance.
9. The `sync` command MUST redact credentials embedded in source URIs from status, errors, cache
   identifiers, and captured Git stdout/stderr.
10. `~/.agents/settings.yml` MUST be the source of truth for private GitHub profile catalog enablement, using `enterprise.private_catalogs: true`.
11. If `enterprise.private_catalogs` is already true in `~/.agents/settings.yml`, setup and sync MUST NOT show private-catalog enterprise information or prompts.
12. If setup or sync detects a confirmed-private GitHub catalog while the home setting is not enabled, interactive flows SHOULD ask whether to enable it and MUST include this prompt text:

    ```text
    Private GitHub profile catalog detected: OWNER/REPO.

    Private profile catalog support is covered by the Outfitter Enterprise license.
    Review code/enterprise/LICENSE or your enterprise agreement before enabling.

    Enable private profile catalogs in ~/.agents/settings.yml? [y/N]
    ```

13. If the user accepts, setup or sync MUST write `enterprise.private_catalogs: true` to `~/.agents/settings.yml` and show:

    ```text
    info: Enabled private profile catalogs in ~/.agents/settings.yml.
    ```

14. If the user declines, setup or sync MUST skip that private catalog without changing settings and show:

    ```text
    info: Private profile catalog setup was skipped for OWNER/REPO; no settings were changed.
    ```

15. Non-interactive setup and sync SHOULD skip confirmed-private GitHub catalogs without warning, error, or blocking public/unknown sources, and SHOULD show:

    ```text
    info: Private GitHub profile catalog detected: OWNER/REPO. Enable enterprise.private_catalogs in ~/.agents/settings.yml after reviewing code/enterprise/LICENSE or your enterprise agreement.
    ```

16. GitHub privacy detection MUST only treat an HTTP 200 GitHub API response with JSON `private: true` as private. Public responses, unknown responses, HTTP 403/404, network failures, malformed responses, and non-GitHub sources MUST NOT warn, error, or block.
17. Private catalog enablement MUST remain informational commercial governance and MUST NOT collect, echo, persist, synthesize, or validate provider credentials.
18. Resolution MUST report a configured remote source or remote-settings target whose cache is
    absent with actionable `outfitter sync` guidance instead of silently dropping it.
19. Automatic network synchronization during `outfitter run` is out of scope. Operators invoke
    `outfitter sync` explicitly.

### OFTR-004.3: Create Profile Command

1. Outfitter MUST provide a `profile create` command.
2. The `profile create` command MUST require a destination scope or destination path.
3. The `profile create` command MUST require a profile name.
4. The `profile create` command MUST create a placeholder profile folder with a valid `profile.yml` file.
5. The `profile create` command SHOULD create conventional subfolders for common profile resources.

### OFTR-004.4: Command Object Implementation

1. All CLI command entry points MUST execute command objects rather than duplicate implementation logic in parser callbacks.
2. Command objects MUST accept typed input objects rather than reading directly from `process.argv`.
3. Command objects SHOULD receive filesystem, settings, profile, and process dependencies through constructors or equivalent dependency injection.
4. The `profile create` parser entry point MUST execute the profile-creation command object.

### OFTR-004.5: List Profiles Command

1. Outfitter MUST provide a `profile list` command.
2. The `profile list` command MUST read and validate settings before listing profiles.
3. The `profile list` command MUST list unique profile IDs from configured local and cached remote profile sources.
4. When multiple configured sources define the same profile ID, the listed profile metadata MUST come from the highest-precedence loaded definition.

### OFTR-004.6: Transitive Catalog Sources

A remote catalog may declare its own `sources` in a settings file at its payload root
(`settings.yml`, or `.agents/settings.yml` when the payload root has no `settings.yml`). Those
declarations form the catalog's dependencies; resolution and sync follow them transitively so a
pinned root catalog determines its dependency closure.

Transitive resolution is deliberately restricted to the narrowest safe subset of source references
while the remote-catalog trust and provenance model (issue #212) is defined: a transitive source
must be a `github:` shorthand pinned to an immutable ref. This keeps every transitive fetch `sync`
performs within the private-catalog gate and a known git transport, and prevents a declaration from
selecting an arbitrary git transport or escaping its fetched checkout. (First-party default-catalog
bootstrap is the one gate exemption — see OFTR-004.6.10.)

1. Layer discovery MUST resolve `github:` `sources` declared by a cached remote catalog's own
   settings file and append them as layers, and `sync` MUST fetch the same closure.
2. A transitive source MUST contribute only `.agents` payload content. Every other setting declared
   by a catalog's settings file (default agent, default harness, cache directory, state persistence,
   custom settings, startup, enterprise, `remote_settings`) MUST NOT take effect through transitive
   resolution.
3. Every directly configured source MUST outrank every transitive source. Transitive layers MUST be
   ordered breadth-first by dependency depth, then by declaring-catalog order, then by declaration
   order within a catalog's settings file.
4. A transitive source MUST be a `github:` shorthand pinned to an immutable ref (a full commit SHA
   or a version tag). Resolution and sync MUST skip a declared source that is a `uri:` source, that
   carries a `path:` subpath, or whose ref is absent or not immutable, and report a warning naming
   the declaring catalog.
5. Resolution and sync MUST skip a local `path:` source declared by a remote catalog and report a
   warning naming the declaring catalog.
6. A source already resolved — directly or by an earlier catalog — MUST NOT be resolved again;
   dependency cycles MUST terminate without error.
7. `sync` MUST fetch newly discovered transitive sources until no new sources remain, report each
   with kind `transitive` and the OFTR-004.2.7 status vocabulary, and gate each through the same
   private-catalog policy as directly configured sources.
8. A cached catalog settings file that is unreadable (not a regular file inside the checkout — for
   example a `settings.yml` committed as a symlink to a directory or outside the checkout) or that
   fails schema validation MUST NOT fail resolution or sync; its declared sources MUST be skipped
   with a warning naming the declaring catalog.
9. Resolution MUST report a transitive source whose cache is absent with the same actionable
   `outfitter sync` guidance as a directly configured source (OFTR-004.2.18).
10. Default-catalog bootstrap MUST fetch the pinned `github:` closure the default catalog declares
    before setup offers or launches a profile, so a first run resolves a default profile whose
    skills a depended-on catalog supplies without a separate `outfitter sync`. Bootstrap MUST accept
    a dependency that ships only skills (or any recognized `.agents` payload) rather than requiring
    it to contain agents. A declared dependency that cannot be fetched MUST be reported by
    resolution as unsynchronized rather than failing setup, while the root catalog failing to fetch
    remains fatal. Because the default catalog is the first-party, pinned catalog Outfitter ships,
    bootstrap MAY fetch its declared closure without the interactive private-catalog gate that
    `outfitter sync` applies; the gate remains a property of `sync`, not of first-party bootstrap.
11. When `sync` validates a single fetched source in isolation, an unresolved loadout **skill or
    agent** reference MUST NOT fail that source, because the referenced skill or agent may be
    supplied by a catalog the source declares as a transitive dependency. Structural validity of the
    source (schema, resource naming) MUST still be enforced. Whether every loadout skill/agent slug
    resolves is authoritatively enforced against the merged effective set by `outfitter validate`,
    which MUST treat an unresolved loadout skill or agent reference as an error. (This concerns only
    skill and agent loadout slugs; an unknown MCP server reference remains a warning, unchanged.)
    Consistent with OFTR-005.3.4, the run-time composer surfaces an unresolved loadout reference as a
    non-fatal warning (fatal only under `outfitter run --strict`); `outfitter validate` is the
    command that fails on it.
