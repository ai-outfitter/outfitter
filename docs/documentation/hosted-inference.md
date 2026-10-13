# Internal Outfitter inference

Internal users can try one DGX Spark model through the website beta gateway. This is experimental, disabled by default, and requires an operator-approved GitHub account. Billing and workspace selection are not required.

Enable it in your home `~/.agents/settings.yml`:

```yaml
experimental:
  outfitter_provider: true
```

Project settings and remote catalogs cannot enable it. There is no environment-variable override. The gateway is fixed to `https://beta.ai-outfitter.com`; credentials are scoped to that origin.

Run `outfitter login` to open your default browser automatically. Sign in with GitHub and approve the CLI; the code is already filled in. The CLI finishes automatically after approval. If the browser cannot open, use the printed URL. For SSH or a headless terminal, use `outfitter login --device-code` to print a code without opening a browser. Alternatively, launch Pi through Outfitter, use `/login`, choose **Outfitter**, then choose **Open browser** or **Device code**. Both modes use the same device-approval protocol and credential store; the browser mode needs no localhost callback server. After approval, choose `outfitter/spark/glm-5.3-flash` from Pi's model selector. Existing model selections and BYOK providers are preserved; no model is selected automatically.

Credentials use Pi's native auth store at `~/.pi/agent/auth.json`. Outfitter's existing credential persistence seeds newly generated Pi sessions and copies changes back when the session exits. Tokens never belong in catalogs or project settings. Close an active Pi session before switching accounts from another terminal.

Use `outfitter logout` or `/outfitter-logout` inside Pi to revoke the device session remotely and remove its local credentials. Pi's native `/logout` also starts remote revocation. Because Pi's native logout API is synchronous, its initial status can precede the remote result; wait for **Outfitter session revoked**. A failed revocation retains a pending marker and retries at the next session start. Use `/outfitter-logout` for an explicitly awaited result. If revocation fails, credentials remain locally so it can be retried.

Set the option to `false` or remove it and restart to hide the provider. Disabling it does not revoke credentials; explicit `outfitter logout` remains available even when disabled. Requests and discovery are still authorized server-side; opting in does not grant access.

The experimental provider supports OpenAI-compatible streaming and tool calls through Spark. It does not add paid usage, OpenRouter, direct OpenAI/Anthropic routing, organization selection, or telemetry.
