# Outfitter hosted inference

Hosted inference is an opt-in preview. Your account must have access to the hosted service.
Enable the bundled Pi provider with `OUTFITTER_HOSTED_INFERENCE=1` when launching Outfitter.
Existing providers and explicitly selected models continue to work.

```sh
outfitter login
outfitter account
outfitter workspace org:123
outfitter usage
OUTFITTER_HOSTED_INFERENCE=1 outfitter run -- --provider outfitter --model <model-id>
```

Login prints a browser verification link and one-time user code. Approve the device in your browser.
The CLI and Pi's `/login outfitter` use the same OAuth flow and Pi credential format.
Credentials live in `~/.pi/agent/auth.json`, outside the project and catalog. Outfitter's normal
Pi credential persistence carries login and refreshes across temporary sessions.

`outfitter account` lists the available workspace IDs. `outfitter workspace <id>` changes the
workspace charged by this device session and refreshes model discovery. Restart a running Pi
session after switching to refresh its model selector. Requests never fall back to another payer.
A workspace switch affects subsequent requests from that device, including an already running Pi session.

Use `outfitter logout` to revoke the device session remotely and remove its local credentials.
Pi's native `/logout` removes local credentials only; use the CLI command when revocation is required.
Other providers' credentials remain intact. If revocation fails, the CLI keeps the credential so you
can retry; it does not report a successful logout.

Models are discovered from the authenticated gateway; OpenRouter and internal Spark credentials
never reach the CLI. Internal models appear only for entitled accounts. The provider uses Pi's
native OpenAI-compatible streaming implementation, including tool calls.

For development, `OUTFITTER_API_ORIGIN` overrides the default `https://ai-outfitter.com` origin.
Only HTTPS and loopback HTTP are accepted. Credentials are bound to their issuing origin;
changing the origin requires a new login. Remote redirects are rejected.
