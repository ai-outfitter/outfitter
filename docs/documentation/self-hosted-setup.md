# Self-hosted inference setup

Outfitter's first self-hosted slice detects a DGX Spark or Apple Silicon host, checks prerequisites,
prints a non-mutating plan, and derives a key-free endpoint descriptor. It does **not** install or
operate inference, Forgejo, Stalwart, identity, password-manager, Kubernetes, or networking services.
Installing the npm package never changes a service.

## Detect and plan

These commands are read-only and bypass telemetry initialization, state, and network activity:

```sh
outfitter self-hosted detect
outfitter self-hosted doctor
outfitter self-hosted plan --target dgx-spark --mode inference-only
outfitter self-hosted plan --target apple-silicon --mode inference-and-services \
  --service forgejo identity
outfitter self-hosted handoff --config ./self-hosted.yml
```

DGX Spark detection requires Linux arm64 plus an NVIDIA GPU reported as GB10 or DGX Spark. The
Spark plan documents the verified installed vLLM two-node TP2 mechanism and its pinned image; it is
a reference plan, not a portable installer. It preserves attribution to
[`MiaAI-Lab/GLM-5.3-Flash-EXL3-2x-DGX-Sparks`](https://github.com/MiaAI-Lab/GLM-5.3-Flash-EXL3-2x-DGX-Sparks)
and does not replace the installed recipe with the upstream project's newer TensorFold path.
Weights are not bundled, and the CLI makes no licensing claim for them.

Apple Silicon takes a separate external OpenAI-compatible-runtime route. The CUDA vLLM recipe is
never offered on macOS. Neither route joins Kubernetes; paired model serving and cluster membership
are separate operations.

## Review and apply configuration

Create a YAML file outside Outfitter and review it before applying:

```yaml
version: 1
target: dgx-spark
mode: inference-only
inference:
  label: Workshop Spark
  model: GLM-5.3-Flash-EXL3
  base_url: https://inference.example.com/v1
  credential_env: OUTFITTER_INFERENCE_API_KEY
  make_default: false
  setup_url: https://app.ai-outfitter.com/inference
```

`credential_env` names where the consumer obtains a secret; the secret itself must not appear in
YAML. URLs containing usernames, passwords, or any query string are rejected. Keep endpoints
authenticated and do not publish an unauthenticated inference service.

Review the plan, then cross the explicit persistence boundary:

```sh
outfitter self-hosted plan --target dgx-spark --mode inference-only
outfitter self-hosted apply --config ./self-hosted.yml
outfitter self-hosted handoff --config ./self-hosted.yml
```

Apply schema-validates the input, then atomically writes only canonical `config.yml` with mode
`0600` under `~/.outfitter/self-hosted/` (or `--out`). It reports `installed: false`: no installer
ran. Handoff validates YAML and derives the webapp's OpenAI-compatible provider fields while
replacing `apiKey` with an environment reference; it does not persist a redundant JSON artifact.
Registration is manual or through the authenticated `setup_url`; the CLI never registers
anonymously and never prints a key. The `/inference` setup page and provider contract are
a dependency on the separate webapp inference-provider change; availability depends on that
change being deployed to the selected site.

## Implemented and proposed boundary

- Implemented: host routing, telemetry-free read-only prerequisite checks and dry-run reference
  plans, schema-validated canonical YAML persistence, derived key-free JSON handoff, and diagnostic
  redaction.
- Not implemented: fresh inference installation, service lifecycle control, model/weight download,
  remote-host mutation, two-node automation, K3s join, or optional Forgejo/Stalwart/identity/password
  manager installers. Requested optional services are reported as unavailable, not successful.
