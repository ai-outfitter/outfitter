# Architecture diagrams

Mermaid diagrams of how Outfitter turns `.agents` resources into a running agent. Prose definitions live in [concepts](../documentation/concepts.md), per-adapter coverage in the [support matrix](../documentation/support-matrix.md), and the architectural shape in [architecture](./README.md).

## Components: sources to launched agent

Resources come from layered `.agents` trees: the project workspace overlay, the user's global layer, and cached remote catalogs, with higher layers winning by ID. The selected agent composes its loadout by slug from the merged set; the composer builds a harness-neutral composition plan; and an adapter projects that plan into one harness's native files, flags, and environment.

```mermaid
flowchart LR
  subgraph layers [".agents layers — precedence high to low"]
    workspace["Workspace<br/>project/.agents/"]
    global["Global<br/>~/.agents/"]
    catalogs["Cached catalogs<br/>pinned remote sources"]
  end

  subgraph resources ["Protocol resources"]
    agents["Agents + loadouts"]
    skills["Skills"]
    knowledge["Knowledge / commands"]
    config["mcp.json / models.json"]
  end

  layers --> resolver["Resolver<br/>merge by ID"]
  resources -. stored in .- layers

  resolver --> composed["Composed agent<br/>identity + skills, subagents, mcp, model"]

  composed --> adapter{Adapter}
  adapter -->|full projection| pi["Pi CLI<br/>primary adapter"]
  adapter -->|partial, warns on gaps| claude["Claude Code CLI"]

  composed --> dump["outfitter dump<br/>deterministic .agents/ output"]

  pi --> run(["Launched agent process"])
  claude --> run
```

## Sequence: `outfitter run <agent>`

`run` resolves the effective resource set through layer precedence, composes the selected agent, asks the adapter to project the composition into a launch plan, surfaces unprojectable elements as stderr warnings (fatal with `--strict`), and finally spawns the child harness. Declared state paths persist useful agent state across runs.

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant CLI as outfitter run
  participant Resolver as Resolver
  participant Composer as Composer
  participant Adapter as Agent adapter (pi / claude)
  participant Agent as Agent CLI process

  User->>CLI: outfitter run <agent> [--harness claude] [--strict]
  CLI->>Resolver: resolve effective resource set
  Resolver->>Resolver: layer .agents trees<br>(workspace > global > pinned remotes)
  Resolver-->>CLI: effective resources + shadow diagnostics
  CLI->>Composer: compose selected agent
  Composer-->>CLI: composition plan
  CLI->>Adapter: project composition
  Adapter-->>CLI: projection plan + warnings
  alt --strict and warnings
    CLI-->>User: fail with unsupported-element error
  else warnings without --strict
    CLI-->>User: warn to stderr, continue
  end
  CLI->>Adapter: create launch plan
  Adapter-->>CLI: command, args, env<br>(e.g. CLAUDE_CONFIG_DIR, --model, --skill)
  CLI->>CLI: snapshot state baseline
  CLI->>Agent: spawn agent CLI with launch plan
  Agent-->>User: interactive or headless session
  Agent-->>CLI: exit code
  CLI->>CLI: detect state writes, persist per declared state paths
```

## Catalog setup and sync

`outfitter setup <source>` adopts an existing `.agents` tree, offers the `~/.claude` port, or bootstraps from a catalog given as a GitHub `owner/repo` shorthand, a git URI, or a local path. `outfitter sync` keeps every remote source current: each `github:`/`uri:` entry is cloned or fast-forwarded into the cache (checked out at `ref` when pinned) and validated before its resources join the layer stack that `run` consumes. Local `path:` sources are read live and never cached.

```mermaid
flowchart TB
  subgraph declare ["Source declarations in settings.yml"]
    githubsrc["github: owner/.agent<br/>+ pinned ref, optional path"]
    urisrc["uri: git+https://..."]
    pathsrc["path: ../local-checkout"]
  end

  setup["outfitter setup source"] --> detect{"Existing config?"}
  detect -->|.agents tree| adopt["Adopt as-is"]
  detect -->|~/.claude| port["Port + symlink back"]
  detect -->|none| onboard["Bootstrap from default catalog"]

  githubsrc --> sync["outfitter sync"]
  urisrc --> sync
  sync --> cache[("Local cache")]
  sync --> status["Per-source status:<br/>updated / unchanged / skipped / failed"]
  cache --> validate["Validate payloads"]
  pathsrc -->|read live, no cache| stack
  validate --> stack[".agents layer stack"]
  stack --> consumers["outfitter run / list / validate / dump"]
```
