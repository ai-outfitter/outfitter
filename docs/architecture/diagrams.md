# Architecture diagrams

Mermaid diagrams of how Outfitter turns `.agents` resources into a running agent CLI. Prose definitions live in [concepts](../documentation/concepts.md), per-adapter coverage in the [support matrix](../documentation/support-matrix.md), and the architectural shape in [architecture](./README.md).

## Components: sources to launched agent

Resources come from layered `.agents` trees: the project workspace overlay, the user's global layer, and cached remote catalogs, with higher layers winning by ID. A profile or task selects resources by slug from the merged set; the composer builds a harness-neutral composition plan; bake freezes it into an immutable artifact; and an adapter projects that artifact into one agent CLI's native files, flags, and environment.

```mermaid
flowchart LR
  subgraph layers [.agents layers - precedence high to low]
    PJ[Workspace<br>project/.agents/]
    US[Global<br>~/.agents/]
    CA[Cached catalogs<br>pinned remote sources]
  end

  subgraph resources [Protocol resources]
    AG[Agents]
    SK[Skills]
    TK[Tasks]
    KN[Knowledge / commands]
    JS[mcp.json / models.json]
  end

  layers --> RESOLVE[Resolver<br>merge by ID]
  resources -.stored in.- layers

  RESOLVE --> SELECT[Profile or task selection<br>personas, skills, subagents, inputs]
  SELECT --> BAKE[Bake<br>immutable artifact / .agents tree]

  BAKE --> AD{Adapter}
  AD -->|full projection| PI[Pi CLI<br>primary adapter]
  AD -->|partial, warns on gaps| CC[Claude Code CLI]

  BAKE --> DUMP[outfitter dump<br>deterministic .agents/ output]

  PI --> RUN([Launched agent process])
  CC --> RUN
```

## Sequence: `outfitter run --task X`

`run` resolves the effective resource set through layer precedence, composes the selection, bakes it (always, for tasks), asks the adapter to project the baked artifact into a launch plan, surfaces unprojectable elements as stderr warnings (fatal with `--strict`), and finally spawns the child agent CLI. Declared state paths persist useful agent state across runs.

```mermaid
sequenceDiagram
  actor User
  participant CLI as outfitter run
  participant Resolver as Resolver
  participant Baker as Composer / baker
  participant Adapter as Agent adapter (pi / claude)
  participant Agent as Agent CLI process

  User->>CLI: outfitter run --task X [--agent claude] [--strict]
  CLI->>Resolver: resolve effective resource set
  Resolver->>Resolver: layer .agents trees<br>(workspace > global > pinned remotes)
  Resolver-->>CLI: effective resources + shadow diagnostics
  CLI->>Baker: compose selection, validate inputs, bake
  Baker-->>CLI: immutable artifact
  CLI->>Adapter: project artifact
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
  subgraph declare [Source declarations in settings.yml]
    GH[github: owner/.agent<br>+ pinned ref, optional path]
    URI[uri: git+https://...]
    PATH[path: ../local-checkout]
  end

  SETUP[outfitter setup source] --> DETECT{Existing config?}
  DETECT -->|.agents tree| ADOPT[Adopt as-is]
  DETECT -->|~/.claude| PORT[Port + symlink back]
  DETECT -->|none| ONBOARD[Bootstrap from default catalog]

  GH --> SYNCOP[outfitter sync]
  URI --> SYNCOP
  SYNCOP --> CACHE[(Local cache)]
  SYNCOP --> STATUS[Per-source status:<br>updated / unchanged / skipped / failed]
  CACHE --> VALIDATE[Validate payloads]
  PATH -->|read live, no cache| LAYERS
  VALIDATE --> LAYERS[.agents layer stack]
  LAYERS --> RUN[outfitter run / list / validate / bake / dump]
```
