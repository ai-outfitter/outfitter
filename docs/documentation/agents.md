# Agents

An agent is the protocol's identity resource — and, in Outfitter, the thing you run.
A directory under `agents/<id>/` holds an `agent.md` definition and an optional `config.json`.
Together they carry both _who the agent is_ and _what it runs with_: its skills, MCP servers, subagents, extensions, plugins, model, thinking level, and tool policy.
That whole bundle — identity plus loadout — is what earlier drafts called a "profile."
There is no separate profile resource; **an agent is the profile**.
See [Profiles](./profiles.md).

```text
.agents/
  agents/
    engineer/
      agent.md
      config.json   # optional
      skills/       # capabilities private to engineer
        release-debug/SKILL.md
      hooks/        # reserved for a future portable hook entity
    code-reviewer/
      agent.md
```

## agent.md

`agent.md` describes the identity in markdown — who the agent is, its policy and posture, how it approaches work — and declares its loadout in frontmatter:

```markdown
---
name: engineer
label: Engineer
description: Implements features and fixes with a bias toward small, verifiable changes.
skills: [wiki, research]
subagents: [code-reviewer]
extensions: [outfitter-mode]
plugins: [git-tools]
mcp: [github]
model: gpt-5.2
thinking: high
tools:
  allow: [read, edit, bash]
append_system_prompt:
  - repo_file: docs/architecture.md
---

# Engineer

You implement changes directly, keep diffs small, and verify before claiming done...
```

`name` is the stable slug used for resolution.
The optional `label` is the human-readable profile name shown during setup and in interactive harness UI.
When `label` is omitted, Outfitter uses the first level-one Markdown heading, then falls back to the slug.

Keep the prose focused on durable identity and behavior.
Per-capability procedures belong in [skills](./skills.md); the frontmatter only _selects_ resources by slug — it never copies their content.

### Loadout fields

