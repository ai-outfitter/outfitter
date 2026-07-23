# Channels

A **channel** is an external source of work an agent watches — a mailbox, Signal,
GitHub notifications. The [`ai-outfitter/channels`](https://github.com/ai-outfitter/channels)
Pi extension turns each channel's native push into an **idle-gated wake**, so an
agent runs a turn only when a channel has real work instead of polling on a timer.
Multiple channels run at once and feed one notification queue.

Channels split cleanly across two resources you compose in a loadout:

- the **extension** (`channels`) — *when* to wake the agent (the push transport);
- a **skill** per channel — *how* the agent reads and replies (`mail`,
  `signal-responder`, `slack-responder`, … from the community catalog).

The wake is a trusted, body-free ping; the skill fetches the untrusted message
content, so channel data never enters the session as instructions (the same trust
rule as [skill references](./skills.md)).

## Add channels to an agent

Select the extension and the channel's skill in the agent's [loadout](./agents.md):

```markdown
---
name: email-assistant
skills: [mail]
extensions: [git:github.com/ai-outfitter/channels]
model: your-model
---
```

Because an [agent *is* the profile](./profiles.md) and loadout slugs **merge by ID
across layers**, selecting several channels reuses the **one** `channels`
extension — it is deduplicated to a single load. A multi-channel agent is just
more skills plus the same extension:

```markdown
---
name: personal-assistant
skills: [mail, slack-responder, signal-responder]
extensions: [git:github.com/ai-outfitter/channels]
---
```

All configured channels feed a single notification queue; each wake names the
channels with activity and the agent drains them with the matching skill. The
[`community-profiles`](https://github.com/ai-outfitter/community-profiles) catalog
publishes ready-made `email-assistant` / `slack-assistant` / `signal-assistant`
profiles and a composed `personal-assistant`.

## Select which channels run

`OUTFITTER_CHANNELS` chooses the active channels; unset means **auto-detect** —
every channel whose credentials are present starts. So composing a channel into an
agent is really just supplying its credentials.

| `OUTFITTER_CHANNELS` | Behavior |
| --- | --- |
| unset | Auto-detect by credentials |
| `jmap,signal` | Exactly those channels |
| `off` / `none` | Disabled |

## Credentials per channel

Each channel reads the same environment variables as its skill. Supply them the
Outfitter way for where the agent runs:

- **Local runs** — export them in the shell before `outfitter run` (see the
  [channels README](https://github.com/ai-outfitter/channels) for the bare-pi
  flow).
- **In-cluster** — project them as env from Secrets via the Kubernetes operator;
  the operator exposes referenced Secrets without inspecting them, and the keys
  inside are each channel's contract.

| Channel | Skill | Variables |
| --- | --- | --- |
| `jmap` (email over JMAP) | `mail` | `XIN_BASE_URL`, `XIN_BASIC_USER`, `XIN_BASIC_PASS` |
| `signal` | `signal-responder` | `SIGNAL_NUMBER`, `SIGNAL_CLI_CONFIG` |
| `github` | `gh` / a GitHub skill | `GITHUB_TOKEN`, optional `GITHUB_NOTIFY_FILTERS` (default `review_requested,assigned_issue`), `GITHUB_NOTIFY_POLL_MS` |

## Running resident

A channel watcher opens push connections for the life of a session, so it needs a
long-running agent — an interactive session, `--mode rpc`, or an always-on
in-cluster deployment. Session switches reopen the connections; one-shot print runs
are not suitable.

## See also

- [`ai-outfitter/channels`](https://github.com/ai-outfitter/channels) — the
  extension, its sources, per-channel setup, and design.
- [Skills](./skills.md) — the channel skills the agent pairs with.
- [Agents](./agents.md) / [Profiles](./profiles.md) — loadout and composition.
