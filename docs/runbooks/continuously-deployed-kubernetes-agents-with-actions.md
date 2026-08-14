# Continuously deployed Kubernetes agents with Actions

**You are here:** a resident agent runs in your cluster and resolves its composition from a pinned catalog revision. Changing what the agent knows means editing the catalog, then hand-editing that revision into the manifests, then applying them. The revision appears in more than one place, nothing checks that the copies agree, and the operator does not compare them — so the common failure is an agent that reports `Ready` while running the composition you replaced.

**This runbook gets you to:** a merge to the catalog's default branch that moves the fleet to that revision on its own, with no stored cluster credential, and that fails rather than half-applying.

**Prerequisite:** [Give the agent a residence](./give-the-agent-a-residence.md). This runbook automates the revision bump you are already doing by hand; if you have not done it by hand yet, do that first. You cannot write the acceptance criteria for an automation whose manual form you have never run.

## The split that makes this safe

Continuous deployment of an agent is narrower than it sounds. Divide the work in two and never blur the line:

- **CI moves objects that already exist.** It patches an `Organization` to a new catalog revision and patches each `Agent` whose setup step pins that same revision. Nothing else.
- **An administrator bootstraps.** Namespaces, Secrets, the operator itself, the runtime image, and the RBAC that CI runs under are all created by a human with a credential CI never holds.

Every rule below follows from that split. The deploy identity is scoped to the first list, and step 4 asserts it cannot reach the second.

