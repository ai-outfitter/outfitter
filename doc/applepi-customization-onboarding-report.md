# ApplePi Customization and Onboarding Report

## Purpose

This report outlines practical options for productizing ApplePi-managed customization of the underlying `pi` CLI. It focuses on four related areas:

1. branded or opinionated themes;
2. a welcome/onboarding surface when a profile starts;
3. agentic subagents; and
4. onboarding flows for creating and selecting ApplePi profiles.

The key design point is that ApplePi is a wrapper/control plane, not an in-process `pi` extension. ApplePi can assemble profiles, write/symlink configuration, set environment variables, and pass native `pi` arguments before launch. Runtime UI changes inside the `pi` TUI require a `pi` extension. Reusable task guidance that the model can invoke should be a skill or prompt template.

## Boundary Summary

| Capability                                              | Best Mechanism                                                  | Why                                                                                  |
| ------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Theme colors and terminal presentation                  | Theme file plus profile settings/args                           | Native `pi` themes are data files and can be distributed by ApplePi profiles.        |
| Welcome screen, footer, status, terminal title, widgets | `pi` extension injected by ApplePi                              | These need runtime access to `ctx.ui` APIs inside `pi`.                              |
| Standard operating behavior and onboarding instructions | System prompt, appended system prompt, skills, prompt templates | These are model-facing instructions, not UI code.                                    |
| Subagent orchestration                                  | `pi-subagents` extension/package plus ApplePi-managed settings  | `pi` has no built-in subagents; the package provides the runtime tool and workflows. |
| Profile creation/onboarding                             | ApplePi CLI/wizard plus docs/prompts                            | Profile setup is ApplePi's responsibility before the agent starts.                   |

## Theme and Branding

### Unsupervised theme

If “Unsupervised” is the desired product/brand theme, it should be represented first as a native `pi` theme file plus ApplePi profile settings. This covers the low-risk branding layer: colors, borders, message backgrounds, markdown styling, syntax colors, and tool result styling. Anything beyond theme tokens, such as a welcome panel or branded footer, belongs in a runtime extension.

### Current viable path

ApplePi can distribute a native `pi` theme by placing the selected theme and settings in a profile. Example profile layout:

```text
profiles/branded-engineering/
  profile.yml
  cli_specific/pi/settings.json
  themes/company-dark.json
```

Example `profile.yml`:

```yaml
id: branded-engineering
label: Branded Engineering

controls:
  pi:
    args:
      - --theme
      - ./themes/company-dark.json
```

Example `cli_specific/pi/settings.json` if choosing by theme name:

```json
{
  "theme": "company-dark"
}
```

This can cover color tokens, status colors, markdown colors, tool result styling, and the overall visual identity that native `pi` exposes through themes.

### Product recommendation

Add first-class ApplePi profile controls for theme selection instead of requiring raw `pi.args`:

```yaml
controls:
  theme: ./themes/company-dark.json
  pi:
    no_themes: false
```

Adapter translation would map this to `--theme`/`--no-themes` for `pi`. Until then, use `controls.pi.args` and/or `cli_specific/pi/settings.json`.

## Welcome Screen and Runtime Branding

A welcome screen is not just a static config file if it needs to appear inside the active `pi` TUI. It should be implemented as a `pi` extension and injected by ApplePi.

Possible extension behavior:

- set terminal title, for example `Acme Agent · Engineering`;
- show a branded widget above or below the editor;
- set a custom footer or status entry with profile, team, environment, or policy state;
- display a one-time welcome notice with next actions;
- set a custom working message/spinner;
- expose slash commands such as `/profile-info`, `/onboarding`, or `/standards`.

Example ApplePi profile:

```yaml
id: branded-engineering
controls:
  extensions:
    - ./extensions/applepi-welcome
  append_system_prompt: ./prompts/profile-policy.md
  pi:
    args:
      - --theme
      - ./themes/company-dark.json
```

This keeps the split clean:

- ApplePi selects and injects the extension.
- The extension owns runtime UI.
- Prompts/skills own model-facing behavior.

## Agentic Subagents

