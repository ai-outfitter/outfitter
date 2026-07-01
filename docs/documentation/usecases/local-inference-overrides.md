# Local Inference Profile Overrides

Use local-inference overrides when the same Outfitter setup needs a cloud model for general research and proof-of-concept work, then a local model for implementation inside a repository that should not grant external model access. The profile switch changes only the Pi launch controls that matter: provider, model, thinking level, and the Pi extensions or skills that represent tool differences.

The provider and model IDs below are examples. Exact provider and model names MUST match the providers and models installed, registered, and accepted by the user's Pi environment. Profiles make the launch boundary explicit; they do not replace a repository's security policy, network controls, credential handling, or review requirements.

## Story

A developer is evaluating an implementation path for a private repository. They start with a cloud profile because the early work is generic: compare libraries, sketch architecture, draft a migration plan, and build throwaway proof-of-concept snippets that do not include proprietary source. The cloud model is useful here because it has stronger general reasoning and the user is not exposing restricted repository contents.

When the work moves from research to implementation, the developer switches to the local profile before opening the restricted repository. Pi still has useful coding tools, but inference now runs through local Ollama/Qwen defaults. The repository can be read, searched, edited, and tested without routing source context to an external model provider.

## Home settings

Point Outfitter at the user's profile directory and choose the local profile as the default for everyday repository work.

```yaml
# ~/.outfitter/settings.yml
default_agent: pi
default_profile: local
profile_sources:
  - path: ./profiles
```

## Local implementation profile

The local profile keeps implementation inside the user's machine through Pi's `ollama` provider and `qwen` model. Current Outfitter profiles do not have a first-class `tools:` control; express tool differences through Pi extensions, Pi skills, native Pi settings or resources, and pass-through `args` only when Pi exposes a native flag that Outfitter does not model yet.

```yaml
# ~/.outfitter/profiles/local.yml
id: local
label: Local Implementation
description: Private local Pi defaults for restricted repository implementation.
controls:
  provider: ollama
  model: qwen
  extensions:
    - ~/.outfitter/extensions/local-filesystem
  skills:
    - ~/.outfitter/skills/local-codebase
  append_system_prompt: |
    Work inside the repository using local inference. Do not assume external
    model access is allowed for source code, logs, secrets, or proprietary data.
```

Run it with:

```bash
outfitter run --profile local
```

For this profile, current Outfitter code passes the merged controls to Pi as equivalent launch flags:

```text
--provider ollama
--model qwen
--extension ~/.outfitter/extensions/local-filesystem
--skill ~/.outfitter/skills/local-codebase
--append-system-prompt <local implementation guidance>
```

## Cloud research profile

The cloud profile switches to the `chatgpt` provider, model `5.5`, and `xhigh` thinking for general research, design exploration, and proof-of-concept work that does not require opening restricted repository contents. It can also use a different set of Pi extensions and skills when cloud runs should expose research, documentation, or review affordances instead of local implementation tools.

```yaml
# ~/.outfitter/profiles/cloud.yml
id: cloud
label: Cloud Research
description: Higher-capability Pi defaults for general research and proof-of-concept work.
controls:
  provider: chatgpt
  model: '5.5'
  thinking: xhigh
  extensions:
    - ~/.outfitter/extensions/web-research
    - ~/.outfitter/extensions/project-docs
  skills:
    - ~/.outfitter/skills/architecture-notes
    - ~/.outfitter/skills/proof-of-concept
  append_system_prompt: |
    Use this profile for general research, design tradeoffs, and disposable
    examples. Do not inspect or quote restricted repository contents unless the
    repository policy explicitly allows external model access.
```

Run it with:

```bash
outfitter run --profile cloud
```

For this profile, current Outfitter code passes the merged controls to Pi as equivalent launch flags:

```text
--provider chatgpt
--model 5.5
--thinking xhigh
--extension ~/.outfitter/extensions/web-research
--extension ~/.outfitter/extensions/project-docs
--skill ~/.outfitter/skills/architecture-notes
--skill ~/.outfitter/skills/proof-of-concept
--append-system-prompt <cloud research guidance>
```

## Operational pattern

Use `cloud` before implementation to research options, compare APIs, reason about generic architecture, and draft proof-of-concept code outside the restricted source tree. Use `local` when the task requires opening the actual repository, reading private files, running project-specific tests, or producing implementation patches.

Keep the profiles small and explicit. If Pi adds a native flag that Outfitter has not modeled, place it in `controls.args`; otherwise prefer modeled controls such as `provider`, `model`, `thinking`, `extensions`, and `skills` so profile behavior remains readable and portable.
