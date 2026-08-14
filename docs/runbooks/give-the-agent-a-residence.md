# Give the agent a residence

**You are here:** agents run from events, and their work lands through review. But each run starts cold and ends forgotten. You cannot assign an issue to an agent, because there is no account to assign it to.

**This runbook gets you to:** an agent with a name, an account, and a place to live — one you assign work to and that answers, working from the same pinned catalog as everyone else. That is rung 4 of [the adoption ramp](../philosophy.md#the-ramp-to-an-autonomous-lifecycle) — governed.

**Prerequisites:** [Share one catalog](./share-one-catalog.md) and [Run it without your laptop](./run-without-your-laptop.md). A resident agent resolves its profile from the catalog at a pin, and it must land changes through the same gate a triggered agent does. Residency does not relax either.

## 1. Decide what the agent is

A resident agent is a teammate, not a service. Name it, write its profile into the catalog, and cap what it may do — the profile is where you say it opens pull requests but does not merge them.

Be honest about capability. An agent whose runtime cannot reach the forge cannot review; one with no write path cannot open a pull request. A profile that promises more than the deployment can do produces an agent that wakes, cannot act, and looks broken.

## 2. Create its account

The agent needs a real forge account, because an App cannot be assigned an issue.

Give it its own account per organization where you can. A machine account that belongs to several organizations holds a token that can see all of them, so the account's membership list — not the token's scope — becomes the boundary.

Do not put a handle into a manifest or a profile before the account exists. A runbook naming an account that returns 404 reads as finished when it is not.

## 3. Give it two tokens

Not one. The wake path and the work path have different requirements, and collapsing them gives the agent the broadest credential in the system for everything it does.

| Variable              | Kind         | Scope                                       |
| --------------------- | ------------ | ------------------------------------------- |
| `GITHUB_NOTIFY_TOKEN` | classic      | `notifications` only                        |
| `GITHUB_TOKEN`        | fine-grained | one organization, the repositories it works |

The classic token is forced: `GET /notifications` rejects fine-grained tokens and App installation tokens alike. It is the one place the ranking bends, and it bends only here. The scope discipline is what keeps it contained — a classic token minted with `repo` "to be safe" becomes a cross-organization write credential, silently.

The fine-grained work token has exactly one resource owner as a property of the credential, so the agent cannot reach another organization even if its account belongs to one. [The credential model](../architecture/forge-credential-model.md) sets out the full reasoning, including when a read-only deploy key earns its place.

## 4. Deploy it

[`ai-outfitter/agent-operator`](https://github.com/ai-outfitter/agent-operator) runs resident agents on Kubernetes: an `Organization` names the catalog and its pin, an `Agent` names the profile and the credentials it projects. [In-cluster agents](../documentation/in-cluster.md) covers the primitives.

Commit those manifests at `agents/<id>/deployment.yaml`, beside the agent's profile, one directory per agent. The next runbook deploys by globbing exactly that path — so putting them there now makes continuous deployment a workflow you point at a tree you already have, instead of a migration you perform first. A directory may hold a `deployment.yaml` and no `agent.md`, which is how you deploy an agent whose profile a different catalog defines.

Two things to get right, because both fail quietly:

- **Pin the catalog to a full commit SHA**, and move every copy of that revision together. A revision that differs between the organization pin and anything that reads it produces an agent resolving a catalog nobody meant to ship.
- **Keep credential material out of the workspace volume.** It outlives the Secret, survives restarts, and is readable by anything that later mounts the volume. Mount a credential for the operation that needs it.

A private catalog needs a credential the operator does not currently model — see [the private-catalog runbook](https://github.com/ai-outfitter/agent-operator/blob/main/docs/runbooks/private-catalog-resident-agent.md).

## 5. Prove the loop, once

Open a real issue. Assign it to the agent. Watch what happens, and write down what actually happened rather than what you designed.

`Ready` means the workload runs. It does not mean the notification channel is configured, the wake arrives, or the agent can act on what it reads. Those are separate facts, and each needs its own check.

## Done when

Run an organization SDLC assessment:

- `bot-identity` — agent actions carry a capped identity rather than a human's.
- `strict-governance` — the catalog's governance policy names the agents you actually run.

A governance file capping an agent that does not exist, while the agents you run go unmentioned, satisfies neither. Check that the names match reality.

## Your first step on the next rung

You now have transcripts, an audit record, and an agent that runs the same loop repeatedly. That is the raw material for evaluation.

Take one loop the agent ran and score it: did it produce what the acceptance criteria asked for? Write the result down next to the transcript. A handful of scored runs is the beginning of an eval set, and an eval set is what turns "the agent seems fine" into evidence — the start of rung 5, where the record feeds improvement and humans keep only the goal and the gate.
