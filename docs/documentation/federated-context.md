# Federated context

Large organizations hit the same wall: fifty legacy codebases, a dozen teams, and one agent context window. Copying every rule file into every repository drifts immediately; concatenating everything into one giant prompt bloats every session with context that mostly does not apply.

The federated context pattern answers this with two moves:

1. **One governed prompts library** — a catalog repository holds small, atomic markdown files, one concern per file: what an agent must know about a codebase, how a team works, what tools are approved, which models to use when.
2. **Thin profiles that compose subsets** — each role profile selects only the prompt files that role needs via `append_system_prompt` file includes. A migration profile pulls two codebase files, one team file, and the tool policy; an analytics profile pulls a different subset. No session carries the whole organization.

The Outfitter repository ships a runnable example in [`examples/federated-context`](../../examples/federated-context/README.md) with three fictional codebases, two teams, a tool policy, and a model policy composed by two profiles.

## Structure

```text
federated-context/
  .outfitter/
    settings.yml                  # profile_sources: - path: ./profiles
    profiles/
      java-modernization.yml
      inventory-forecasting.yml
  prompts/
    codebases/                    # one file per codebase
    teams/                        # one file per team's working agreements
    tools/                        # tool and permission policies
    models/                       # model selection guidance
```

Keep each prompt file atomic and small — one codebase, one team, one policy per file. Atomic files are the unit of reuse, review, and ownership; a file that covers two concerns can no longer be included, owned, or updated independently.

## Composition mechanics

A profile composes prompt files with typed includes in `append_system_prompt`:

```yaml
# .outfitter/profiles/java-modernization.yml
id: java-modernization
label: Java Modernization (payments)
controls:
  append_system_prompt:
    - |
      You are working on the billing-java to checkout-node migration.
    - file: prompts/codebases/billing-java.md
    - file: prompts/codebases/checkout-node.md
    - file: prompts/teams/payments.md
    - file: prompts/tools/approved-toolchain.md
```

Two include types matter here, and they resolve differently (see [Profiles](./profiles.md#append-prompt-file-includes) for the full rules):

- **`{ file: ... }`** resolves from the source root of the profile layer that declares it — for a catalog using the `.outfitter/` convention, that is the catalog root, which is what makes the shared `prompts/` library addressable from every profile. Use `file:` for everything the governance team owns.
- **`{ repo_file: ... }`** resolves from the project directory where the agent launches. Use it when a reusable profile should pull project-local context — `repo_file: docs/architecture.md` reads the architecture doc of whatever repository the agent is running in, without copying it into the catalog.

Because `append_system_prompt` composes instead of replacing, project profiles can inherit a catalog profile and add repository-specific context on top. Run `outfitter profile lint --strict` after editing; it fails on schema errors, broken inheritance, and missing include files.

## Governance and ownership

The pattern's value comes from treating the prompts library as governed infrastructure, not a scratchpad:

- **A clear owner per file.** The prompts library lives in the organization's catalog repository (or a dedicated prompts repository consumed as a second source). Use the host's native review controls — `CODEOWNERS` mapping `prompts/teams/payments.md` to the payments leads, branch protection on the catalog, releases tagged so consumers see reviewed states.
- **Changes by pull request.** Prompt changes are proposed by PR and reviewed by the owning team; a team's context file is its public interface to every agent in the organization.
- **Consumers pin refs.** Teams consuming the catalog pin a `ref:` (tag or commit) in `profile_sources` and bump it deliberately after reviewing the diff — updates to shared context become explicit, reviewable actions. See [Profile repositories](./profile-repository.md#trust-and-review).
- **Profiles stay thin.** Role knowledge belongs in the prompts library where it can be shared and reviewed; profiles should mostly be a list of includes plus a few lines of role framing.

## Honest limits

- **Authoring is real work.** Good codebase and team files require someone who knows the system to write down what actually matters. Agents can draft these files from a repository, but a human who owns the code must review and correct them — an unreviewed generated context file automates the spreading of wrong information.
- **Files go stale.** A prompts library needs the same hygiene as documentation: owners, periodic review, and deletion of dead guidance. Pinned refs protect consumers from churn but also delay fixes until they bump.
- **Composition is manual by design.** Profiles select includes statically; Outfitter does not decide at runtime which context a task needs. That determinism is the point — the same profile always produces the same composite prompt — but it means someone maintains the mapping from roles to files.
- **Context still costs tokens.** The pattern keeps each session's context relevant, not free. If a profile accretes includes until it approximates the whole library, you have rebuilt the bloated prompt with extra steps; prune subsets as deliberately as you add them.
