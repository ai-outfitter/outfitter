# Architecture diagrams

Mermaid diagrams of how Outfitter turns profile definitions into a running agent CLI. Prose definitions live in [concepts](../documentation/concepts.md), per-adapter coverage in the [support matrix](../documentation/support-matrix.md), and the architectural shape in [architecture](../architecture/README.md).

## Components: sources to launched agent

Profiles come from layered sources: project-local, project, user, and cached remote catalogs, with higher layers winning on conflicts. The selected profile's inheritance stack is merged deterministically into a composite profile — a temporary runtime config directory — which an adapter translates into one agent CLI's native files, flags, and environment. DeepWork jobs, skills, extensions, and prompts travel with profiles as bundled resources and flow through the same generic-controls pipeline.

```mermaid
flowchart LR
  subgraph sources [Profile sources - precedence high to low]
    PL[Project-local<br>.outfitter/local/]
    PJ[Project<br>.outfitter/]
    US[User<br>~/.outfitter/]
    CA[Cached catalogs<br>~/.outfitter/cache/]
  end

  subgraph resources [Bundled profile resources]
    SK[Skills]
    DW[DeepWork jobs]
    EX[Extensions]
    PR[Prompts and includes]
  end

  PL --> MERGE
  PJ --> MERGE
  US --> MERGE
  CA --> MERGE
  resources --> MERGE

  MERGE[Deterministic merge<br>profile stack + inherits] --> CP[Composite profile<br>temp config dir]

  CP --> AD{Adapter}
  AD -->|full control set| PI[Pi CLI<br>primary adapter]
  AD -->|partial, warns on gaps| CC[Claude Code CLI]

  PI --> RUN([Launched agent process])
  CC --> RUN
```

## Sequence: `outfitter run --profile X`

`run` resolves the profile through layer precedence, assembles the composite profile directory under the system temp dir, asks the adapter to translate generic controls into a launch plan, surfaces untranslatable controls as stderr warnings (fatal with `--strict`), and finally execs the child agent CLI with the assembled config, flags, and environment. A watcher keeps the composite profile refreshed from its inputs while the agent runs, and declared state paths persist useful agent state across runs.

```mermaid
sequenceDiagram
  actor User
  participant CLI as outfitter run
  participant Loader as Profile resolution
  participant Assembler as Composite profile assembler
  participant Adapter as Agent adapter (pi / claude)
  participant Agent as Agent CLI process

  User->>CLI: outfitter run --profile X [--agent claude] [--strict]
  CLI->>Loader: resolve profile X
  Loader->>Loader: layer settings and sources<br>(project-local > project > user > cached remotes)
  Loader->>Loader: merge inheritance stack deterministically
  Loader-->>CLI: resolved profile + settings
  CLI->>Adapter: plan composite profile from generic controls
  Adapter-->>CLI: composite profile plan + warnings
  alt --strict and warnings
    CLI-->>User: fail with unsupported-control error
  else warnings without --strict
    CLI-->>User: warn to stderr, continue
  end
  CLI->>Assembler: write composite profile (temp config dir)
  CLI->>Adapter: create launch plan
  Adapter-->>CLI: command, args, env<br>(e.g. CLAUDE_CONFIG_DIR, --model, --extension)
  CLI->>CLI: snapshot state baseline, start input watcher
  CLI->>Agent: spawn agent CLI with launch plan
  Agent-->>User: interactive session
  Agent-->>CLI: exit code
  CLI->>CLI: detect state writes, persist per declared state paths
```

## Catalog setup and sync

`outfitter setup <source>` bootstraps settings and profiles from a catalog given as a GitHub `owner/repo` shorthand, a git URI, or a local path, then hands off to Pi-native onboarding. `outfitter sync` keeps every remote source current: each `github:`/`uri:` entry is cloned or fast-forwarded into `~/.outfitter/cache/` (checked out at `ref` when pinned), validated, and filtered by `only`/`except` before its profiles join the layer stack that `run` consumes. Local `path:` sources are read live and never cached.

```mermaid
flowchart TB
  subgraph declare [Source declarations in settings.yml]
    GH[github: owner/repo<br>+ optional ref, path, only/except]
    URI[uri: git+https://...]
    PATH[path: ./profiles]
  end

  SETUP[outfitter setup source] --> ONBOARD[Pi-native onboarding<br>writes settings + default profile]
  SETUP --> SYNCOP

  GH --> SYNCOP[outfitter sync]
  URI --> SYNCOP
  SYNCOP --> CACHE[(Local cache<br>~/.outfitter/cache/)]
  SYNCOP --> STATUS[Per-source status:<br>updated / unchanged / skipped / failed]
  CACHE --> VALIDATE[Validate + filter profiles]
  PATH -->|read live, no cache| LAYERS
  VALIDATE --> LAYERS[Profile layer stack]
  LAYERS --> RUN[outfitter run]
```
