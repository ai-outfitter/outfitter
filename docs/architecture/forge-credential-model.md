# Forge Credential Model

This document records why the runbooks pick the forge credentials they pick. It is not a chooser for users — the runbooks make the choice at the step where it comes up and link here for the reasoning. Read it when you are designing a variation, auditing a deployment, or disagreeing with a runbook.

Outfitter does not collect or validate credentials; see [enterprise-private-catalog-boundary.md](enterprise-private-catalog-boundary.md). Not owning the mechanism does not stop this project from stating which credential a deployment should carry.

## Two axes, not one ranking

A credential has a capability and a reach, and they are independent. Ranking on reach alone produces the wrong answer.

**Capability** is the first filter, and it eliminates more options than scope does. An SSH deploy key is a transport credential: it authenticates `git` over SSH to one repository and cannot call the REST API at all — no issues, no comments, no pull requests, no notifications. A token is an identity credential: it acts as an account.

So the first question is never "how narrow is it" but "can it do the job at all":

- The workload only moves Git objects → a deploy key is a candidate.
- The workload must _be somebody_ on the forge → a deploy key is excluded at any scope.

**Reach** is the second filter. Among the credentials that survive the first, prefer the shortest-lived, then the narrowest.

## Ranked options

| Rank | Credential                            | Lifetime                            | Reach                                               | Use when                                                                               |
| ---- | ------------------------------------- | ----------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1    | Workflow `GITHUB_TOKEN`               | the job                             | the workflow's repository, per the permission block | Anything running in Actions. Nothing standing exists to steal or rotate.               |
| 2    | GitHub App installation token         | one hour                            | selected repositories, granted permissions          | A service acting across several repositories that needs real audit identity.           |
| 3    | Read-only deploy key                  | no expiry                           | one repository, transport only                      | A long-running workload that reads one repository and never calls the API.             |
| 4    | Fine-grained PAT on a machine account | expiring                            | selected repositories in exactly one resource owner | The App cannot be the actor you need — an assignee, a reviewer, a notification target. |
| 5    | Classic PAT on a machine account      | no expiry, no organization boundary | every repository the account can reach              | Only where the forge accepts nothing else.                                             |

Rank 3 sits above rank 4 on purpose, despite never expiring. A leaked deploy key yields read access to one repository and no API surface. A leaked classic PAT on an account that belongs to several organizations yields all of them. Narrow-and-standing beats broad-and-expiring when the narrow credential cannot do anything except clone.

## Why a resident agent still holds a classic PAT

GitHub's `GET /notifications` accepts classic personal access tokens only. It rejects a fine-grained token and it rejects an App installation token. An App also cannot be the assignee of an issue. The channels runbook records both constraints: [`channels/docs/runbooks/github-notifications-local.md`](https://github.com/ai-outfitter/channels/blob/main/docs/runbooks/github-notifications-local.md).

These are two separable requirements:

- **Assignability** needs a real account, because an App cannot be assigned. This holds regardless of the wake mechanism.
- **Classic-ness** is required only by the notifications endpoint.

The classic PAT is therefore not inherent to residency. It is a consequence of _polling_ as the wake mechanism. An agent woken by a webhook or by a message relay needs an account, but not a classic token.

## Two tokens, not one

Because only the wake path requires a classic token, the wake token and the work token are separate credentials. Channels already reads them separately — `githubConfigFromEnv` prefers `GITHUB_NOTIFY_TOKEN` and falls back to `GITHUB_TOKEN` only when it is absent:

- `GITHUB_NOTIFY_TOKEN` — classic, with the `notifications` scope and nothing else.
- `GITHUB_TOKEN` — fine-grained, scoped to one organization and the repositories the agent works.

The scope discipline on the wake token is load-bearing. A fine-grained PAT has exactly one resource owner, which is a property of the credential rather than an organization policy someone can relax; an agent carrying one cannot reach another organization. A classic PAT has no such boundary, so if the wake token is ever minted with `repo` "to be safe", it silently becomes a cross-organization write credential and the containment argument inverts. Verify the granted scopes without exposing the token by reading the `X-OAuth-Scopes` response header on any API call.

A classic PAT with `repo` scope can also create repositories through `POST /orgs/{org}/repos`, subject only to the organization's member repository-creation setting. A fine-grained PAT cannot, absent an explicit `Administration: write` grant. That difference comes from choosing fine-grained, not from personal access tokens as a class.

## When a deploy key earns its place

Use a read-only deploy key when all of these hold:

- one repository;
- read-only;
- a long-running unattended workload, so no workflow token is available; and
- no API call is needed.

The decisive case is narrower than it first appears. If the agent already holds a fine-grained token scoped to the organization that owns the catalog, that token can read the catalog, and a deploy key adds operational surface while removing no reach. Blast radius is the union of what the workload holds; a narrow credential only helps when it _replaces_ a broad one.

What a deploy key uniquely buys is **avoiding an organization membership**. A fine-grained PAT cannot span organizations by construction, so an agent in organization A that must read a catalog in organization B has two options: add its machine account to organization B — which widens the reach of every token that account holds, including the classic wake token — or attach a deploy key to that one repository, which requires no membership and no account at all. The same reasoning covers a workload that should not consume a seat.

Do not use a deploy key when the workload needs any API call, when one service needs several repositories (that is an App), or when the audit record must name which agent fetched: a deploy key authenticates as the repository, not as an actor, and GitHub retains `git.clone` and `git.fetch` events for seven days unless the organization streams its audit log.

## Credential material and the workspace

A resident agent's workspace is a persistent volume. Copying key material onto it defeats the properties that make a Secret a Secret: deleting the Secret does not delete the copy, a pod restart does not delete it, any later workload with access to the volume can read it, and snapshots and backups retain it. File permissions do not help when the agent runs as the workspace user. Mount credentials for the operation that needs them and let them leave with the process.

The same argument applies to executables. A binary copied onto the volume out-of-band is not covered by the image's provenance: no scanner sees it, no signature covers it, a restore can reintroduce an old copy, and nothing detects the drift. This matters most for an SSH client, which both handles the private key and validates the remote host — a substituted binary can disclose the key or accept an impersonating host.

## Current gaps

These are scaffolding, not doctrine. Each should disappear.

- The `Organization` catalog declaration carries no credential reference, so a deployment that reads a private catalog supplies the credential itself. A first-class binding belongs on the `Agent`, naming a Secret and a transport mode rather than particular keys — the operator must not depend on the contents of a referenced object.
- Wake by notification polling forces the classic token described above. A webhook or relay wake removes that requirement and lets the account hold a fine-grained token instead.

Cite this document by heading rather than by line number. Cite code by symbol name, and requirements by identifier; both survive edits that line numbers do not.
