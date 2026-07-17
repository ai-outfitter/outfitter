# Tasks

> **Status: future RFC.** Tasks are not part of the dotagents end state described here. This page is a placeholder for a concept that will be specified separately.

A task is intended to be a named, portable execution contract — the stable objective of a repeatable unit of work, the resources it composes, its structured input and output contract, and what "done" means — together with a **bake** step that freezes that contract and its inputs into an immutable, deterministic artifact for headless execution (CI, scheduled jobs, delegated work).

That surface — `tasks/<id>/task.md`, structured `inputs`, `outfitter task bake`, and task-backed [actions](./actions.md) — raises its own design questions (input trust boundaries, determinism guarantees, DeepWork job selection, adapter coverage) and will be worked out in a dedicated RFC rather than folded into this one.

Until then:

- Run work interactively by selecting an [agent](./agents.md): `outfitter run <agent-id>`.
- Inspect exactly what an agent composes with [`outfitter dump`](./dump-and-bake.md).
- For headless GitHub Actions runs today, see [Actions](./actions.md), which runs an agent non-interactively with structured inputs.
