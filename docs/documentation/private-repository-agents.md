# Private repository agents

Use this pattern when an agent works on a repository that MUST stay private.
The main rule is simple:

> A role is reusable. A runtime identity is not reusable.

An agent profile can define a reusable role such as `luce`.
Each forge owner needs a separate child agent and a separate runtime.

```text
luce
├── outfitter-agents-luce  -> one Outfitter organization runtime
└── ncrmro-agents-luce     -> one ncrmro organization runtime
```

The child agent identifies the provider, owner, and role.
It does not create the security boundary by itself.
The operator and the container MUST create that boundary.

## Security goal

The deployment MUST prevent these actions:

- The agent changes the private repository to public.
- The agent creates a fork.
- The agent creates another repository and copies the source into it.
- The agent pushes the source to a different forge owner.
- The agent pushes the source to a different forge provider.
- The agent sends source through an unapproved channel.

A prompt can tell an agent not to do these actions.
A prompt cannot prevent these actions.
The deployment MUST remove the required credentials and network paths.

The deployment MUST also list every approved data destination.
For example, a selected model provider is a data destination.
Do not claim a strict privacy guarantee if the agent has general network access.

## One deployment for each owner and role

Create one deployment child for each `(forge provider, forge owner, role)` tuple.
For example, use these children for the `luce` role:

| Child agent             | Provider | Owner          | Role   |
| ----------------------- | -------- | -------------- | ------ |
| `outfitter-agents-luce` | GitHub   | `ai-outfitter` | `luce` |
| `ncrmro-agents-luce`    | GitHub   | `ncrmro`       | `luce` |

Each child MUST have all of these separate resources:

- A process and a pod.
- A namespace.
- A `HOME` directory and persistent volume.
- A service account.
- A forge work token or workload-specific broker binding.
- A channel endpoint and channel principal.
- An egress policy.
- A session store, cache, and artifact store.

Two organization children MUST NOT share these resources.
Do not put credentials for two owners in one pod.
Do not reuse one channel principal for two owners.
Do not use one writable volume for two owners.

This split limits the effect of a bad prompt, a compromised dependency, or an operator error.
It also makes workload and broker audit records identify one owner and one
role. GitHub audit records identify the role only when each role uses a
different App or machine account.

## Compose a reusable role

Keep the base agent provider-neutral.
The base can contain the role prompt and shared skills.
The base MUST NOT contain forge credentials, repository URLs, channel secrets, or provider-specific policy.

```text
trusted-catalog/
  agents/
    luce/
      agent.md
    outfitter-agents-luce/
      agent.md
    ncrmro-agents-luce/
      agent.md
```

The base agent can define shared behavior:

```markdown
---
name: luce
skills: [code-review, project-notes]
---

# Luce

Review evidence before you change code.
Make small changes.
Run the applicable checks.
```

A deployment child inherits the base and adds one provider and owner:

```markdown
---
name: outfitter-agents-luce
inherits: luce
skills: [github-work]
---

# Outfitter Luce

Work only in repositories that the ai-outfitter organization owns.
Treat every other forge owner as out of scope.
```

```markdown
---
name: ncrmro-agents-luce
inherits: luce
skills: [github-work]
---

# ncrmro Luce

Work only in repositories that the ncrmro organization owns.
Treat every other forge owner as out of scope.
```

The child text is a clear instruction.
The runtime controls MUST enforce the same owner boundary.
Do not put a secret in `agent.md`, `config.json`, a skill, or a settings file.

