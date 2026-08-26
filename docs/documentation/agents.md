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

| Field        | Selects                                                                      |
| ------------ | ---------------------------------------------------------------------------- |
| `skills`     | [Skill](./skills.md) slugs made available to the run.                        |
| `mcp`        | MCP servers from the tree's `mcp.json` to enable.                            |
| `subagents`  | Agent slugs projected as harness delegates. See [Subagents](./subagents.md). |
| `extensions` | Pi extension package specifiers or local paths to load.                      |
| `plugins`    | Pi plugins to load. First-class, per the adapter.                            |
| `model`      | Provider/model from `models.json`.                                           |
| `thinking`   | Thinking/effort level.                                                       |
| `tools`      | Allowed/denied tool policy for the run.                                      |

Skill, MCP, and subagent values are slugs resolved across layers.
Skills first check `agents/<agent>/skills/<slug>/` across layer precedence, then fall back to catalog-wide `skills/<slug>/`.
This lets an agent own private implementation capabilities without exposing them to every agent in the catalog.
See [Skills](./skills.md#agent-local-skills).

`knowledge` and `commands` resolve the same way — an agent may keep private files under `agents/<agent>/knowledge/` and `agents/<agent>/commands/`, local-first over the catalog-wide trees.
`subagents` are always catalog-wide (a delegate is a shared agent).
`extensions`/`plugins` are harness-native passthroughs with no on-disk namespace, and `model`/`thinking`/`tools` are per-agent already via `config.json` merge.

For Pi, an extension may be a remote `npm:` or `git:` specifier, or a local file/directory path. Relative paths beginning with `./` or `../` resolve from the `.agents` payload root of the agent that declares them, including inherited agents from another layer. Paths beginning with `~/` resolve from the active Outfitter home directory, and absolute paths remain absolute. Local targets must already exist; Outfitter passes their resolved paths directly with `--extension` and never installs or copies them into its extension cache.

```yaml
extensions:
  - ./extensions/local-tools.ts
  - ../shared/pi-extension
  - ~/projects/my-extension
  - /opt/company/pi-extension
```

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
Outfitter does not follow symlinks from the overlay.
The folder is ignored when the selected harness is not Pi.

Outfitter writes generated identity, composed skills, selected delegates, and selected MCP servers after applying the native overlay, and seeds durable Pi credentials immediately before launch.
Those runtime-owned resources therefore cannot be replaced accidentally by a profile overlay.

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
