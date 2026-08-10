# Share one catalog

**You are here:** every engineer configures their own agent. Prompts, skills, and MCP servers differ per laptop, so two people asking the same question get different answers, and an improvement one person makes stays on their machine.

**This runbook gets you to:** one catalog the organization shares, pinned to a revision, consumed by the repositories that matter. That is rung 2 of [the adoption ramp](../philosophy.md#the-ramp-to-an-autonomous-lifecycle) — delegated.

Do this one first. The two runbooks above it both assume a catalog exists: an agent triggered in CI resolves its profile from one, and a resident agent cannot start without one.

## Before you start

You need a forge organization, write access to create one repository in it, and Outfitter installed locally. Nothing runs in CI or a cluster yet.

## 1. Create the catalog repository

The convention is a standalone `.agents` repository, or an `owner/.outfitter` control repository carrying a `.agents/` payload. [Catalogs](../documentation/catalogs.md) covers both shapes and when each fits.

Start with what people already run. A catalog assembled from the prompts and skills your team uses today beats one designed from scratch, because it inherits their judgment.

```text
acme/.agents/
  agents.md              # rules every agent inherits
  agents/
    engineer/agent.md
  settings.yml
```

[Organization Catalog](../documentation/usecases/organization-profile-catalog.md) works through a fuller example with several role agents.

## 2. Consume it, pinned

Each consumer names the catalog and the revision it trusts:

```yaml
# ~/.agents/settings.yml
sources:
  - github: acme/.agents
    ref: v0.1.0
```

Pin it. An unpinned source runs whatever the catalog publishes next, which means a change nobody reviewed reaches every consumer at once. Pinning turns a catalog update into a reviewable bump.

Tag the catalog rather than pinning a branch, so the pin reads as a decision and moving it is deliberate.

## 3. Verify

```sh
outfitter sync
outfitter run
```

Sync reports each source as `updated`, `unchanged`, `skipped`, or `failed`. A source that fails is not silently ignored — sync exits nonzero.

**Private catalog?** Private GitHub catalogs are an enterprise capability, and the credential is supplied by your environment rather than by Outfitter. See [Private repositories](../documentation/catalogs.md#private-repositories) for how sync authenticates in each context.

## Done when

Run an organization SDLC assessment. Two signals flip:

- `shared-catalog` — a catalog exists carrying validated workflows and a governance policy.
- `catalog-consumed` — repositories resolve it, at a pin.

Those are the machine-checkable definition of rung 2. If the report still shows either as unmet, it names what it could not find.

## Your first step on the next rung

Take one workflow your team already does by hand — triage, a changelog, a dependency bump — and add its instructions to the catalog as a skill. Do it manually a few times with the agent assisting.

Never automate a workflow you have not first done manually. When you understand it well enough to write its acceptance criteria, [Run it without your laptop](./run-without-your-laptop.md) gives it a trigger.