See [Agents](./agents.md#inheritance-and-prompt-fragments) for inheritance rules.
See [Organization catalog](./usecases/organization-profile-catalog.md) for the shared catalog layout.

## Use an immutable catalog

Protected resident agents MUST use a trusted catalog.
An administrator MUST review and pin the catalog to a full commit SHA.
The runtime MUST receive the approved content through a read-only image or mount.

Keep the trusted catalog separate from the target repository.
The target repository is work input.
It MUST NOT control the protected agent composition.

Use this current preparation flow outside the agent pod:

1. Check out the trusted catalog at its approved commit.
2. Run `outfitter sync` from a trusted control directory.
3. Run `outfitter validate --strict`.
4. Dump the selected child with `outfitter dump --agent <child>`.
5. Review the dump.
6. Resolve every exact `git:` or `npm:` extension into a reviewed cache.
7. Bake the dump and extension cache into an immutable image, or mount both
   read-only.
8. Start the runtime with `PI_OFFLINE=1` and `outfitter run <child> --strict`.
   Treat a missing extension as a launch failure.

The agent pod SHOULD NOT run `outfitter sync`.
An administrator SHOULD review a new catalog commit before a new deployment.

`outfitter dump` does not vendor Pi extension code. Outfitter 1.4.0 installs a
missing `git:` or `npm:` extension into a writable cache at launch when online.
That network install is executable composition and bypasses a dump-only review.
A protected runtime MUST use reviewed extension artifacts and MUST stay
offline during composition.

## Keep the target repository out of composition

Outfitter currently gives `<project>/.agents/` the highest resource precedence.
It selects `<project>` from the current working directory.
A writable target repository can therefore replace a catalog resource during normal resolution.

A protected resident MUST start from a trusted control directory.
Mount the target repository at a different path.
For example:

```text
/control/.agents/  # approved composition, read-only
/work/repository/  # target repository, writable
```

Start Outfitter in `/control`.
Tell the agent to work in `/work/repository`.
Do not start Outfitter in `/work/repository`.

This layout protects the initial composition.
It does not add a locked composition mode to Outfitter.
The operator MUST prevent an untrusted workspace layer from entering the approved launch.

Outfitter needs a native locked mode for this use case.
That mode MUST resolve only the approved catalog or dump.
It MUST ignore workspace, user, and remote setting overrides.
Until that mode exists, the operator or container MUST provide the equivalent control.

## Pass only approved environment variables

Outfitter currently passes its full parent environment to the harness.
The operator MUST start Outfitter with an allowlisted environment.
The environment MUST contain credentials for only one organization child.

Do not put host Git, SSH, cloud, or forge credentials in the parent environment.
Do not mount a general SSH agent socket.
Do not mount a general Git credential store.

Outfitter needs a launch environment allowlist.
Until that control exists, the operator or container MUST remove all unapproved variables before launch.

## Treat Outfitter policy as configuration

The following Outfitter features do not enforce this security boundary:

- Project and user layers.
- Remote organization settings.
- `tools.allow` and `tools.deny`.
- Prompts, skills, wrappers, and hooks.
- Private catalog detection.

Remote organization settings have lower precedence than project and user settings.
They distribute defaults.
They are not mandatory policy.

Outfitter reads tool policy, but it does not project leader tool policy to Pi.
`--strict` makes this unsupported control stop the launch.
Without `--strict`, the run continues without that control.

Tool names also do not define a complete shell boundary.
Bash can call Git, network clients, or another program directly.
Wrappers and hooks can improve behavior, but they remain guardrails.

Private catalog support controls catalog use.
It does not control the target repository.
It also delegates authentication to ambient Git configuration.

## Required operator and container controls

Outfitter owns composition.
The deployment platform owns isolation.

The operator or container MUST enforce these controls:

| Control             | Requirement                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| Runtime             | Run one organization child in one process and one pod.                                                         |
| Storage             | Give each child a separate `HOME`, volume, cache, and session store.                                           |
| Kubernetes identity | Give each child a separate service account and namespace.                                                      |
| Forge work access   | Give each child a distinct token or broker binding for one owner.                                              |
| Forge authority     | Remove repository creation, fork, transfer, and visibility permissions.                                        |
| Catalog             | Use one reviewed commit through a read-only image or mount.                                                    |
| Extensions          | Preload reviewed exact artifacts, mount the cache read-only, and set `PI_OFFLINE=1`.                           |
| Composition         | Exclude target repository and user overrides from the approved launch.                                         |
| Environment         | Pass only approved variables and one child credential set.                                                     |
| Network             | Deny direct egress and general DNS. Use a policy gateway and, when required, an exact-name internal DNS proxy. |
| Channels            | Use one endpoint and one principal. The operator sets `OUTFITTER_CHANNELS=agent` for the coding process.       |
| Browser and MCP     | Disable them unless the deployment gives them a separate approved boundary.                                    |
| Logs and artifacts  | Keep them inside the same owner boundary. Redact secrets.                                                      |

The forge MUST also enforce repository privacy.
The agent credential MUST NOT include repository administration permission.
Network policy MUST block other forge providers and unapproved upload destinations.

See [In-cluster agents](./in-cluster.md) for the operator resource model.
See [Container images](./containers.md) for the runtime image contract.

## Deployment check

Complete this check before the agent receives private source:

- [ ] The child name identifies one provider, one owner, and one role.
- [ ] The child inherits a provider-neutral base.
- [ ] The catalog commit is reviewed and pinned.
- [ ] Every extension artifact is reviewed, pinned, and present in a read-only
      cache or image.
- [ ] `PI_OFFLINE=1` and `outfitter run <child> --strict` succeed without a
      network install.
- [ ] The approved composition is read-only.
- [ ] The target repository cannot override the composition.
- [ ] The pod environment contains only allowlisted values.
- [ ] The pod contains one forge credential set.
- [ ] The credential can access only approved repositories.
- [ ] The credential cannot create, fork, transfer, or change repository visibility.
- [ ] The service account and volume are unique to the child.
- [ ] The channel endpoint and principal are unique to the child.
- [ ] The egress policy lists every approved destination.
- [ ] Direct CoreDNS, public DNS, and arbitrary DNS queries fail.
- [ ] A constrained resolver answers only exact approved cluster-local names.
- [ ] General SSH, browser, email, and web upload paths are absent.
- [ ] Logs, sessions, caches, and artifacts stay in the owner boundary.
- [ ] A test proves that a push to another owner or provider fails.
- [ ] A test proves that the agent cannot change repository visibility.

If one required check fails, the deployment MUST NOT receive the private repository.