| Field        | Selects                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `skills`     | [Skill](./skills.md) slugs made available to the run.                                                                     |
| `mcp`        | MCP servers from the tree's `mcp.json` to enable.                                                                         |
| `subagents`  | Agent slugs projected as harness delegates. See [Subagents](./subagents.md).                                              |
| `extensions` | Pi extensions to load — `npm:`/`git:` remote sources or local paths. See [Local path extensions](#local-path-extensions). |
| `plugins`    | Pi plugins to load. First-class, per the adapter.                                                                         |
| `model`      | Provider/model from `models.json`.                                                                                        |
| `thinking`   | Thinking/effort level.                                                                                                    |
| `tools`      | Allowed/denied tool policy for the run.                                                                                   |

Every value is a slug resolved across layers.
Skills first check `agents/<agent>/skills/<slug>/` across layer precedence, then fall back to catalog-wide `skills/<slug>/`.
This lets an agent own private implementation capabilities without exposing them to every agent in the catalog.
See [Skills](./skills.md#agent-local-skills).

`knowledge` and `commands` resolve the same way — an agent may keep private files under `agents/<agent>/knowledge/` and `agents/<agent>/commands/`, local-first over the catalog-wide trees.
`subagents` are always catalog-wide (a delegate is a shared agent).
`extensions`/`plugins` are harness-native passthroughs with no on-disk namespace, and `model`/`thinking`/`tools` are per-agent already via `config.json` merge.

### Provider and model registry

A selected model uses `provider/model`. Outfitter resolves it against the effective layered `models.json`; workspace definitions override home and catalog definitions by provider ID, while model entries merge by model ID. The resulting provider endpoint is canonical for the run — adapters do not silently reuse the model ID against a harness default endpoint.

```json
{
  "providers": {
    "company-claude": {
      "name": "Company Anthropic gateway",
      "baseUrl": "https://models.example.com/anthropic",
      "api": "anthropic-messages",
      "apiKey": "$COMPANY_MODELS_TOKEN",
      "headers": { "X-Tenant": "engineering" },
      "models": [{ "id": "luna", "reasoning": true }]
    },
    "company-codex": {
      "name": "Company OpenAI gateway",
      "baseUrl": "https://models.example.com/openai/v1",
      "api": "openai-responses",
      "apiKey": "$COMPANY_MODELS_TOKEN",
      "models": [{ "id": "sol", "reasoning": true }]
    },
    "ollama": {
      "name": "Local Ollama",
      "baseUrl": "http://127.0.0.1:11434/v1",
      "api": "openai-completions",
      "models": [{ "id": "qwen3-coder" }]
    }
  }
}
```

An agent can select `company-claude/luna`, `company-codex/sol`, or `ollama/qwen3-coder` without carrying endpoint configuration of its own. Pi receives the merged registry plus native provider/model flags. Claude Code projects `anthropic-messages` targets through its native gateway environment. Codex projects `openai-responses` targets through native provider overrides. The example Ollama `openai-completions` target remains available to Pi, but Codex reports it as unsupported. An unsupported dialect warns and fails under `--strict`; it never falls back to the same model name at another endpoint.

Credentials are references, not catalog content: use a single environment-variable reference such as `"$COMPANY_MODELS_TOKEN"`. Literal API keys, command-based credential sources, and literal `Authorization` headers are rejected. Supply the named variable in the launch environment.

## Inheritance and prompt fragments

An agent may specialize one or more base agents with `inherits`.
Parents compose recursively, parent-first, and multiple parents keep the order written in the child.
Diamond graphs include each ancestor once.
Outfitter fails validation and composition for missing parents, self-inheritance, or indirect cycles.

```markdown
---
name: platform-engineer
inherits: engineer
skills: [nix, kubernetes]
system_prompt:
  file: prompts/platform-system.md
append_system_prompt:
  - file: prompts/platform-review.md
  - repo_file: docs/architecture.md
prompt_template:
  file: prompt-templates/implementation.md
---

# Platform Engineer

You specialize the base engineer for NixOS and Kubernetes work.
```

Merge policy is deterministic: Markdown bodies append ancestor-first and child-last; list fields (`skills`, `subagents`, `mcp`, `extensions`, `plugins`, `append_system_prompt`) de-duplicate parent-first; scalar controls (`system_prompt`, `prompt_template`, `model`, `thinking`, `label`, `description`) use the nearest child declaration.
Parent-declared skills resolve against that parent's local skill namespace before catalog fallback, so a child cannot accidentally capture a parent's private loadout.

Prompt sources are explicit objects.
`file` reads trusted catalog content relative to the `.agents` layer that owns the declaring agent and must stay inside that layer.
`repo_file` reads active-repository content relative to the project root, remains contained after symlink resolution, and is treated as untrusted repository context; missing optional repository files warn so reusable catalog agents do not become brittle across projects.
Named prompt slugs are intentionally not accepted yet.

Effective prompt order is: selected `system_prompt` or root `system-prompt.md`; root `agents.md`; inherited then child `append_system_prompt`; inherited then child agent bodies; any runtime passthrough append prompts.

Inheritance is not delegation.
Inheritance composes one selected agent's identity and loadout before launch.
`subagents` expose other agents as delegates the selected agent may call at runtime.

## Pi configuration overlay

An agent may own native Pi configuration under `agents/<agent>/pi/`.
Outfitter overlays that folder into the temporary `PI_CODING_AGENT_DIR` before launching Pi, so native files keep their standard names and formats:

```text
agents/founder/
├── agent.md
└── pi/
    ├── settings.json
    ├── keybindings.json
    ├── models.json
    └── themes/
```

The overlay is file-based.
Source layers are applied from lowest to highest precedence, so a workspace `agents/founder/pi/keybindings.json` replaces the same file from a global or remote catalog while unrelated lower-layer files remain present.
Structured JSON files compose instead of replacing: when a higher layer provides a same-named `*.json` file that a lower overlay layer also delivered, and both documents are JSON objects, Outfitter deep-merges them — lower layer first, the higher layer's values winning on every conflicting key — and rewrites the merged file in canonical two-space JSON formatting.
Arrays inside a merged document are replaced wholesale by the higher layer, never concatenated.
Files that are not JSON, and JSON documents that cannot merge, keep whole-file replacement; a higher layer's file that is not valid JSON replaces the lower file whole and warns (fatal under `--strict`).
Generated runtime files are not overlay layers and keep their documented generation semantics.
Outfitter does not follow symlinks from the overlay.
The folder is ignored when the selected harness is not Pi.

A settings-layer overlay sits one step below the per-agent folder: `agent_defaults.pi_overlay` in `settings.yml` points at a directory whose files are overlaid into every Pi run, standalone agents included (see [Settings — Pi runtime-file overlay](./settings.md#pi-runtime-file-overlay)).
For the same relative path the per-agent `pi/` folder wins, the settings layer wins over generated defaults, and a higher-precedence settings layer wins over a lower one; for JSON object documents that merge, the more specific tier wins per key instead of per file.
File-based extension configurations have a generated tier one step further down: `agent_defaults.extension_configs` entries are written to `extensions/<name>.json` before the overlays, so an overlay-delivered same-named file wins (see [Settings — Extension configuration files](./settings.md#extension-configuration-files)).

Cached `npm:` extensions are inherited by fresh loaders as well.
They install into Outfitter's extension cache and reach the main session through launch-time `--extension` flags; in addition, the entry files their package manifests declare (the `pi.extensions` files that exist on disk, else the package's `index.ts`/`index.js`) are merged into the generated `settings.json` `extensions:` array of the materialized agent directory.
Fresh extension loaders — pi-subagents child sessions, SDK sessions — read exactly that array, so they load the same extension set as the main session without seeing the launch flags.
Extension paths delivered by a `pi/` overlay or `harness_defaults.pi` keep their position ahead of the generated entries, the generated entries follow in declared loadout order, and duplicates are collapsed; a package whose manifest exposes no resolvable entry warns (and is fatal under `--strict`) instead of failing the run.
Outfitter resolves entries only from the cache that is already on disk, so this works offline and never reinstalls.

Package-declared themes, skills, and prompts inherit the same way.
Every served extension load directory — an npm cache install, a `git:` checkout, or a local path — is also projected into the generated `settings.json` `packages:` array, and pi resolves each entry through its own package rules: the `pi.themes`, `pi.skills`, and `pi.prompts` its manifest declares (or conventional `themes/`, `skills/`, `prompts/` directories) load in fresh loaders exactly as the `--extension` flag loads them in the main session, with the same glob and exclusion semantics.
A package-declared theme is therefore resolvable by name (for example a `"theme": "forge"` harness default) in child sessions, not just in the main session.
Outfitter projects package roots only — never individual manifest paths — so manifest problems surface through pi's own diagnostics identically in both sessions, and the launch arguments do not change.

### Local path extensions

The `extensions:` list also accepts local paths, so developing an extension in place needs no out-of-band overlay or machine-specific absolute path in a shared catalog:

```yaml
extensions:
  - ./extensions/helper # relative to the declaring layer's .agents directory
  - ../shared-ext # parent-relative, same rule
  - ~/exts/personal # against your home directory
  - /opt/exts/pinned # absolute
```

A specifier must start with `npm:`, `git:`, `./`, `../`, `~/` , or `/` — a bare name is rejected because it is ambiguous with resource slugs.
Relative paths resolve against the `.agents` directory of the layer that declared them (the agent's own layer, or the `config.json` layer that overrode `extensions`), never against the directory you launch from, and a duplicate specifier collapses to its first declaration.
Settings-layer defaults (`agent_defaults.extensions`) accept `npm:`, `git:`, `~/` , and absolute forms only, because merged settings have no single declaring directory.

Local paths bypass the extension cache entirely: the files already exist on disk, so there is no install and no network.
Outfitter checks that the target exists (a missing target warns and is skipped, fatal under `--strict`) and passes the resolved path to pi both as `--extension` and in the generated `settings.json` `extensions:` array — pi accepts a directory (resolved by its manifest or index file, else discovered one level deep) or a single extension file, and dedupes the two routes.
`outfitter dump` keeps the declared specifiers as written, so dumps stay portable.

The cache also stays loadable from fresh loaders: before an npm extension is served, Outfitter checks that every non-optional peer dependency its manifest declares is present in the cache, and installs any missing peer into the cache's npm root with npm (resolving the peer's declared range) when the run is online.
This matters because pi deliberately does not install extension peers, while fresh loaders resolve the entry file's imports from the cache — a missing peer kills the load there even when the main session works.
A satisfied cache hit performs no installs and no network; offline runs warn about missing peers instead of installing, and a failed peer install warns without dropping the extension.

Installs stay fresh: a bare `npm:<name>` specifier resolves the registry's current release at install time and installs that exact version, so a new install cannot be poisoned by a version range an earlier install saved into the cache (a caret on a `0.0.x` version is a hard pin that would otherwise fossilize the package forever).
A specifier carrying an explicit version range installs as declared, but when the registry's current release falls outside the range, Outfitter warns that the range can no longer match current releases.
An already-cached extension keeps serving offline no matter what the registry says; to move a stale cached install forward, clear the extension cache (or the package's directory under it) and let the next online run reinstall.

Outfitter writes generated identity, composed skills, selected delegates, and selected MCP servers after applying the native overlay, and seeds durable Pi credentials immediately before launch.
Those runtime-owned resources therefore cannot be replaced accidentally by a profile overlay.
One delegation-specific exception: an overlay `agents/<slug>.md` that collides with a declared delegate is replaced by the delegate, because a declared `subagents:` selection is an explicit choice the profile made.

The runtime `agents/` directory is rebuilt for declared delegates without deleting foreign content: Outfitter records the delegate files it generated in a rebuild manifest under the projection root, and a later run into the same retained root removes only those tracked files when the delegate selection shrinks.
Overlay-provided agent definitions — per-agent or settings-layer — are never tracked or removed, so they survive every run.
If the rebuild manifest is missing or unreadable, the rebuild skips cleanup rather than risk deleting files Outfitter did not write.

`agents/<agent>/mcp.json` merges by server id over layered tree-root `mcp.json` files.
The Pi projection writes only the servers selected by the active agent's `mcp` loadout into the runtime `mcp.json`.

The per-agent `agents/<agent>/hooks/` namespace remains reserved and is not yet projected (adapter parity is tracked in [#183](https://github.com/ai-outfitter/outfitter/issues/183)).
Its presence surfaces a validation warning so content placed there is never silently dropped.

## config.json

The optional `config.json` carries structured or harness-specific configuration that is awkward in frontmatter, following the protocol's schema for the pinned revision.
JSON files merge across layers per the protocol's JSON merge behavior, so a workspace layer can adjust one field of a globally defined agent — swap the model, add an extension — without copying the whole definition.

## Tree-level context

Two files at the tree root complement agent definitions:

- `agents.md` — shared operating context that applies to every run from this tree.
- `system-prompt.md` — the base system prompt an agent's identity layers on top of.

## Running an agent

Select an agent by slug; choose the harness with `--harness`:

```bash
outfitter run engineer
outfitter run engineer --harness claude
```

`default_agent` in [settings](./settings.md) sets what plain `outfitter` runs.

## Resolution

Agents resolve by slug across layers — workspace, global, then remote sources — with merge-by-ID semantics: a workspace `agents/engineer/` overrides a global or remote one.
Agent-local skills merge by their owner and slug using the same layer order.
`outfitter list agents` shows every resolvable agent and its winning source; `outfitter list skills --agent engineer` shows its effective skill namespace; `outfitter validate` reports broken loadout slugs and shadowed definitions.

## Agents as delegates

The same agent definition can also be selected as a [subagent](./subagents.md) in another agent's `subagents` list — a delegate the run can hand focused work to.
A leader agent's loadout is where that delegation is declared.
For Pi runs, Outfitter also resolves and materializes the delegate's selected skills.
Those skills are available to the delegate without being loaded into the leader's active skill set.
