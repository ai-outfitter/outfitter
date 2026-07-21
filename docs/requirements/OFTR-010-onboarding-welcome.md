# OFTR-010: First-Run Onboarding

> **Amended (RFC [#165](https://github.com/ai-outfitter/outfitter/issues/165), 2026-07-20):**
> restore the exact pre-Dotagents Pi-native setup wording, screens, and ordering. Translate only the
> persisted model to `.agents`, and append one default CLI-agent selector with Pi/Outfitter selected.

## OFTR-010.1: Entry and isolation

1. `outfitter setup [source]` MUST launch bundled Pi with a generated extension that registers and
   opens `/outfitter`.
2. A plain interactive run without an agent/default MUST invoke the same walkthrough, re-resolve,
   and continue with the selected profile.
3. Non-interactive invocations MUST NOT prompt or mutate settings.
4. Setup Pi MUST be isolated, model-free, and offline; it MUST NOT open `/login` or send an agent turn.
5. After a successful walkthrough, explicit `outfitter setup` MUST also re-resolve and launch the
   selected profile when a concrete agent was chosen (default/create modes), so the user lands in a
   working pi session without a manual restart. Catalog/source setups, whose profile needs a sync
   first, MUST instead report next-launch behavior.

## OFTR-010.5: Runtime sign-in

1. Interactive real (non-setup) Pi launches MUST load an Outfitter runtime extension that, when Pi
   starts with no models available, offers to connect a model provider and, on confirmation, opens
   Pi's native `/login`. The prompt MUST replace Pi's raw "No models available" warning as the
   primary path.
2. The runtime extension MUST be a no-op when a model is already available and MUST NOT prompt on
   non-interactive Pi launches (`--print`, `--export`, `--mode json|print|rpc`).
3. Outfitter MUST NOT collect or store provider credentials itself; credential entry stays inside
   Pi's `/login`.
4. Provider credentials entered during a run MUST persist across runs even though Pi's
   `PI_CODING_AGENT_DIR` is an ephemeral projection root: Outfitter seeds the run from Pi's durable
   agent directory (`~/.pi/agent`) and writes credential state back after the session. So after a
   first-run setup → relaunch → `/login`, later launches start with an active model and do not
   re-prompt.

## OFTR-010.2: Exact walkthrough

1. The first prompt MUST be `How would you like to set up Outfitter?` with, in order:
   `Use the default Outfitter profile catalog`, `Create your own profile`, and
   `Provide a different catalog to import`.
2. Default-catalog setup MUST show the original described profile picker. Founder MUST be the first,
   preselected `Recommended` row unless an existing default is marked `current`.
3. Create setup MUST ask `Profile id`, then `Profile label`, then the install target. It MUST preserve
   an existing profile file.
4. Different-catalog setup MUST ask the original GitHub repository, ref, and settings-path questions,
   preserve private-catalog confirmation, then ask the install target.
5. A provided `[source]` MUST bypass the setup-mode prompt and begin at target selection.
6. Home/project target wording and the `selectDescribedOption` keyboard, cancellation, description,
   recommendation, and narrow-width behavior MUST match the original flow, with `.agents` paths.
7. Exactly one new screen MUST follow the original branch: choose the default CLI agent.
   Pi/Outfitter MUST be first, recommended, and preselected.

## OFTR-010.3: Handoff and writes

1. The extension MUST write only a temporary handoff; the CLI validates and applies it.
2. Home/project settings MUST be `~/.agents/settings.yml` and `<project>/.agents/settings.yml`.
3. The profile choice maps to `default_agent`; the added CLI choice maps to `default_harness`.
4. Custom profiles map to `agents/<id>/agent.md`. The default catalog MUST map to
   `github: ai-outfitter/default-profiles` at the immutable Release Please version tag shipped by
   Outfitter.
5. Existing resource files and unrelated settings MUST be preserved.
6. Writes MUST be atomic; cancellation writes nothing; failures roll back only this attempt's changes.
7. Setup MUST fetch that exact default-catalog revision into the normal remote-source cache or reuse
   an exact cached checkout. It MUST NOT discover a sibling checkout or ship a fallback catalog.
8. If the pinned revision is unavailable and uncached, setup MUST fail before changing settings.

## OFTR-010.4: Verification

1. Tests MUST assert the exact first prompt/options, every original branch, the one added CLI screen,
   current/recommended ordering, cancellation, private/provided catalogs, and narrow widths.
2. Explicit and implicit entry points MUST use the same implementation.
3. A packaged smoke test MUST prove the installed package bootstraps the pinned canonical catalog,
   selects Founder, and creates valid `.agents` settings without a monorepo sibling checkout.
