# Channels

A **channel** is an external source of work an agent watches — a mailbox, Signal,
GitHub notifications, or a chat service. The
[`ai-outfitter/channels`](https://github.com/ai-outfitter/channels) Pi extension
owns those transports as source modules under `extensions/sources/`. A source
opens its push connection, daemon, or polling loop and sends an **idle-gated
wake** only when it detects matching work. Multiple sources can run at once and
feed one notification queue.

Every wake is a trusted, body-free signal. Sources that support exact-item
actions put only an opaque locator in the wake; the agent passes that locator
unchanged to `channel_read`, which returns the message inside explicit
untrusted-content markers. It replies through `channel_respond`. Signal-only
sources instead wake the agent to use that channel's existing client workflow.
In neither case does an external message enter the session as an instruction.

The extension and the response instructions have separate jobs:

- `git:github.com/ai-outfitter/channels` supplies event delivery and the common
  channel tools;
- skills and runbooks in the Channels repository teach the agent how to handle
  each source.

Those channel skills are not published by the `community-profiles` catalog. For
example, Channels currently carries its Slack workflow at
[`dev/slack-responder/SKILL.md`](https://github.com/ai-outfitter/channels/blob/main/dev/slack-responder/SKILL.md)
and its operational guides under
[`docs/runbooks/`](https://github.com/ai-outfitter/channels/tree/main/docs/runbooks).

## Add channels to an agent

Add the Channels extension source to the agent's [loadout](./agents.md):

```markdown
---
name: email-assistant
extensions: [git:github.com/ai-outfitter/channels]
model: your-model
---
```

Then follow the source-specific skill or runbook in the Channels repository and
provide that source's credentials. Do not add `mail`, `signal-responder`, or
`slack-responder` on the assumption that they are community-catalog skill IDs.
If you want to use the repository's development Slack skill, bring that skill
into a catalog you control and select its resulting local ID.

Because an [agent _is_ the profile](./profiles.md), a multi-channel agent still
loads the extension only once:

```markdown
---
name: personal-assistant
extensions: [git:github.com/ai-outfitter/channels]
---
```

All configured sources feed a single notification queue. Each wake names the
sources with activity and, when available, includes opaque locators for the
agent to pass to the common channel tools.

## Select which channels run

`OUTFITTER_CHANNELS` chooses the active channels; unset means **auto-detect** —
every channel whose credentials are present starts. So composing a channel into an
agent is really just supplying its credentials.

| `OUTFITTER_CHANNELS` | Behavior                   |
| -------------------- | -------------------------- |
| unset                | Auto-detect by credentials |
| `jmap,signal`        | Exactly those channels     |
| `off` / `none`       | Disabled                   |

## Credentials per channel

Each source reads its configuration from environment variables. Supply them the
Outfitter way for where the agent runs:

- **Local runs** — export them in the shell before `outfitter run` (see the
  [channels README](https://github.com/ai-outfitter/channels) for the bare-pi
  flow).
- **In-cluster** — project them as env from Secrets via the Kubernetes operator;
  the operator exposes referenced Secrets without inspecting them, and the keys
  inside are each channel's contract.

| Source                   | Delivery                                                 | Variables                                                                                            |
| ------------------------ | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `jmap` (email over JMAP) | JMAP state-change wake                                   | `XIN_BASE_URL`, `XIN_BASIC_USER`, `XIN_BASIC_PASS`                                                   |
| `signal`                 | `signal-cli` wake                                        | `SIGNAL_NUMBER`, `SIGNAL_CLI_CONFIG`                                                                 |
| `slack`                  | Socket Mode wake plus `channel_read` / `channel_respond` | `SLACK_APP_TOKEN`, `SLACK_BOT_TOKEN`, optional `SLACK_CHANNEL_IDS`                                   |
| `github`                 | filtered notification wake                               | `GITHUB_NOTIFY_TOKEN` (or `GITHUB_TOKEN`), optional `GITHUB_NOTIFY_FILTERS`, `GITHUB_NOTIFY_POLL_MS` |

This is only a quick orientation; the Channels README is the source of truth for
the complete source list, credentials, prerequisites, and behavior. For a
concrete email deployment, see its
[Google Workspace agent-mailbox runbook](https://github.com/ai-outfitter/channels/blob/main/docs/runbooks/agent-mailbox-google-workspace.md).

## Running resident

A channel watcher opens push connections for the life of a session, so it needs a
long-running agent — an interactive session, `--mode rpc`, or an always-on
in-cluster deployment. Session switches reopen the connections; one-shot print runs
are not suitable.

## See also

- [`ai-outfitter/channels`](https://github.com/ai-outfitter/channels) — the
  extension source, channel source modules, skills, runbooks, and setup.
- [Skills](./skills.md) — how to bring a repository-owned channel skill into a
  catalog and select it in a loadout.
- [Agents](./agents.md) / [Profiles](./profiles.md) — loadout and composition.
