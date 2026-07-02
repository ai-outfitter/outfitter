# Outfitter Pi extension

This workspace holds the source of the Pi-native Outfitter bootstrap extension.

`src/outfitter-extension.js` is the extension pi loads for every interactive
Outfitter-managed session. It brands the startup header, owns the
Outfitter-specific interactive shortcuts (Shift+Tab plan/build mode), registers
the native `/outfitter` onboarding command, and delegates credential entry to
Pi's native `/login` command.

## How it is loaded

Pi never imports this file from the repository or the npm package directly.
`code/cli/src/cli/commands/PiLoginLaunch.ts` reads the source at launch time,
replaces the `"__OUTFITTER_RUNTIME_VALUES__"` placeholder with a JSON object of
launch-specific values (home and project directories, onboarding flags, the
default settings template, and ASCII art), writes the stamped file into the Pi
agent directory, and passes it to pi via `--extension`.

The `@ai-outfitter/outfitter` package ships this workspace's `src/` folder under
`code/pi-extension/` (staged by `code/cli/scripts/sync-package-assets.mjs`) so
the packaged CLI can resolve the same source after install.

## Editing notes

- Keep the file dependency-free apart from `@earendil-works/pi-tui` (provided by
  pi at runtime) and the enterprise support modules copied next to the written
  extension (`./pi-extension/privateCatalogOnboarding.js`).
- Keep double quotes; the file is intentionally excluded from Prettier so the
  written output stays byte-stable for the CLI's behavioral tests
  (`code/cli/tests/unit/pi-login-launch.test.ts`), which evaluate the stamped
  extension in a VM.
- `private: true` in `package.json` is npm publish protection, not repository
  privacy; the source is published as an asset of `@ai-outfitter/outfitter`.
