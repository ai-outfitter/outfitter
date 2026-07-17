# Composing profiles

A profile is a named **selection** of protocol resources: which personas, skills, subagents, and knowledge a run should compose, referenced by slug. A profile is not a file format — there is no `profile.yml`, and profiles never copy resource content. The resources themselves live in [`.agents` trees](./concepts.md#the-agents-protocol); the profile just picks from them.

Profiles, [personas](./personas.md), and [subagents](./subagents.md) are distinct: the profile is the selection, personas are the identity the selection composes, and subagents are the delegates it exposes.

## Declaring profiles

Profiles are declared in [settings](./settings.md), or implicitly by a [task](./tasks.md) that makes its own selection:

```yaml
# .agents/settings.yml
default_profile: engineer

profiles:
  engineer:
    personas: [engineer]
    skills: [wiki, research]
    subagents: [code-reviewer]
    knowledge: [architecture]

  reviewer:
    personas: [engineer, staff-reviewer] # ordered persona composition
    skills: [deployment-review]
```

Every slug is resolved across the configured layers — workspace `.agents/`, global `~/.agents/`, and remote sources — following [layer precedence](./concepts.md#layer-precedence) and the protocol's merge-by-ID semantics. If your `.agents/` tree already contains `agents/engineer/` and `skills/wiki/`, you can reference them immediately; nothing needs to be ported or re-authored.

```bash
outfitter run --profile reviewer
outfitter run --profile reviewer --agent claude
```

`outfitter list profiles` shows the declared profiles and where each selected resource resolves from, including shadowed IDs.

## Selection semantics

- **`personas`** — ordered list of agent slugs composed as the run's identity. Order matters: later personas layer over earlier ones. See [Personas](./personas.md).
- **`skills`** — skill slugs made available to the run, loaded progressively. See [Skills](./skills.md).
- **`subagents`** — agent slugs projected as harness subagents the run can delegate to. See [Subagents](./subagents.md).
- **`knowledge`** — knowledge documents exposed to the run.

A slug that resolves nowhere fails validation (`outfitter validate`) rather than silently launching a thinner run.

## Profiles and tasks

A [task](./tasks.md) carries its own selection — the same fields a named profile has — plus an objective, inputs, and a completion contract. Use named profiles for interactive work ("run as the reviewer") and tasks for repeatable, bakeable work ("triage this issue"). Both go through the same resolver.

## Migrating from authored profiles

Earlier Outfitter versions defined profiles as authored YAML files (`.outfitter/profiles/`, `profile.yml`, inheritance, `controls`). That system is removed with no compatibility mode. See the [migration reference](./migration.md) for the manual mapping from the legacy format to `.agents` resources and profile selections.
