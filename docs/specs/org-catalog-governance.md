# Design spec: Org-catalog governance

Status: draft for review (2026-07). Design only — implementation issues spawn from §9.

Scope: the feature set that turns a shared profile catalog into an organization control plane: approved profile stores, enforcement, session auditability, model/cost policy, and governed shared context. Decides the OSS vs. enterprise-licensed boundary per feature.

## 1. Motivation

Field demand is concrete and repeated. Enterprise platform teams (UPS- and Home Depot-scale organizations, via the 2026-06-29 field call) are asking for the same four things:

1. **Approved profile stores** — "our engineers launch agents only from configurations we published and reviewed."
2. **Cost controls** — role-shaped defaults so high-volume low-risk work doesn't run on the most expensive model at the highest thinking level.
3. **Auditability** — when an agent session did something, be able to answer _which profile, from which source, at which ref, with which model_ ran it.
4. **Federated context** — a governed, composable prompt/context library ("50 codebases, one prompts repo") instead of per-repo rule-file drift.

DORA 2025 independently validates the shape: organizations that standardize AI-agent configuration at the platform-team level outperform teams doing ad-hoc per-developer setup. And the CSA has flagged agent configuration — extensions, skills, injected args/env — as a supply-chain attack surface, which makes "who reviewed this profile" a security question, not just a tidiness question.

Outfitter is well positioned for this wedge because its primitives are already git-native: catalogs are repos, refs are pinnable, and settings merge is deterministic and layered. What is missing is a coherent policy layer on top and a decided OSS/enterprise boundary. The assessment (§5, §6.C) names this the enterprise wedge.

## 2. Current primitives (what exists today)

Per OFTR-002 and OFTR-004, shipped behavior already provides the raw material:

- **`remote_settings`** (OFTR-002.6): `settings.yml` may pull settings-style YAML from a remote repo (`uri` or `github` shorthand, required `path`, optional `ref`). Cached copies are used at resolve time. **Precedence today: local discovered settings win over remote settings** — an org can suggest, not require.
- **`profile_sources` with `only` / `except`** (OFTR-002.5): a source entry can allowlist (`only`) or denylist (`except`) profile IDs from that source. This filters _what a source contributes_, but nothing constrains _which sources a user may add_.
- **`ref` pinning** (OFTR-002.5.6, OFTR-002.6.4): both profile sources and remote settings can pin a branch, tag, or commit. Pinned sources cache under `~/.outfitter/cache/repos/<encoded-uri-and-ref>/` (OFTR-004.2.4). No policy exists about _requiring_ pins.
- **`sync` hygiene** (OFTR-004.2): validates settings before syncing, validates synced profiles, reports per-source status, and redacts credentials from output. No lockfile/reproducibility guarantee yet (explicitly deferred, OFTR-004.2.8).
- **Enterprise flag precedent** (OFTR-004.2.10–17): `enterprise.private_profile_catalogs: true` in `~/.outfitter/settings.yml` already establishes the pattern of informational commercial governance — a home-settings boolean gating an enterprise-licensed capability, with prescribed prompt text and no credential handling.
- **Budget annotation pattern** (org use-case doc): `budget_units` exists only as a comment convention explaining relative cost/latency per role. Nothing is machine-readable.

The gap: every primitive is opt-in and user-overridable. There is no way for an org to _pin_ policy, no enforcement, no audit trail, and no machine-readable cost/model policy.

## 3. Feature A — Org-pinned `remote_settings` with source allowlists

### Design

Two additions: a `pinned` marker on a `remote_settings` entry, and an `org_policy` block that the pinned remote settings file may contain.

```yaml
# ~/.outfitter/settings.yml (written once, e.g. by `outfitter setup <org-policy-repo>`)
remote_settings:
  - github: acme/outfitter-policy
    path: policy/settings.yml
    ref: v2026.07 # tag; orgs SHOULD pin a tag or commit, not a branch
    pinned: true # this entry's org_policy block outranks local settings
```

