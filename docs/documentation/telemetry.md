# Telemetry

Outfitter collects pseudonymous product analytics to measure command adoption and reliability. Telemetry is enabled by default and can be disabled at any time.

The first command that would send an event prints a one-time notice to stderr. The notice explains what is collected, what is excluded, and how to opt out. When the distributed build has no configured PostHog API key, telemetry is inert: it creates no client or state, sends no events, and prints no notice.

## Event contract

Outfitter sends exactly two event types: `cli command started` and `cli command completed`.

Both events contain only these properties:

| Property                  | Values                                                                                                                |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `command`                 | A registered top-level command (`run`, `setup`, `sync`, `list`, `validate`, `dump`, or `telemetry`), or `unknown`.    |
| `outfitter_version`       | The installed Outfitter version.                                                                                      |
| `node_major`              | The integer Node.js major version.                                                                                    |
| `os_family`               | `aix`, `android`, `darwin`, `freebsd`, `linux`, `openbsd`, `sunos`, `win32`, or `unknown`.                            |
| `arch`                    | `arm`, `arm64`, `ia32`, `loong64`, `mips`, `mipsel`, `ppc`, `ppc64`, `riscv64`, `s390`, `s390x`, `x64`, or `unknown`. |
| `interactive`             | `true` or `false`.                                                                                                    |
| `harness`                 | `pi`, `claude`, `codex`, or `unknown`.                                                                                |
| `strict`                  | `true` or `false`.                                                                                                    |
| `is_ci`                   | `true` when a CI environment is detected; otherwise `false`.                                                          |
| `ci_name`                 | Lowercased `ci-info` vendor ID, `unknown` for unidentified CI, or `none` outside CI.                                  |
| `$process_person_profile` | Always `false`; PostHog does not create or update a person profile.                                                   |

The completed event also contains:

| Property               | Values                             |
| ---------------------- | ---------------------------------- |
| `outcome`              | `success` or `error`.              |
| `duration_bucket`      | `<1s`, `1-5s`, `5-30s`, or `30s+`. |
| `exit_code_class`      | `success` or `error`.              |
| `warning_count_bucket` | `0`, `1-5`, `5+`, or `unknown`.    |

The CLI boundary does not currently have a warning counter, so `warning_count_bucket` is always `unknown`. GeoIP enrichment is disabled on the PostHog client.

## Data never collected

Outfitter never sends command arguments, pass-through arguments, prompts or responses, paths, repository data, agent or profile names, settings, environment values, error text, stack traces, session identifiers, child-process output, hostnames, usernames, or hardware identifiers.

Outside CI, the pseudonymous installation identifier is a random UUID. It is created lazily on the first capture and stored with the one-time-notice flag at `$XDG_STATE_HOME/outfitter/telemetry.json`, or `~/.local/state/outfitter/telemetry.json` when `XDG_STATE_HOME` is unset or blank. It is deliberately kept outside `~/.agents` so it cannot be committed with shared configuration.

In CI, telemetry remains enabled according to the same consent rules and events are sent with `is_ci: true` and the detected `ci_name`. All runs from one CI vendor share a synthetic identifier such as `ci.github_actions`; unidentified CI uses `ci.unknown`. CI runs do not read or create `telemetry.json` and do not print the first-run notice. Set `CI=false` exactly to bypass CI detection and use the normal non-CI UUID identity and state behavior.

## Control telemetry

The source-of-truth setting is `telemetry.enabled` in `~/.agents/settings.yml`:

```yaml
telemetry:
  enabled: false
```

Telemetry defaults to enabled when the setting is absent. Only user and user-local settings can enable it. A `false` value in user, user-local, project, or project-local settings disables it; remote or catalog settings cannot enable telemetry.

If an applicable settings file cannot be parsed or validated, telemetry fails closed. `outfitter telemetry status` reports the source as `invalid settings` until the settings error is corrected.

Use the CLI to inspect or change the setting:

```sh
outfitter telemetry status
outfitter telemetry enable
outfitter telemetry disable
```

`disable` also deletes the pseudonymous installation identifier. The commands preserve unrelated YAML settings and comments.

These environment variables disable capture for the current process:

- `OUTFITTER_TELEMETRY=0`
- `DO_NOT_TRACK=1`

At exit, Outfitter gives queued analytics at most 1000 ms to shut down. Analytics failures or dropped networks never change command output, behavior, or exit status. They never delay exit beyond that budget.
