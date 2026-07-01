# Profiles

Profiles define the accoutrements that shape an Outfitter-managed agent launch.

A profile can compose:

- context and prompts
- model and provider settings
- Pi extensions
- skills
- subagents
- DeepWork workflows
- agent-specific CLI flags and environment variables

Profiles can be local to a user or project, inherited from other profiles, or loaded from a shared profile repository. See [Profile repositories](./profile-repository.md) for shared setup sources.

## Profile layouts

Outfitter supports two profile layouts inside any configured `profile_sources` directory.

### Flat profile layout

Use the flat layout for small profile catalogs where each profile is mostly YAML and does not need its own resource folder. Each `*.yml` or `*.yaml` file directly under the profile source is a profile. If the file omits `id`, Outfitter uses the filename stem as the profile id.

```text
~/.outfitter/profiles/
  founder.yml
  engineer.yml
  data-analyst.yaml
```

```yaml
# ~/.outfitter/profiles/founder.yml
label: Founder
description: Founder-operator defaults for product, engineering, research, and prose.
controls:
  append_system_prompt: |
    Think like a founder-operator: connect product judgment, implementation, and evidence.
```

Flat profiles are easy to scan, diff, and copy between setup repositories. Generated Pi prompt exports for flat profiles are written beside the flat file as `<profile-id>.generated-system-prompt.md` when `profile_export` is enabled.

### Directory profile layout

The original layout is one folder per profile with a required `profile.yml`. Use it when a profile owns prompts, skills, extensions, DeepWork jobs, or CLI-specific files that should travel with that profile.

```text
~/.outfitter/profiles/
  home-default/
    profile.yml
    prompts/
      system.md
    skills/
    extensions/
    deepwork/
      jobs/
    cli_specific/
      pi/
```

```yaml
# ~/.outfitter/profiles/home-default/profile.yml
id: home-default
label: Home Default
controls:
  system_prompt: ./prompts/system.md
  skills:
    - ./skills/review
```

Directory profiles keep bundled resources close to the profile that references them. Generated Pi prompt exports for directory profiles are written as `generated-system-prompt.md` inside the profile directory when `profile_export` is enabled.

## Home and project example

A home profile SHOULD hold reusable defaults for one developer.
A project profile SHOULD live with the repository and add only the behavior that project needs.
The comments below name the files; each `---` starts a separate YAML document in the same example block.

```yaml
# ~/.outfitter/settings.yml
default_profile: home-default
default_agent: pi
profile_sources:
  - path: ./profiles

---
# ~/.outfitter/profiles/home-default.yml
id: home-default
label: Home Default
description: Reusable personal defaults for Outfitter-managed Pi runs.
controls:
  provider: openai-codex
  model: gpt-5.5
  thinking: high
  append_system_prompt:
    - |
      Use concise, evidence-backed engineering prose.
      Prefer small, reviewable changes.
      Keep durable decisions in repo files.
    - file: prompts/personal-policy.md
    - repo_file: docs/mission.md

---
# ~/repos/acme/example/.outfitter/settings.yml
default_profile: acme-example
profile_export: true
profile_sources:
  # Relative to this settings.yml; exposes ~/.outfitter/profiles to the project.
  - path: ../../../../.outfitter/profiles
    only:
      - home-default
  - path: ./profiles

---
# ~/repos/acme/example/.outfitter/profiles/acme-example/profile.yml
id: acme-example
label: Acme Example
description: Checked-in project profile for ~/repos/acme/example.
inherits:
  - home-default
controls:
  thinking: xhigh
  append_system_prompt:
    - |
      You are working in ~/repos/acme/example.
      Honor the project test contract before calling work complete.
      Prefer repository-local conventions over personal defaults.
    - file: .outfitter/prompts/review-policy.md
  environment:
    ACME_PROJECT: example
```

`home-default` is the home-folder profile: it supplies personal defaults that can work across repositories.
`acme-example` is the project profile: it inherits those defaults, then overrides the thinking level and adds project-specific prompt and environment settings.
When a project `settings.yml` declares `profile_sources`, it SHOULD include any home profile source that project profiles inherit from.
Because `append_system_prompt` composes instead of replacing, the higher-precedence project prompt is passed first and the inherited home prompt follows.
Typed prompt includes read `{ file: string }` entries before launch and pass the file contents as repeated append-prompt text. Raw strings remain literal prompt text; if a raw string looks like a whole file path, Outfitter warns so the profile can be migrated to `{ file: ... }`.

### Append prompt file includes

`append_system_prompt` accepts a literal string, a multiline string, `{ file: string }`, `{ repo_file: string }`, or an ordered list mixing those entry types. Outfitter does not support `{ text: ... }`; use raw YAML strings for inline prompt text, `{ file: ... }` for maintained profile/catalog files, and `{ repo_file: ... }` for files that should come from the active project.

Profile-owned file includes resolve from the source root of the profile layer that declares the entry, including inherited layers:

| Declaring profile location                                                         | Include root               |
| ---------------------------------------------------------------------------------- | -------------------------- |
| `~/.outfitter/profiles/<id>/profile.yml` or `~/.outfitter/profiles/<id>.yml`       | `~/.outfitter`             |
| `<project>/.outfitter/profiles/<id>/profile.yml`                                   | `<project>`                |
| Catalog repo `outfitter/profiles/<id>/profile.yml`                                 | Catalog repository root    |
| Explicit `profile_sources[].path` without `.outfitter/` or `outfitter/` convention | The configured source path |

`repo_file:` resolves from the active project directory where Outfitter launches the agent. This lets a reusable catalog or home profile request project-local governance context such as `docs/mission.md` without copying those docs into the catalog.

Run `outfitter profile lint` to report schema and inheritance errors, missing typed include files, and raw string append-prompt entries that look like file paths. Add `--strict` to exit non-zero for warnings, and `--json` for machine-readable diagnostics.

With `profile_export: true`, the selected project directory profile can write `generated-system-prompt.md` beside `profile.yml`.
For this example, the generated prompt fallback would show the composed prompt inputs like this:

```text
<!-- Generated by Outfitter from Pi runtime ctx.getSystemPrompt(). Safe to review or git-ignore. Do not edit by hand. -->
# Generated Pi runtime system prompt

You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.

Available tools:
- read: Read file contents
- bash: Execute bash commands (ls, grep, find, etc.)
- edit: Make precise file edits with exact text replacement, including multiple disjoint edits in one call

....

## append_system_prompt[0]

You are working in ~/repos/acme/example.
Honor the project test contract before calling work complete.
Prefer repository-local conventions over personal defaults.

## append_system_prompt[1]

Use concise, evidence-backed engineering prose.
Prefer small, reviewable changes.
Keep durable decisions in repo files.
```