```yaml
# acme/outfitter-policy → policy/settings.yml (the org-controlled file)
org_policy:
  id: acme
  version: 1
  source_allowlist:
    # Users may only load profiles from sources matching one of these entries.
    - github: acme/outfitter-catalog
      ref: v2026.07 # allowlist entries may require a ref (pin policy)
    - uri: https://git.acme.example/platform/outfitter-catalog.git
    - path_prefix: ~/.outfitter/profiles # local personal profiles allowed (or omit to forbid)
  require_ref_pinning: true # remote sources without ref are policy violations
```

Semantics:

- **Settings key:** `org_policy` is valid **only** inside a `remote_settings` file whose local entry carries `pinned: true`. An `org_policy` block found in local settings, or in a non-pinned remote, is a validation error (prevents self-granted "policy").
- **Precedence:** this deliberately inverts OFTR-002.6.6 for exactly one namespace. Ordinary settings keys in the pinned remote still lose to local settings (unchanged). The `org_policy` block is evaluated as a constraint layer _after_ the normal merge: the merged Settings object is checked against it, it is not merged into it. This keeps OFTR-002 precedence intact rather than special-casing merge order.
- **Allowlist matching:** a configured `profile_sources` entry is allowed iff it matches an allowlist entry (same repo identity after URI normalization; ref matching honors the allowlist's `ref` when present; `path_prefix` covers local paths). Non-matching sources are policy violations handled per the enforcement mode (§4).
- **Failure mode:** if the pinned remote settings cannot be fetched, the cached copy is used (existing OFTR-002.6.5 behavior). If **no cached copy exists** (first run, cache wiped): `warn` mode proceeds with a prominent notice; `enforce` mode refuses to launch with an actionable error ("cannot verify org policy; run `outfitter sync` on a network with access to acme/outfitter-policy"). A `max_policy_age_days` knob (enterprise) can additionally treat a stale cache as unfetched.

### Open questions

- Should multiple `pinned: true` entries be allowed (e.g., org + business-unit policy)? Proposal: yes, evaluated in order, most-restrictive-wins — but defer until asked for.
- Should the allowlist also constrain `remote_settings` entries themselves (a rogue second remote)? Likely yes; needs a rule that the pinned entry cannot be allowlisted away.
- URI normalization rules (ssh vs https forms of the same repo) need a precise equivalence spec.

### OSS / enterprise

**OSS.** The pin + allowlist mechanism is a trust feature individuals and small teams also want (CSA supply-chain angle), and shipping it open builds trust in the format. Rationale for the line: mechanisms are OSS; what orgs pay for is operating them at scale (§4–§6).

## 4. Feature B — Enforcement modes: `warn` | `enforce`

### Design

```yaml
# policy/settings.yml (org-controlled)
org_policy:
  id: acme
  enforcement: warn # warn | enforce (default: warn)
```

- **`warn`** (default): a launch that violates policy — profile resolved from a non-allowlisted source, unpinned source where pinning is required, model outside the approved list (§6) — proceeds, with a single prominent, non-suppressible diagnostic naming the violated rule and the policy id/version. Violations are recorded in the audit log (§5) when enabled.
- **`enforce`**: the same violations abort the launch before the agent CLI starts, with an actionable error (which rule, which source/profile/model, and the org-designated contact/URL via an optional `org_policy.help: <url>` field). Escape hatch: `--no-policy` is **not** provided; the escape is editing local settings to drop the pinned remote — which is visible, deliberate, and (with §5) auditable, rather than a flag someone puts in a shell alias.

Diagnostic text follows the OFTR-004.2.12 precedent: exact prescribed wording lives in the requirement when this is implemented, so tests pin it.

### Open questions

- Granularity: one global mode, or per-rule modes (`source_allowlist: enforce`, `models: warn`)? Proposal: start global; per-rule is a compatible extension (`enforcement: { sources: enforce, models: warn }`).
- Does `enforce` apply to `outfitter sync` (refuse to sync non-allowlisted sources) or only to `run`? Proposal: both — sync-time refusal gives earlier, friendlier failure.

### OSS / enterprise

**`warn` is OSS; `enforce` is enterprise-licensed** (a home-settings gate in the style of `enterprise.private_profile_catalogs`, e.g. `enterprise.policy_enforcement: true`). Rationale: warning-grade guardrails are a community trust feature and make the format credible; hard enforcement is only meaningful inside a managed org (an individual can always edit their own settings), so it is precisely the org-scale control plane the enterprise license covers. This is the cleanest expression of the default rule: the mechanism (policy evaluation, diagnostics) is OSS and identical in both modes; the org-scale posture (blocking) is paid.

## 5. Feature C — Session provenance audit log

### Design

**What is recorded** — one event per launch (and one per exit), capturing provenance, not content:

- timestamp, event type (`session_start` / `session_end`), outfitter version
- adapter (`pi` / `claude`) and adapter/agent CLI version when cheaply known
- selected profile id and the **resolved profile stack**: for each layer, profile id, source identity (normalized URI or local path class), `ref` as configured, and resolved commit SHA for git-backed sources
- effective model, provider, and thinking level after merge
- policy context: `org_policy.id`, `version`, enforcement mode, and any violations (rule + subject) — including warned-and-proceeded ones
- session correlation id (random UUID) so start/end pair up

**Where:** append-only JSONL at `~/.outfitter/state/audit/sessions.jsonl` (rotated by size; e.g. `sessions.jsonl.1` …). This sits under Outfitter's own state home, not in any profile or composite dir, so it survives runs and is never synced into catalogs.

```json
{
  "ts": "2026-07-01T18:22:41Z",
  "event": "session_start",
  "session": "0d5c…",
  "outfitter": "0.7.2",
  "adapter": "pi",
  "profile": "engineer",
  "stack": [
    {
      "id": "base-acme",
      "source": "github:acme/outfitter-catalog",
      "ref": "v2026.07",
      "commit": "9a1f3c…"
    },
    {
      "id": "engineer",
      "source": "github:acme/outfitter-catalog",
      "ref": "v2026.07",
      "commit": "9a1f3c…"
    }
  ],
  "model": "anthropic/claude-sonnet-4",
  "provider": "anthropic",
  "thinking": "high",
  "policy": { "id": "acme", "version": 1, "enforcement": "warn", "violations": [] }
}
```

**Privacy notes (normative):**

- No prompt text, no conversation content, no file contents, no repo file paths. The working directory is recorded only as a salted hash by default (`cwd_hash`), with a settings opt-in for cleartext.
- No credentials ever (extends OFTR-004.2.9/17 redaction guarantees to audit output).
- The log is **local-only** in OSS. Nothing ships telemetry; there is no default network sink. Users can read their own log (`outfitter audit list` convenience command, or plain `jq`).
- Enabling/disabling: `audit.enabled` in settings; org policy may set `audit: required` (a §4 rule — warn or enforce when the local log is disabled).

### Open questions

- Should `session_end` capture state-persistence outcomes (undeclared-write reports)? Natural fit with the near-real-time detection work (update-plan issue 11) — proposal: yes, as a follow-up field.
- Log integrity: is append-only-by-convention enough, or do enterprise deployments need hash-chained entries? Defer; collectors (below) can sign on ingest.
- Multi-user machines: per-user home is assumed; no shared-log design needed now.

### OSS / enterprise

**Split.** The local JSONL log, its schema, and `audit list` are **OSS** — individuals debugging "which profile was I actually running Tuesday?" get real value, and an open schema lets orgs build their own pipelines. **Enterprise:** collectors/forwarders (ship to S3/Splunk/OTLP), retention policy, org-wide reporting, and the `audit: required` policy rule under `enforce`. Mechanism OSS, org-scale audit tooling paid — the default rule verbatim.

## 6. Feature D — Model/cost policy

### Design

Two halves: formalize the budget annotation, and let policy constrain models.

**Formalized `budget_units`** — promote the existing comment convention in the org use-case doc to a schema field on profiles:

```yaml
# profiles/platform-operator/profile.yml
id: platform-operator
inherits: [base-acme]
budget:
  units: 8 # relative spend/latency estimate, NOT currency; catalog-defined scale
  rationale: Infra mistakes dominate token spend; xhigh thinking is deliberate.
controls:
  model: anthropic/claude-opus-4
  thinking: xhigh
```

`budget.units` stays deliberately relative (the doc's existing weighting guidance — thinking_weight low=1 / medium=2 / high=4 / xhigh=8 — moves into the schema description). Outfitter surfaces it (`outfitter profile list` column, session-start line, audit log) but never converts to currency.

**Policy constraints** — in `org_policy`:

```yaml
org_policy:
  models:
    approved:
      - anthropic/claude-sonnet-4
      - anthropic/claude-opus-4
      - openai/gpt-4.1-mini
      - openai/gpt-4.1
    # Optional per-role tightening; keys are profile IDs (or glob patterns) from allowlisted sources.
    roles:
      support-triage:
        approved: [openai/gpt-4.1-mini]
        max_budget_units: 2
      platform-operator:
        max_thinking: xhigh
  default_role_budget:
    max_budget_units: 4 # roles not listed above
```

Semantics: after the merge produces the effective `model`/`thinking` (including project-local overrides — this is exactly the hole to close), the result is checked against `approved` (global, then role). Violations follow §4 enforcement. `max_budget_units` compares against the _declared_ `budget.units` of the resolved profile; a profile with no declaration counts as unknown → warn-grade violation when a max is set.

### Open questions

- Model ID drift: approved lists rot as providers rotate models. Support globs (`anthropic/claude-*`)? Proposal: exact IDs + trailing-`*` globs only.
- Is `max_budget_units` per-launch declaration checking actually useful without runtime metering? It is honest (it governs _configuration_, not spend) — but the docs must say clearly this is not billing enforcement. Runtime token metering is out of scope for this spec.
- Interaction with local inference / provider-less setups: approved lists should probably be per-provider optional.

### OSS / enterprise

**Split.** `budget.units` schema field, its display, and warn-grade approved-model checking: **OSS** (teams sharing a public catalog want the same hygiene). Per-role model policy under `enforce`, plus any future spend reporting built on audit data: **enterprise**. Same rule: the vocabulary and mechanism are open; the org-scale control posture is paid.

## 7. Feature E — Prompts-library / federated-context governance

### Design

The federated-context pattern already works mechanically: catalogs hold atomic prompt files (`/prompts/{codebases,teams,tools,models}/…`) and profiles compose them via `append_system_prompt` `{ file: … }` includes resolved from the catalog root. What is missing is the governance story — this feature is mostly **pattern + policy hooks**, not new runtime machinery:

- **Ownership:** the prompts library lives in the org catalog repo (or a dedicated `acme/outfitter-prompts` consumed as a second allowlisted source). Ownership is expressed with the host's native review controls — `CODEOWNERS` mapping `/prompts/teams/payments/**` to the payments platform leads, branch protection on the catalog repo, releases tagged (`v2026.07`) so `require_ref_pinning` (§3) means consumers only ever see _reviewed, released_ context.
- **Review flow:** documented convention (in the federated-context worked example, update-plan issue 34): propose prompt changes by PR; reviewers are the owning team plus the platform team; releases roll up prompt changes; orgs point `source_allowlist` refs at the new tag when ready. Rollback = repoint the ref.
- **Policy hooks (the only new mechanism):** because §3 pins sources and §5 records resolved commit SHAs per layer, every session is attributable to an exact reviewed state of the prompt library. No additional runtime feature is required for v1 beyond one guard: when `require_ref_pinning` is on, `{ repo_file: … }` includes (project-controlled, not catalog-controlled) get flagged in the audit record so orgs can see where non-governed context enters sessions.

### Open questions

- Should Outfitter verify prompt provenance more strongly (signed tags)? Defer; git host branch protection covers the realistic threat model for now.
- Do orgs need `only`/`except`-style filtering for prompt files (not just profiles)? Watch for demand from the worked example before designing.

### OSS / enterprise

**OSS**, essentially entirely: the pattern, docs, worked example, and the `repo_file` audit flag. Rationale: this is adoption surface — the thing that makes the catalog format worth standardizing on. Enterprise touchpoints arrive indirectly via §4 (`enforce` on ref pinning) and §5 (audit collectors), plus paid services (catalog/prompt-library setup and training — the services sketch from the field call) rather than a licensed feature.

## 8. OSS / enterprise boundary — summary

Default rule applied throughout: **mechanisms and schemas are OSS; org-scale policy posture and audit tooling are enterprise-licensed**, gated by `enterprise.*` home-settings booleans following the OFTR-004.2.10 precedent.

| Feature                                       | OSS                                                     | Enterprise                                                              |
| --------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------- |
| A. Pinned remote settings + source allowlists | All of it                                               | —                                                                       |
| B. Enforcement modes                          | Policy evaluation + `warn`                              | `enforce` (`enterprise.policy_enforcement`)                             |
| C. Session provenance audit                   | Local JSONL log, schema, `audit list`                   | Collectors/forwarders, retention, org reporting, `audit: required` rule |
| D. Model/cost policy                          | `budget.units` schema, display, warn-grade model checks | Per-role policy under enforce; spend reporting on audit data            |
| E. Federated-context governance               | Pattern, docs, worked example, `repo_file` audit flag   | — (monetized via services + B/C)                                        |

## 9. Implementation issues (proposed)

Sizes follow the update-plan convention (S ≤ half day, M 1–2 days, L 3+ days). Ordering respects dependencies.

1. **Settings schema: `pinned` remote_settings entries + `org_policy` block (validation only)** — S–M
2. **Policy evaluation engine: source-allowlist + ref-pinning checks, `warn` diagnostics** — M
3. **OFTR amendment: new requirement doc for org policy (OFTR-011), precedence carve-out spelled out against OFTR-002.6.6** — S
4. **Enforce mode behind `enterprise.policy_enforcement` (launch + sync refusal, prescribed error text)** — M
5. **Audit log v1: JSONL writer, session_start/end events, rotation, privacy redaction tests** — M
6. **`outfitter audit list` command** — S
7. **`budget` profile schema field + surfacing in `profile list` and session start line** — S–M
8. **Model-policy checks (global approved list, warn-grade) wired into policy engine** — M
9. **Per-role model/budget policy under enforce (enterprise)** — M
10. **`repo_file` include flagging in audit records when `require_ref_pinning` is set** — S
11. **Docs: governance guide for catalog admins (setup repo → policy repo → allowlist → audit), linked from the org-catalog use case** — M
12. **Enterprise collector interface spec (out-of-repo follow-up; defines the JSONL contract as stable)** — S (spec)

Dependencies: 1 → 2 → {4, 8}; 5 → {6, 10, 12}; 7 → 8 → 9; 3 alongside 1–2; 11 last.

## 10. References

- `docs/requirements/OFTR-002-settings.md` (settings precedence, profile sources, remote settings)
- `docs/requirements/OFTR-004-sync-and-setup.md` (sync caching, private-catalog enterprise precedent)
- `docs/documentation/usecases/orginization-profile-catalog.md` (role catalog + budget annotation pattern)
- `docs/plans/2026-07-01-comprehensive-assessment.md` §5–6 (market, enterprise wedge)
- `docs/plans/2026-07-01-update-plan.md` issues 24, 31, 32, 34
