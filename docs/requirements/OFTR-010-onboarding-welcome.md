# OFTR-010: First-Run Onboarding

> **Amended (RFC [#165](https://github.com/ai-outfitter/outfitter/issues/165), 2026-07-17):** onboarding
> pivoted from the profile-era **Pi-native `/outfitter`** flow to a harness-neutral **interactive
> terminal** flow on the `.agents` model. Onboarding now writes `default_agent`/`default_harness`
> into `~/.agents/settings.yml` and a starter agent, from a terminal questionnaire, before any
> harness starts. The private-catalog/enterprise and Pi-login prompts previously in this requirement
> belong to remote-source **sync** and remain deferred (see [OFTR-004](OFTR-004-sync-and-setup.md)).

## Overview

The first time someone runs Outfitter with nothing configured, onboarding gets them to a working
agent without hand-authoring files. It is harness-neutral (it does not assume pi or Claude Code),
runs a short terminal questionnaire, writes a minimal `.agents` config, and then continues.

## Requirements

### OFTR-010.1: Implicit Onboarding Entry

1. When `outfitter run` is invoked with no agent argument and settings define no `default_agent`,
   Outfitter MUST run onboarding once before failing with a "no agent selected" error.
2. Onboarding MUST run only in an interactive terminal (stdin and stdout are TTYs). Non-interactive
   invocations MUST NOT prompt, MUST NOT mutate settings, and MUST fall back to the normal
   "no agent selected" error.
3. After onboarding writes configuration, `run` MUST re-resolve settings and the effective resource
   set and continue with the newly written `default_agent`.

### OFTR-010.2: Onboarding Questionnaire

1. Onboarding MUST prompt for the default harness, offering at least `pi` and `claude`, defaulting
   to `pi`.
2. Onboarding MUST prompt for a starter agent name, defaulting to `assistant`.
3. Onboarding MUST coerce the entered agent name into a valid directory slug (lowercase; runs of
   non-`[a-z0-9-]` characters collapsed to `-`; leading/trailing `-` trimmed) and MUST fall back to
   `assistant` when no valid slug remains, so the written agent's `name` matches its directory.
4. Any prompt the user answers with an empty response MUST take that prompt's default.

### OFTR-010.3: Onboarding Writes

1. Onboarding MUST write `~/.agents/settings.yml` with the selected `default_agent` and
   `default_harness`.
2. Onboarding MUST write a starter agent at `~/.agents/agents/<slug>/agent.md` whose frontmatter
   `name` equals `<slug>` so the agent composes and runs.
3. Onboarding MUST NOT overwrite an existing `~/.agents/settings.yml`; when one is present it MUST
   report that Outfitter is already configured and write nothing.

### OFTR-010.4: Explicit Setup Command

1. Outfitter MUST provide an `outfitter setup` command that runs the same onboarding as the implicit
   `run` entry (one shared implementation).
2. `outfitter setup` MUST report the paths it created (or that configuration already existed).
