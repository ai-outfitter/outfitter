# Enterprise Private Catalog Boundary

This document defines the enterprise/private profile catalog boundary for Outfitter. Private catalog support is an informational commercial-governance control, not DRM.

## Current public behavior remains the default

- First-run onboarding and setup continue to use the public default catalog, `github: ai-outfitter/default-profiles` with `path: profiles`.
- `outfitter setup` without an explicit setup source continues to write public default catalog settings.
- `outfitter sync` continues to use the existing profile-source URI/git synchronization path.
- Local, public GitHub shorthand, and public URI profile sources remain supported exactly as they are today.

## Enterprise-only scope

Private profile catalog repository support is an enterprise capability boundary. Enterprise policy and private-catalog behavior live under `code/enterprise/**`: shared policy in `code/enterprise/shared/privateCatalogPolicy.cjs`, CLI sync gating/settings mutation in `code/enterprise/cli/**`, Pi-native onboarding helpers in `code/enterprise/pi-extension/**`, and the package policy marker in `code/enterprise/privateCatalog.js`. Package asset staging copies that tree so the published package carries the same enterprise boundary modules.

The boundary may include enterprise-only policy descriptions and tests. Public CLI commands in `code/cli/src/**` import enterprise helpers for private-catalog policy, prompts, and source gating; public CLI code must not collect or validate credentials and must keep private-catalog handling informational rather than DRM.

## Credential policy

Outfitter does not collect, echo, persist, synthesize, or validate credentials for private profile catalogs. Future private repository access may rely on the user's existing local Git configuration, such as SSH agents, credential helpers, netrc, or CI-provided Git configuration, because current repository access delegates to `git`.

`~/.outfitter/settings.yml` is the source of truth for private catalog enablement:

```yaml
enterprise:
  private_profile_catalogs: true
```

For GitHub profile catalog sources declared with `github: owner/repo`, Outfitter may query `https://api.github.com/repos/{owner}/{repo}` before sync or Pi-native catalog import. Only an HTTP 200 response with JSON `private: true` is confirmed private. Public responses, HTTP failures, rate limits, 403/404 responses, network failures, malformed responses, unknown responses, and non-GitHub sources are not private signals and must not produce warnings, errors, or blocking behavior.

When a confirmed-private GitHub catalog is detected and the home setting is absent, interactive CLI setup/sync asks with:

```text
Private GitHub profile catalog detected: OWNER/REPO.

Private profile catalog support is covered by the Outfitter Enterprise license.
Review code/enterprise/LICENSE or your enterprise agreement before enabling.

Enable private profile catalogs in ~/.outfitter/settings.yml? [y/N]
```

Non-interactive CLI setup/sync skips that source with this informational copy:

```text
info: Private GitHub profile catalog detected: OWNER/REPO. Enable enterprise.private_profile_catalogs in ~/.outfitter/settings.yml after reviewing code/enterprise/LICENSE or your enterprise agreement.
```

Pi-native onboarding uses the same home setting and asks with:

```text
Private GitHub profile catalog detected: OWNER/REPO.

Private profile catalog support is covered by the Outfitter Enterprise license.
Review code/enterprise/LICENSE or your enterprise agreement before enabling.

Enable private profile catalogs in ~/.outfitter/settings.yml and use this catalog?
```

Choices are `Enable and continue` and `Cancel private catalog setup`. If the setting is already enabled, Outfitter does not show enterprise info or prompts.

This boundary does not add strict runtime blocking or detection of ambient Git credentials. If stricter private repository blocking is desired later, it should be designed as a separate feature with explicit requirements, user-facing behavior, and tests.

## Non-goals for this boundary

- No new private repository authentication flow.
- No credential prompts, storage, generated tokens, or mocked real credentials.
- No change to default public catalog selection.
- No warning/error output for public, unknown, inaccessible, malformed, non-GitHub, or otherwise unconfirmed-private catalog sources.
- No change to profile resolution, settings merge precedence, or composite profile assembly.

## Implementation guardrails

- Keep enterprise private-catalog policy, prompt copy, visibility classification, settings mutation, and source gating staged from `code/enterprise/**`; public CLI code may orchestrate those helpers but must not re-own the commercial policy.
- Keep public/default catalog tests passing unchanged.
- Keep all URI/error reporting credential-redacted where existing sync/setup code returns messages.
- Treat any future runtime behavior change as a separate requirements-backed feature, not as part of this boundary document.
