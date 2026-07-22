# Design spec: organization-catalog governance

Status: draft for review (2026-07). Design only; implementation requires dedicated requirements and tests.

This is the RFC #165 translation of the ported profile-era governance proposal. The governed unit
is now a `.agents` catalog and its composed agent, not a legacy Outfitter profile.

## 1. Motivation

Platform teams repeatedly ask for four related capabilities:

1. **Approved catalogs** — agents launch only from reviewed configuration sources.
2. **Cost controls** — high-volume, low-risk roles do not silently select the most expensive model.
3. **Auditability** — an operator can identify the agent, source revisions, harness, and model used
   for a session.
4. **Federated context** — shared codebase, team, and policy context is governed once instead of
   copied into every repository.

Outfitter already has git-native inputs, pinnable refs, deterministic layer precedence, a
harness-neutral `CompositionPlan`, and a clear enterprise license boundary. Governance should
constrain those primitives without introducing a second composition system.

## 2. Existing primitives

- `sources` loads local or remote `.agents` payloads in deterministic order.
- `remote_settings` distributes lower-precedence settings from a repository.
- Remote `ref` values can pin a branch, tag, or commit.
- Local workspace and global settings normally outrank remote settings.
- The composition plan records the selected agent identity and resolved loadout before projection.
- `enterprise.private_catalogs` establishes the precedent for a visible commercial boundary without
  credential collection.

The gap is policy: users can add sources and override settings, launches have no durable provenance
record, and model/cost guidance is prose rather than a machine-checkable constraint.

## 3. Pinned policy and source allowlists

A local settings entry may designate one remote settings source as organization policy:

```yaml
# ~/.agents/settings.yml
remote_settings:
  - github: acme/.outfitter
    path: .agents/policy.yml
    ref: v2026.07
    pinned: true
```

The referenced file carries constraints rather than higher-precedence values:

```yaml
org_policy:
  id: acme
  version: 1
  source_allowlist:
    - github: acme/.agents
      ref: v2026.07
    - github: acme/payments-service
      path: .agents
    - path_prefix: ~/.agents
  require_ref_pinning: true
```

Rules:

- `org_policy` is valid only in a remote settings file whose local reference is `pinned: true`.
  Local settings cannot self-assert organization policy.
- Normal settings precedence remains unchanged. Policy evaluates the merged settings and resolved
  source graph after merge; it does not become a special high-precedence settings layer.
- Source identity matching normalizes equivalent git URI forms. An allowlist ref, when present,
  must match exactly.
- With no live policy checkout, a cached exact revision may be used. If no verified copy exists,
  behavior follows the enforcement mode.
- Multiple pinned policies are deferred until most-restrictive-wins composition has a precise spec.

The pin and allowlist mechanism is MIT-licensed. It is useful to individuals and small teams as a
supply-chain control.

## 4. Enforcement modes

```yaml
org_policy:
  id: acme
  enforcement: warn # warn | enforce
  help: https://engineering.acme.example/agent-policy
```

- `warn` allows the operation and emits one non-suppressible diagnostic naming policy id, rule, and
  subject. The violation is included in audit output when enabled.
- `enforce` refuses sync, composition, or launch before the harness starts. The error names the
  violated rule and the organization help URL.
- There is no `--no-policy` launch flag. Removing a pinned policy is a deliberate settings change,
  not a reusable shell escape hatch.
- Failure to obtain any verified policy copy warns in `warn` mode and fails closed in `enforce`
  mode.

Policy evaluation and `warn` are MIT-licensed. Hard `enforce` posture is enterprise-licensed under
`enterprise.policy_enforcement` because it is meaningful primarily on managed organization fleets.

## 5. Session provenance audit

Audit records provenance, never conversation content. A start/end event pair contains:

- timestamp, event type, session correlation id, and Outfitter version;
- selected agent slug and harness;
- every contributing `.agents` layer with normalized source identity, configured ref, and resolved
  commit SHA for git sources;
- effective model and thinking selection from the `CompositionPlan`;
- policy id/version/mode and violations;
- exit code plus undeclared runtime-projection write outcomes.

Example:

