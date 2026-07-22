# Outfitter Pi extension

This workspace holds the source of the two Pi-native Outfitter extensions.

`src/outfitter-extension.js` is the **setup walkthrough** extension. The CLI
loads it into an isolated, model-free, offline Pi shell to host the `/outfitter`
onboarding flow (profile catalog selection, install target, CLI-agent default).
It brands the startup header and owns the Outfitter interactive shortcuts
(Shift+Tab plan/build mode). Per `OFTR-010.1.4` the setup shell MUST NOT open
`/login`, so this file is deliberately free of any credential prompt.

`src/outfitter-runtime-extension.js` is the **real-session runtime** extension.
The CLI loads it into the selected profile's Pi session. It renders the combined
Outfitter and Pi version header, shows the active profile in Pi's status line,
and, when Pi starts with no models available, restores Outfitter's original
"Pi does not have a model provider connected yet — Connect a model provider"
confirmation before delegating to Pi's native `/login`. It never runs for
non-interactive Pi launches (`--print`, `--export`, `--mode json|print|rpc`).

## How they are loaded

Pi never imports these files from the repository or the npm package directly.

- The setup extension is stamped by
  `code/cli/src/cli/commands/SetupCommand.ts` (`createPiSetupExtensionContent`),
  which replaces each quoted `"__OUTFITTER_*__"` placeholder (for example
  `"__OUTFITTER_HOME__"` or `"__OUTFITTER_AUTO_OPEN__"`) with the JSON-encoded
  launch-specific value, then writes the stamped file into the isolated Pi agent
  directory and passes it to pi via `--extension`.
- The runtime extension is stamped by
  `code/cli/src/cli/commands/PiRuntimeLaunch.ts` with the active profile and
  installed Outfitter version, then written inside the ephemeral runtime tree
  and passed to interactive pi launches via `--extension`. The Pi version is
  imported through Pi's supported `@earendil-works/pi-coding-agent` extension
  alias, so it describes the Pi process that is actually running.

The `@ai-outfitter/outfitter` package ships this workspace's `src/` folder under
`code/pi-extension/` (staged by `code/cli/scripts/sync-package-assets.mjs`) so
the packaged CLI can resolve the same sources after install.

## Editing notes

- Keep both files dependency-free apart from Pi's supported runtime imports
  (`@earendil-works/pi-tui` and `@earendil-works/pi-coding-agent`) and, for the
  setup extension, the enterprise support modules copied next to the written
  extension (`./pi-extension/privateCatalogOnboarding.js`).
- `src/outfitter-extension.js` (setup) is intentionally excluded from Prettier so
  the stamped output stays byte-stable for the CLI's behavioral tests
  (`code/cli/tests/unit/pi-setup-extension.test.ts`), which evaluate the stamped
  extension in a VM. `src/outfitter-runtime-extension.js` is Prettier-formatted
  like normal source; its behavior is covered by
  `code/cli/tests/unit/pi-runtime-extension.test.ts`.
- `private: true` in `package.json` is npm publish protection, not repository
  privacy; the source is published as an asset of `@ai-outfitter/outfitter`.
