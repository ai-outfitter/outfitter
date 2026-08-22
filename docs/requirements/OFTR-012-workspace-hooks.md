# OFTR-012: Portable Workspace Hooks

## OFTR-012.1: Scope and discovery

1. Outfitter MUST discover portable hooks only at `<workspace>/.agents/hooks/<slug>/hook.yml`.
2. Outfitter MUST NOT discover portable hooks from global layers, configured sources, or agent-local hook directories.
3. Outfitter MUST order hooks by slug with locale-independent code-unit comparison.
4. A direct native harness launch MUST NOT run an Outfitter portable hook.

## OFTR-012.2: Manifest and snapshot

1. Outfitter MUST validate each `hook.yml` against a bundled JSON Schema at the read boundary.
2. A v1 manifest MUST contain `version`, `name`, `description`, and at least one supported event.
3. A v1 event MUST contain `command`, `args`, and `timeout_seconds`.
4. The manifest name MUST match its directory slug.
5. Outfitter MUST reject a symlink or non-regular file in a portable hook package.
6. Outfitter MUST capture each package file and mode in the composition before projection.
7. A source change after composition MUST NOT change the captured package.

## OFTR-012.3: Command safety

1. A command MUST start with `./` and MUST resolve to a regular file inside its hook package.
2. A command file MUST have at least one executable mode bit.
3. Outfitter MUST run a command with its declared argument array.
4. Outfitter MUST NOT run a portable command through a shell.
5. Outfitter MUST run the command from the active workspace.

## OFTR-012.4: Normalized event

1. Outfitter MUST write one JSON object to each hook command on stdin.
2. The object MUST contain `version`, `event`, `harness`, `workspace`, `hook`, and `continuation`.
3. The `hook` object MUST contain the hook `slug` and `name`.
4. The `continuation` object MUST contain `active` and `supported` booleans.

## OFTR-012.5: Result policy

1. Exit code 0 MUST allow the harness event.
2. Exit code 2 MUST request continuation when the harness supports continuation.
3. Outfitter MUST use command output as the continuation reason.
4. A timeout, signal, launch error, or other exit code MUST warn and fail open.

## OFTR-012.6: Continuation loops

1. Outfitter MUST expose the native or projected continuation state as `continuation.active`.
2. The Pi adapter MUST stop a second consecutive continuation request and MUST warn.
3. The Claude adapter MUST fail open and MUST warn when a hook requests continuation while `stop_hook_active` is true.

## OFTR-012.7: Claude projection

1. An inherited Claude launch MUST load the dispatcher through the temporary Outfitter plugin.
2. An isolated Claude launch MUST add the hook to temporary projected settings.
3. Claude projection MUST NOT change durable Claude settings.

## OFTR-012.8: Pi projection

1. A Pi launch MUST load a temporary extension through an explicit `--extension` argument.
2. The extension MUST map Pi `agent_end` to the portable `stop` event.
3. The extension MUST queue the continuation reason as a follow-up user message.
4. Pi projection MUST NOT change durable Pi settings.

## OFTR-012.9: Codex compatibility

1. Outfitter MUST NOT replace a user's Codex `notify` command.
2. Outfitter MUST NOT persist or bypass Codex hook trust for a temporary hook.
3. When a composition contains a stop hook, the Codex adapter MUST warn that it cannot safely project continuation.
4. The normal `--strict` warning policy MUST make this compatibility warning fatal before launch.