The cleanest near-term path is to piggyback on [`pi-subagents`](https://pi.dev/packages/pi-subagents) as a managed package in an ApplePi profile.

Example `cli_specific/pi/settings.json`:

```json
{
  "packages": ["npm:pi-subagents@0.28.0"],
  "subagents": {
    "agentOverrides": {
      "scout": {
        "model": "anthropic/claude-haiku-4-5",
        "tools": ["read", "grep", "find", "ls"]
      },
      "reviewer": {
        "model": "anthropic/claude-sonnet-4",
        "thinking": "high",
        "inheritProjectContext": true,
        "tools": ["read", "grep", "find", "ls", "bash"]
      },
      "worker": {
        "model": "anthropic/claude-sonnet-4",
        "thinking": "medium",
        "inheritProjectContext": true
      }
    }
  }
}
```

Model-facing guidance should live in an appended system prompt or skill:

```md
For non-trivial implementation work:

1. ask scout to gather context when the code path is unclear;
2. ask planner or oracle before broad edits;
3. use worker only after the plan is clear;
4. run reviewer before summarizing completion;
5. address actionable reviewer findings or explain why they were declined.
```

### Current limitation

Stock `pi-subagents` spawns child `pi` processes. Those children inherit the parent process environment, including the ApplePi-generated `PI_CODING_AGENT_DIR`, so they share the parent ApplePi profile boundary.

That means this works today:

```text
ApplePi profile -> pi with pi-subagents -> child pi processes under the same profile boundary
```

This is not first-class yet:

```text
reviewer subagent -> ApplePi reviewer profile
worker subagent -> ApplePi worker profile
scout subagent -> ApplePi scout profile
```

To reach that model, ApplePi would need either:

1. a small compatibility extension/wrapper that launches `applepi run -p <profile>` for selected children; or
2. upstream support/configuration in `pi-subagents` for profile-aware child launch commands.

## Skills vs Extensions vs Prompt Templates

Use the right artifact type for the job:

### Extensions

Use an extension when code must run inside `pi` or expose a tool/UI integration.

Examples:

- welcome screen;
- footer/status/widget branding;
- custom tool registration;
- `pi-subagents`;
- intercom/coordination behavior;
- custom autocomplete or slash command behavior that needs code.

### Skills

Use a skill when the agent needs reusable task instructions or a workflow playbook.

Examples:

- “how to use subagents in this organization”;
- “how to create a new ApplePi profile”;
- “review checklist for regulated repos”;
- “release hygiene workflow”;
- “incident-response workflow”.

### Prompt templates

Use a prompt template when the user needs a repeatable command-like prompt expansion.

Examples:

- `/create-applepi-profile engineering-default`;
- `/parallel-review`;
- `/onboard-project`;
- `/setup-subagents`.

## Profile Creation and Onboarding

ApplePi already owns setup/profile selection outside the agent runtime. The next product step is to make profile creation approachable for teams.

Recommended onboarding layers:

1. **CLI wizard**: extend `applepi profile create` or add a guided flow that asks for team, model, provider, theme, extensions, skills, and subagent policy.
2. **Generated scaffold**: create a profile folder with `profile.yml`, `prompts/`, `skills/`, `themes/`, and `cli_specific/pi/settings.json`.
3. **Onboarding skill**: provide a skill that explains how to choose, create, and modify profiles.
4. **Welcome extension**: show selected profile, active agent, loaded theme, subagent policy, and next commands on startup.
5. **Validation/inspection command**: add an `applepi profile inspect` view to show the resolved profile, selected adapter, generated flags, and native state paths.

Example scaffold:

```text
profiles/team-engineering/
  profile.yml
  prompts/
    policy.md
    onboarding.md
  skills/
    applepi-profile-onboarding/SKILL.md
    subagent-operating-model/SKILL.md
  themes/
    team-dark.json
  extensions/
    applepi-welcome/
      package.json
      src/index.ts
  cli_specific/
    pi/
      settings.json
```

## Proposed Roadmap

### Phase 1: Configuration-only piggybacking

- Document how to install and pin `npm:pi-subagents` in profile-owned `settings.json`.
- Provide example `agentOverrides` for scout/planner/worker/reviewer/oracle.
- Provide branded theme examples.
- Provide onboarding and subagent skills.
- Use `controls.pi.args` for `--theme` until first-class theme controls exist.

### Phase 2: First-class ApplePi profile affordances

- Add `theme` / `no_themes` controls to the profile schema and pi adapter.
- Add pi state declarations for profile-owned `agents/`, `chains/`, and `extensions/subagent/config.json` if we want ApplePi to distribute subagent definitions and config directly.
- Add `applepi profile inspect` for onboarding/debugging.
- Add profile scaffold templates.

### Phase 3: Runtime branding extension

- Build `applepi-welcome` as an optional pi extension.
- Show active ApplePi profile metadata from `applepi/profile.json` in the composite profile.
- Render welcome/status/footer content inside `pi`.
- Optionally expose `/applepi-profile` and `/applepi-onboarding` commands.

### Phase 4: Profile-aware subagents

- Build a bridge extension or collaborate upstream with `pi-subagents` so child launches can map agents to ApplePi profiles.
- Example target configuration:

```yaml
controls:
  subagents:
    scout:
      profile: scout-readonly
    reviewer:
      profile: reviewer-strict
    worker:
      profile: worker-implementation
```

- Translate those mappings into a launch strategy that preserves child session reporting and `pi-subagents` UX.

## Recommended Near-Term Deliverable

Ship an example profile package containing:

1. a branded theme;
2. an appended onboarding/system prompt;
3. a `pi-subagents` settings block with opinionated overrides;
4. a subagent operating-model skill;
5. a profile onboarding skill;
6. documentation for when to use an extension versus a skill.

This gives users visible customization and agentic behavior now while keeping the architecture compatible with deeper ApplePi-native controls later.