```json
{
  "ts": "2026-07-01T18:22:41Z",
  "event": "session_start",
  "session": "0d5c…",
  "agent": "engineer",
  "harness": "pi",
  "layers": [
    {
      "source": "github:acme/.agents",
      "ref": "v2026.07",
      "commit": "9a1f3c…"
    }
  ],
  "model": "anthropic/claude-sonnet-4",
  "thinking": "high",
  "policy": { "id": "acme", "version": 1, "enforcement": "warn", "violations": [] }
}
```

Privacy requirements:

- No prompt, conversation, file content, credential, or secret values.
- Working directories are omitted or salted hashes by default; cleartext requires explicit opt-in.
- The OSS sink is local append-only JSONL under the platform state directory.
- Nothing is transmitted by default.
- Rotation is bounded and deterministic.

The schema, local writer, and `outfitter audit list` are MIT-licensed. Collectors, retention policy,
organization reporting, and policy that requires audit delivery are enterprise features.

## 6. Model and relative-cost policy

Agent configuration may declare a relative budget annotation:

```json
{
  "model": "anthropic/claude-opus-4",
  "thinking": "xhigh",
  "budget": {
    "units": 8,
    "rationale": "Infrastructure mistakes dominate token cost."
  }
}
```

`budget.units` is catalog-defined relative guidance, not currency or runtime metering. Policy checks
the effective composition after all layers resolve:

```yaml
org_policy:
  models:
    approved:
      - anthropic/claude-sonnet-4
      - anthropic/claude-opus-4
      - openai/gpt-4.1-mini
    agents:
      support-triage:
        approved: [openai/gpt-4.1-mini]
        max_budget_units: 2
      platform-operator:
        max_thinking: xhigh
    default_max_budget_units: 4
```

Exact model ids plus a narrowly specified trailing `*` glob are sufficient for v1. A configured
maximum with no budget declaration is an unknown-budget violation. Warn-grade checks and budget
schema are MIT-licensed; per-agent hard enforcement and spend reporting are enterprise features.

## 7. Federated-context governance

The [federated-context pattern](../documentation/federated-context.md) uses atomic context skills
selected by thin agents. Governance needs little new runtime machinery:

- The catalog repository owns context skills with `CODEOWNERS`, protected branches, and reviewed
  release tags.
- Policy allowlists and required pins ensure sessions use reviewed revisions.
- Audit layer SHAs make each selected skill attributable to an exact catalog revision.
- Workspace-local winning resources remain visible in provenance so reviewers can distinguish
  governed catalog context from project overrides.

The pattern, example, and provenance fields are MIT-licensed. Enterprise value comes from hard
enforcement and centralized audit collection, not from closing the catalog format.

## 8. License boundary

| Capability                        | MIT                                     | Enterprise                                              |
| --------------------------------- | --------------------------------------- | ------------------------------------------------------- |
| Pinned policy + source allowlists | Validation, matching, diagnostics       | —                                                       |
| Enforcement                       | Evaluation and `warn`                   | `enforce`                                               |
| Session audit                     | Schema, local JSONL, local reader       | Collectors, retention, org reporting, required delivery |
| Model/cost policy                 | Budget vocabulary and warn-grade checks | Per-agent hard enforcement and spend reporting          |
| Federated context                 | Pattern, examples, provenance           | Benefits indirectly from enforcement/audit              |

The default rule is consistent: mechanisms and interoperable schemas are open; managed-fleet
posture and centralized operations are enterprise-licensed.

## 9. Proposed implementation sequence

1. Add schema-only support for pinned remote settings references and `org_policy`.
2. Implement source identity normalization, allowlist, and ref-pinning diagnostics in `warn` mode.
3. Add a dedicated formal requirement with exact diagnostics and precedence behavior.
4. Add enterprise-gated `enforce` before sync and launch.
5. Define the local audit JSONL schema, privacy tests, rotation, and start/end writer.
6. Add `outfitter audit list`.
7. Add budget annotations to agent configuration and expose them through list/dump.
8. Add approved-model and budget checks, then the enterprise per-agent enforcement layer.
9. Add documentation for operating a governed `.agents` catalog.

No implementation issue should edit existing requirement semantics implicitly. Requirements,
pinned tests, and implementation must land together under the repository governance process.
