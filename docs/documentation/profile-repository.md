# Profile repositories

A profile repository (also called a profile catalog) is a git repository that publishes Outfitter profiles so a team or organization can share them. You can bootstrap a machine or project from one, or add one as an ongoing profile source that Outfitter keeps synchronized.

```bash
outfitter setup https://github.com/my_account/outfitter_config
```

## Authoring a catalog repository

A setup repository usually contains either root-level Outfitter files:

```text
outfitter_config/
  settings.yml
  profiles/
    engineering-default/profile.yml
```

or a `.outfitter/` folder:

```text
outfitter_config/
  .outfitter/
    settings.yml
    profiles/
      engineering-default/profile.yml
    deepwork/jobs/
```

Inside the profiles directory, both profile layouts work:

- **Flat profiles** — each `*.yml` or `*.yaml` file directly under the profiles directory is one profile. Best for catalogs where profiles are mostly YAML (controls, prompts inline). Easy to scan, diff, and review.
- **Directory profiles** — one folder per profile with a required `profile.yml`, plus bundled resources such as `prompts/`, `skills/`, `extensions/`, and `deepwork/jobs/` that travel with the profile.

See [Profiles](./profiles.md) for the full layout reference, inheritance, and prompt-include rules. A catalog can also publish a shared base profile marked `template: true` that role profiles inherit from without the base itself appearing as a launchable choice.

## Consuming a catalog as a profile source

Add the repository to `profile_sources` in your user (`~/.outfitter/settings.yml`) or project (`.outfitter/settings.yml`) settings:

```yaml
profile_sources:
  - github: my-org/outfitter-catalog # owner/repo shorthand
    ref: v1.2.0 # optional: pin a tag, branch, or commit
    path: profiles # optional: subdirectory inside the repo
    only: # optional: allowlist of profile ids
      - engineer
      - platform-operator
  - uri: git+https://git.example.com/team/catalog.git # any git URI
    except: # optional: blocklist of profile ids
      - experimental
```

Each source entry is one of:

- `path:` — a local directory (no `ref`; read live from disk).
- `github:` — an `owner/repo` GitHub shorthand.
- `uri:` — any git-cloneable URI, for non-GitHub hosts.

Remote entries (`github`/`uri`) additionally accept:

- `ref:` — a tag, branch, or commit to pin. With a `ref`, `outfitter sync` fetches and checks out exactly that ref. Without one, sync fast-forwards the repository's default branch, so you always track the catalog's latest state.
- `path:` — a subdirectory inside the repository that contains the profiles.
- `only:` / `except:` — filter which profile ids from the source are exposed. `only` is an allowlist; `except` is a blocklist.

## Remote settings

Beyond profiles, a repository can supply a shared settings file that Outfitter layers below your local settings:

```yaml
# ~/.outfitter/settings.yml
remote_settings:
  - github: my-org/outfitter-catalog
    path: settings.yml # required: file path inside the repo
    ref: v1.2.0 # optional pin
```

Remote settings are cached locally and merged at lower precedence than your project and user settings, so anything you set locally wins. This is how an organization distributes shared `profile_sources` and defaults without controlling each user's machine.

## Syncing and updating

`outfitter sync` synchronizes every remote source into the local cache under `~/.outfitter/cache/`:

1. Remote settings repositories are cloned or updated first, then reloaded.
2. Remote profile sources (including any added by remote settings) are cloned or updated.
3. Each synced profile source is validated; sync reports `updated`, `unchanged`, `skipped`, or `failed` per source.

Run `outfitter sync` after changing remote settings or profile sources, and periodically to pick up catalog updates. Pinned (`ref:`) sources stay on their pinned ref until you change it; unpinned sources fast-forward to the latest default branch on every sync.

## Private repositories

Private GitHub catalogs are an enterprise feature. When sync detects a private GitHub repository, it asks for confirmation before use and records the decision via the `enterprise.private_profile_catalogs` setting in `~/.outfitter/settings.yml`. Review the Outfitter Enterprise license or your enterprise agreement before enabling private catalogs. Non-GitHub `uri:` sources use whatever git credentials your environment already has; credentials embedded in URIs are redacted from sync output.

## Trust and review

Adding a catalog source means trusting its authors with your agent runtime. Profiles from a catalog can:

- **Inject extensions** into your agent launch (`controls.extensions`). Extensions are code that runs inside the agent process with full access to your system — files, network, and shell.
- **Add arbitrary CLI arguments** (`controls.args`) to the launched agent, which can change permission modes or other agent behavior.
- **Set environment variables** (`controls.environment`) for the agent process.
- **Shape prompts, skills, subagents, and DeepWork jobs** — steering what the agent does with the access it already has.

Before adding a source, review it:

1. Read every profile's `controls` — especially `extensions`, `args`, and `environment` — and any extension code the repository ships.
2. Check `remote_settings` targets: a settings file can add further profile sources you did not review.
3. Confirm the repository's ownership and that its maintainers are who you expect.
4. Prefer `only:` filters so you expose just the profiles you reviewed.

For organization catalogs, pin a `ref:` (a tag or commit) rather than tracking the default branch. A pinned ref makes updates an explicit, reviewable action — bump the ref after reviewing the diff — instead of silently pulling whatever the catalog publishes next. Unpinned sources are convenient for catalogs you maintain yourself, but they mean `outfitter sync` executes-by-configuration whatever landed upstream.