**Steps 2 through 5 ship as a published action:** [`ai-outfitter/agent-operator/actions/deploy-catalog`](https://github.com/ai-outfitter/agent-operator/tree/main/actions/deploy-catalog) — glob, render (its placeholder is `__REVISION__`), the bidirectional permission preflight, dry-run, apply, and per-agent convergence, exactly as this runbook describes them. It lives in the operator's repository because it patches the custom resources that repository versions, and you pin it to an exact ref for the same reason. Step 1 — identity — is deliberately not part of it: that is the one genuinely per-deployment piece, so your workflow establishes the cluster context and the action asserts what that identity can and cannot do. Read the steps anyway; when the preflight fails, they are the explanation.

## 1. Give CI an identity with no stored credential

Use your forge's OIDC. A workflow presents a short-lived token, the cluster or cloud exchanges it for a scoped role, and no kubeconfig, service-account token, or static cloud key is ever stored as a secret.

Both forges support this. What differs is only how the token becomes cluster access:

| Forge           | Mechanism                                                      | Cluster access                                                                                      |
| --------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| GitHub Actions  | `permissions: id-token: write`, then a cloud credential action | The cloud's Kubernetes access mapping — for example an EKS access entry bound to a Kubernetes group |
| Forgejo Actions | `enable-openid-connect: true`                                  | A cluster RoleBinding that accepts the OIDC subject directly                                        |

Grant the deploy role its own identity rather than reusing a broad deployment role. A role that can create namespaces and install charts is far more than moving one agent to a new revision, and the whole point of step 4 is to prove that difference holds.

**The workflow file's path is part of your identity.** The OIDC subject embeds the repository, the ref, and — on Forgejo — the workflow file path. Renaming the file or deploying from a branch other than the default mints a subject your trust policy does not list, and every exchange fails. Change the trust policy or RoleBinding _first_, then rename. Record this at the top of the workflow, because the failure appears as an authorization error with nothing to suggest a rename caused it.

On GitHub, do not attach an `environment:` to the job unless your trust policy expects one. A job with an environment presents `repo:<owner>/<repo>:environment:<name>` as its subject, which can never match a policy pinning `repo:<owner>/<repo>:ref:refs/heads/main`.

## 2. Let the tree decide what deploys

Discover manifests by globbing `agents/*/deployment.yaml`. Do not name them in the workflow.

This is not a convenience. It makes the set of agents a pipeline manages a fact anyone can read off the repository, rather than a list buried in a script that only its author knows to update. Adding an agent becomes a directory and a file, reviewed like any other change. Step 4 then derives both halves of the permission check from that same tree, which a hand-written list cannot give you.

**Keep the `Organization` out of the agent directories.** It is catalog-level: several agents share one, and an `Organization` living inside `agents/luce/deployment.yaml` makes every other agent silently depend on that file being present and applied. Give it its own manifest outside the glob and apply it alongside.

## 3. Pin the revision once, render it everywhere

Commit manifests that carry a placeholder rather than a revision:

```yaml
apiVersion: aioutfitter.com/v1alpha1
kind: Organization
metadata:
  name: acme
spec:
  agentCatalogs:
    - name: acme-agents
      uri: https://github.com/acme/.agents.git
      revision: __CATALOG_REVISION__
```

The deploy script substitutes the revision into every document, then makes two assertions before it touches the cluster:

```sh
sed "s#__CATALOG_REVISION__#$revision#g" "$source" > "$rendered"

if grep -Fq '__CATALOG_REVISION__' "$rendered"; then
  echo "deploy: failed to render the revision into $rendered" >&2
  exit 1
fi
```

The first assertion exists because an unrendered placeholder is not a syntax error. A manifest still reading `__CATALOG_REVISION__` applies cleanly, reports success, and deploys nothing.

The second assertion is the one that matters. **The revision is pinned in more than one place per agent** — on the `Organization`, and again in each `Agent` whose setup step fetches the catalog. The operator does not compare them. Diverge them and the agent fetches a revision nobody reads, then fails to find its own definition. So verify the count in each rendered document rather than trusting the substitution:

```sh
occurrences="$(grep -c "$revision" "$rendered" || true)"
if (( occurrences < expected_pins )); then
  echo "deploy: $rendered pins the revision $occurrences times, expected $expected_pins" >&2
  exit 1
fi
```

Take the revision from the commit being deployed — the catalog is the repository, so its own SHA is the pin. Require the full 40 characters and reject anything else; a short SHA resolves locally and silently produces a cache entry the runtime never reads.

## 4. Assert the permissions in both directions

Before applying anything, check what the deploy identity may do **and what it may not**. Derive both halves from the glob:

```sh
# Positive: every agent the tree declares must be patchable.
for agent in $discovered; do
  require_allowed patch "agents.aioutfitter.com/$agent"
done
require_allowed patch "organizations.aioutfitter.com/$organization"

# Negative: every agent the cluster has that the tree does not declare must not be.
for agent in $(kubectl get agents.aioutfitter.com -o name); do
  case " $discovered " in *" ${agent##*/} "*) continue ;; esac
  require_denied patch "$agent"
done

# Standing negatives: the administrator column of the split above.
require_denied get secrets --namespace="$namespace"
require_denied create agents.aioutfitter.com
require_denied delete agents.aioutfitter.com/"$any_agent"
require_denied patch deployments.apps --namespace=<operator-namespace>
```

The positive half catches RBAC that drifted narrower and would otherwise fail halfway through an apply, leaving the fleet split across two revisions.

The negative half is the one worth dwelling on, because **the glob is what makes it exhaustive**. Written by hand, a denied-list is a guess that rots: it names the things someone thought of, and says nothing about the agent added to the cluster last month. Derived from the tree, it is a complete statement — this pipeline may move these agents and provably no others. RBAC that drifted wider is otherwise invisible, because a deploy that quietly gained the ability to patch a neighbouring team's agent still succeeds.

That is the argument for globbing rather than listing. A hand-maintained list of what to deploy can only ever produce a hand-maintained list of what to forbid.

`kubectl` 1.35 removed `auth can-i --resource-name`; use `verb resource/name` instead.

## 5. Dry-run, apply, then prove it converged

Server-side dry-run the whole rendered set first. A rejected `Agent` must not leave the `Organization` already pointing at a revision nothing resolved:

```sh
kubectl apply --server-side --force-conflicts --dry-run=server \
  --field-manager=acme-catalog-deploy --filename="$rendered"

kubectl apply --server-side --force-conflicts \
  --field-manager=acme-catalog-deploy --filename="$rendered"
```

Then wait for convergence — and be precise about what that means. **`Ready` alone lies.** It reports that a workload is running, not that the workload is running _this_ composition; it stays `True` throughout a rollout while the old pod still serves the previous profile. Require all three:

```sh
converged() {
  local agent="$1" generation observed ready resolved
  generation="$(kubectl get agent "$agent" -o jsonpath='{.metadata.generation}')"
  observed="$(kubectl get agent "$agent" -o jsonpath='{.status.observedGeneration}')"
  ready="$(kubectl get agent "$agent" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}')"
  resolved="$(kubectl get agent "$agent" \
    -o jsonpath="{.status.catalogSources[?(@.name==\"$catalog_source\")].revision}")"
  [[ "$generation" == "$observed" && "$ready" == "True" && "$resolved" == "$revision" ]]
}
```

The operator has observed this spec, the agent is up, and the catalog it actually resolved is the revision you pushed. Any two of the three can hold while the deploy has not landed.

## 6. Trigger it on the right changes

Filter the trigger to the paths that change composition, so an unrelated README edit does not roll the fleet:

```yaml
on:
  push:
    branches: [main]
    paths:
      - agents/**
      - skills/**
      - mcp.json
      - models.json
      - settings.yml
      - bin/deploy
      - .github/workflows/deploy.yml
  workflow_dispatch:

concurrency:
  group: catalog-deploy
  cancel-in-progress: false
```

Include the workflow and the deploy script in the filter — a change to how you deploy should deploy. Keep `cancel-in-progress: false`: cancelling a deploy mid-apply is the one way to produce the split-revision state everything above is written to prevent.

Pin and checksum `kubectl` rather than resolving `latest` at run time. A deploy identity should not be handed a binary chosen by whoever published most recently.

## Adding an agent is a two-person change

The first time someone adds an agent, the deploy fails. That is the design, and it is worth stating plainly before it surprises anyone.

1. An engineer adds `agents/<id>/deployment.yaml` and opens a pull request.
2. The deploy runs, discovers the new directory, and the preflight denies it: the deploy role's `resourceNames` does not list the new agent.
3. An administrator adds the name to the role and applies it.
4. The re-run deploys the agent.

Resist the urge to remove that friction. If adding a directory silently granted a pipeline the right to create and move a new agent identity in your cluster, then anyone who can merge a pull request could mint one. The RBAC gate is exactly what makes "anyone can propose an agent" safe to allow — the proposal is a merge, the grant is an administrator's.

What you _should_ remove is the confusion. A raw authorization denial names a resource and a verb; it does not say "an administrator must widen a role." Have the deploy print the remedy it already knows:

```text
deploy: not authorized to patch agents.aioutfitter.com/researcher
deploy: agents/researcher/deployment.yaml is declared but not granted.
deploy: an administrator must add it to the deploy role:

  - apiGroups: ["aioutfitter.com"]
    resources: ["agents"]
    resourceNames: ["luce", "researcher"]
    verbs: ["get", "patch", "update"]
```

The handshake is inherent — CI cannot widen its own permissions, and a process that could would defeat the split. Making it a paste instead of an investigation is the whole of the ergonomics available, and it is enough.

Note also what the glob changes about blast radius. A catalog revision moves **every** agent that resolves from it, so path filters no longer narrow anything: they decide whether the fleet moves, not which part of it does. Dry-run the whole rendered set before applying any of it, and check convergence per agent, so a single rejected manifest cannot leave half the fleet on the new revision.

## Done when

This runbook has no SDLC report signal yet; verify it directly instead.

Push a trivial change to a composition path — a comment in an agent's `agent.md` is enough. Then:

1. The workflow run completes green, with the dry-run step passing before the apply step.
2. For every deployed agent, the resolved revision equals the commit you just pushed and the agent is still up:

```sh
kubectl get agent <agent> \
  -o jsonpath="{.status.catalogSources[?(@.name==\"<source>\")].revision}{'\n'}"
kubectl get agent <agent> \
  -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}{"\n"}'
```

3. Re-run the workflow with no new commit. It converges immediately and changes nothing — a deploy that is not idempotent will drift under retries.

Then confirm the guard rails actually guard. Temporarily point the deploy at a manifest whose placeholder you have removed, and confirm the run fails at the render assertion rather than applying. A safety check nobody has seen fail is a safety check nobody has tested.

## Three failures that produce no useful error

Each of these has cost more than one debugging session, on both forges.

**A renamed workflow file breaks trust.** Covered in step 1. The symptom is an authorization failure at credential exchange, which reads as a broken secret.

**Job-level `env` containing an expression fails at run creation, with no logs.** Both GitHub Actions and Forgejo 15 exhibit this. Keep `${{ }}` expressions at step level. The run shows as failed with nothing to read.

**A shallow checkout breaks path-based branching.** If your workflow selects work by diffing against the push's base commit, `fetch-depth: 0` is required — the default shallow clone does not contain the base, the diff fails, and every leg runs on every push.

## Forge differences worth knowing

Forgejo Actions consumes GitHub-hosted actions by URL, so most steps are portable verbatim. Two are not:

- **Runner network topology.** A container-backed Forgejo runner may clone through a loopback instance URL that is unreachable from inside the job container. A native runner on a host that can reach both the forge and the Kubernetes API avoids the problem entirely, and gives you a local API server rather than an exposed one.
- **Subject shape.** Forgejo's OIDC subject includes the workflow file path; GitHub's does not. The rename hazard in step 1 is sharper on Forgejo.

## Your first step on the next rung

You now deploy composition changes without touching the cluster. The revision that reaches your agents is whatever passed review — which means review is the only gate, and nothing yet checks that the catalog is _valid_ before it ships.

Add `outfitter validate` as a required check on the catalog's pull requests. It costs one job and turns a class of failure that currently presents as "the agent cannot find its own definition" into a red check on the change that caused it.
