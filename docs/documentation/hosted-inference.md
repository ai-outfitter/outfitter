# Outfitter inference

Sign in to your Outfitter account from the CLI and use Outfitter's personal
inference in Pi. Sign-in uses the OAuth 2.0 device authorization grant
([RFC 8628]): the CLI shows a code, you approve it in a browser signed in to
Outfitter, and the CLI receives short-lived credentials. No API key or
provider secret is copied to your machine. This is experimental, disabled by
default, and limited to personal inference: no organization selection or
billing.

## Enable

In your home `~/.agents/settings.yml`:

```yaml
experimental:
  outfitter_provider: true
```

Project settings and remote catalogs cannot enable it or change where it
connects. There is no environment-variable override. Your BYOK providers and
model selection are unchanged; no model is selected for you.

## Sign in

In Pi launched through Outfitter, run `/login`, choose **Outfitter**, then
**Open browser** or **Device code**. Or, from a terminal:

```sh
outfitter login               # opens your browser at the code
outfitter login --device-code # prints a URL and code (SSH, headless)
```

The browser page shows the code, the account you are signed in as, and what
the CLI may do. Approve only a code your terminal shows. The CLI finishes on
its own once you approve; Deny ends the request. Then choose the Outfitter
model from Pi's model selector.

Both paths use the same protocol and credential store.

## Credentials and sessions

Credentials live in Pi's auth store, `~/.pi/agent/auth.json`, scoped to the
origin that issued them; a credential from another origin is never sent. Access
tokens last 15 minutes and refresh automatically. Every refresh rotates the
refresh token, and the server ends the session if a replaced refresh token is
used again. A sign-in lasts 30 days.

Outfitter runs each Pi session with its own copy of `auth.json`. So that
concurrent sessions never reuse a replaced refresh token, every Outfitter
refresh goes through `~/.pi/agent/auth.json` under Pi's file lock. When a
session exits, its copy is written back under the same lock. The Outfitter
credential is written back only if the durable one is still the credential
the session started with. If another session rotated it, signed in or signed
out meanwhile, that state is kept, so an exiting session cannot restore a
replaced token or undo a logout. Other providers are written back from the
session as before.

## Sign out

`outfitter logout` or `/outfitter-logout` in Pi waits for the server to revoke
the session, then removes the local credentials; use one of these when you
need to know the sign-out finished.

Pi's native `/logout` is synchronous and returns before the server answers.
Outfitter marks the credential pending revocation in `~/.pi/agent/auth.json`,
under Pi's lock, before `/logout` returns, then revokes in the background. Pi
shows **Outfitter sign-out pending** at once, then **Outfitter session
revoked** or a failure; Pi's own logout message does not mean the server has
revoked anything. If Pi exits first, or revocation fails, the credential stays
marked, is not used, and revocation is retried at the next session start.
Revoking any refresh token the session was issued ends the whole session on
the server, including rotations another session made since. You can also sign
a CLI out from the web app under **Inference → Signed-in CLIs**.

Setting `outfitter_provider` to `false` hides the provider but does not revoke
credentials; `outfitter logout` still works. Server-side checks still apply;
opting in does not grant access.

## Test against a local or preview web app

`experimental.outfitter_origin` points sign-in and inference at another
Outfitter web app. It must be an HTTPS origin, or HTTP on `localhost`,
`127.0.0.1` or `[::1]`, with no path. It defaults to
`https://ai-outfitter.com`. Like the opt-in, only home settings can set it.
Credentials stay bound to the origin that issued them, so switching origins
needs a new `outfitter login`.

```yaml
experimental:
  outfitter_provider: true
  outfitter_origin: http://localhost:4390
```

To test an unreleased build without replacing your `outfitter` command, install
this checkout as `outfitter-dev`, and use a temporary home so your real Pi
credentials and settings stay untouched:

```sh
bin/dev-install-outfitter-dev --force
export HOME="$(mktemp -d)"
mkdir -p "$HOME/.agents"
printf 'experimental:\n  outfitter_provider: true\n  outfitter_origin: http://localhost:4390\n' > "$HOME/.agents/settings.yml"
outfitter-dev setup
outfitter-dev login --device-code
outfitter-dev run --profile default -- --model outfitter/GLM-5.3-Flash-EXL3
outfitter-dev logout
```

The model id is the web app's `AI_MODEL`; `/model` in Pi lists it once you are
signed in. Run the web app locally as its `docs/cli-device-authorization.md`
describes.
Pull-request previews are behind Cloudflare Access, which a desktop CLI cannot
pass, so test the CLI against a local web app until previews allow the OAuth
endpoints.

## Protocol

| Endpoint                      | Use                                                                                                                                       |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/oauth/device/code` | Start sign-in (`client_id: outfitter-cli`, `scope: inference`).                                                                           |
| `POST /api/oauth/token`       | Poll the device code; refresh. RFC 6749 errors (`authorization_pending`, `slow_down`, `access_denied`, `expired_token`, `invalid_grant`). |
| `POST /api/oauth/revoke`      | RFC 7009 revocation of the whole session.                                                                                                 |
| `GET /api/oauth/userinfo`     | The signed-in account.                                                                                                                    |
| `/api/inference/v1`           | OpenAI-compatible `models` and `chat/completions`, with streaming and tool calls.                                                         |

OAuth requests are form-encoded (`application/x-www-form-urlencoded`), as RFC
8628, RFC 6749 and RFC 7009 require; responses are JSON. No request follows
redirects. The verification URL must be on the configured origin.

[RFC 8628]: https://www.rfc-editor.org/rfc/rfc8628

## Isolated application state

Set `OUTFITTER_USER_HOME` to an absolute application-owned directory to keep
Outfitter settings, agents, and Pi credentials separate from the operating-system
home. Both `outfitter login` and `outfitter run` use this directory, and launched
Pi providers refresh and revoke credentials in the same durable location. Explicit
home-directory command dependencies take precedence. When the variable is absent
or empty, the usual OS home directory is used.

For example, a desktop application can configure its own `.agents/settings.yml`
and `.agents/agents/desktop/agent.md` under that directory, then invoke the published
`outfitter login` and `outfitter run desktop --harness pi -- --mode rpc` commands.
No source imports or development wrapper are required.
