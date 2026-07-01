# Local Inference Profile Overrides

Use local-inference overrides when the same Outfitter setup needs a fast private default for routine work and a cloud profile for higher-capability tasks. The profile switch should change only the Pi launch controls that matter: provider, model, thinking level, and the Pi extensions or skills that represent tool differences.

The provider and model IDs below are examples. Exact provider and model names MUST match the providers and models installed, registered, and accepted by the user's Pi environment.

## Home settings

Point Outfitter at the user's profile directory and choose the local profile as the default for everyday runs.

```yaml
# ~/.outfitter/settings.yml
default_agent: pi
default_profile: local
profile_sources:
  - path: ./profiles
```

## Local profile

The local profile keeps inference on the user's machine through Pi's `ollama` provider and `qwen` model. Current Outfitter profiles do not have a first-class `tools:` control; express tool differences through Pi extensions, Pi skills, native Pi settings or resources, and pass-through `args` only when Pi exposes a native flag that Outfitter does not model yet.

```yaml
# ~/.outfitter/profiles/local.yml
id: local
label: Local Inference
description: Private local Pi defaults for routine coding and drafting.
controls:
  provider: ollama
  model: qwen
  extensions:
    - ~/.outfitter/extensions/local-filesystem
  skills:
    - ~/.outfitter/skills/local-codebase
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
```

## Cloud profile

The cloud profile switches to the `chatgpt` provider, model `5.5`, and `xhigh` thinking for deeper work. It can also use a different set of Pi extensions and skills when cloud runs should expose different review, retrieval, or workflow affordances.

```yaml
# ~/.outfitter/profiles/cloud.yml
id: cloud
label: Cloud Inference
description: Higher-capability Pi defaults for complex planning, reviews, and implementation.
controls:
  provider: chatgpt
  model: '5.5'
  thinking: xhigh
  extensions:
    - ~/.outfitter/extensions/team-review
    - ~/.outfitter/extensions/project-docs
  skills:
    - ~/.outfitter/skills/deep-review
    - ~/.outfitter/skills/release-planning
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
--extension ~/.outfitter/extensions/team-review
--extension ~/.outfitter/extensions/project-docs
--skill ~/.outfitter/skills/deep-review
--skill ~/.outfitter/skills/release-planning
```

## Operational pattern

Use `local` for low-latency private work, quick repository navigation, and tasks that do not require a cloud model. Use `cloud` when the task benefits from stronger reasoning, broader context synthesis, or organization-provided skills and extensions.

Keep the profiles small and explicit. If Pi adds a native flag that Outfitter has not modeled, place it in `controls.args`; otherwise prefer modeled controls such as `provider`, `model`, `thinking`, `extensions`, and `skills` so profile behavior remains readable and portable.
