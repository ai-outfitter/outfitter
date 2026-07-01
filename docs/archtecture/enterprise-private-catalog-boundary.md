# Enterprise Private Catalog Boundary

This document defines the enterprise/private profile catalog boundary for future Outfitter work. It is intentionally non-behavior-changing for the current CLI.

## Current public behavior remains the default

- First-run onboarding and setup continue to use the public default catalog, `github: ai-outfitter/default-profiles` with `path: profiles`.
- `outfitter setup` without an explicit setup source continues to write public default catalog settings.
- `outfitter sync` continues to use the existing profile-source URI/git synchronization path.
- Local, public GitHub shorthand, and public URI profile sources remain supported exactly as they are today.

## Enterprise-only scope

Private profile catalog repository support is an enterprise capability boundary. The current boundary code lives in `code/enterprise/privateCatalog.js` and is executed by package asset staging so the published package carries an explicit private-catalog enterprise policy artifact. Any future private-catalog enablement code must live under `code/enterprise/**` unless a later architecture decision deliberately promotes a shared primitive into `code/cli/src/**`.

The boundary may include enterprise-only types, adapters, policy descriptions, and tests that do not alter public runtime behavior. Public CLI commands in `code/cli/src/**` must not import enterprise private-catalog modules unless a future feature explicitly changes the product boundary and updates the relevant docs, requirements, and tests.

## Credential policy

Outfitter does not collect, echo, persist, synthesize, or validate credentials for private profile catalogs. Future private repository access may rely on the user's existing local Git configuration, such as SSH agents, credential helpers, netrc, or CI-provided Git configuration, because current repository access delegates to `git`.

For GitHub profile catalog sources declared with `github: owner/repo`, Outfitter may query `https://api.github.com/repos/{owner}/{repo}` before sync. A confirmed `private: true` response produces an `info:` message that points users to `code/enterprise/LICENSE` or their enterprise agreement. Public responses, HTTP failures, rate limits, 403/404 responses, and malformed responses are treated as `unknown` and do not produce warnings, errors, or blocking behavior.

This boundary does not add strict runtime blocking or detection of ambient Git credentials. If strict private repository blocking is desired later, it should be designed as a separate feature with explicit requirements, user-facing behavior, and tests.

## Non-goals for this boundary

- No new private repository authentication flow.
- No credential prompts, storage, generated tokens, or mocked real credentials.
- No change to default public catalog selection.
- No strict blocking of private repository URIs or ambient Git credentials.
- No warning/error output for private repository usage; confirmed private GitHub catalogs receive informational license guidance only.
- No change to profile resolution, settings merge precedence, or composite profile assembly.

## Implementation guardrails

- Keep private-catalog enablement behind enterprise-only files under `code/enterprise/**`.
- Keep package staging wired to `code/enterprise/privateCatalog.js` so enterprise policy code remains present, executed, and packaged without changing public sync/setup behavior.
- Keep public/default catalog tests passing unchanged.
- Keep all URI/error reporting credential-redacted where existing sync/setup code returns messages.
- Treat any future runtime behavior change as a separate requirements-backed feature, not as part of this boundary document.
