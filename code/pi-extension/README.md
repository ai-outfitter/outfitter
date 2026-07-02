# Outfitter Pi extension

The Pi-native Outfitter runtime extension: startup header branding, the
Shift+Tab plan/build mode switch, and the native `/outfitter` onboarding
command (default catalog, custom profile, and remote catalog flows) plus the
automatic `/login` handoff when Pi has no connected model provider.

## Build and consumption

- `npm run build` type-checks against the real `@earendil-works/pi-tui` and
  `@earendil-works/pi-coding-agent` APIs (pi upgrades that change the API fail
  the build) and bundles `src/index.ts` into `dist/outfitter-extension.js` with
  esbuild. `@earendil-works/pi-tui` stays external because pi provides it at
  runtime.
- The CLI (`code/cli/src/cli/commands/PiLoginLaunch.ts`) writes the built
  artifact into the user's pi config directory and injects it via
  `--extension`. The published CLI package ships the artifact under
  `code/pi-extension/dist` (staged by `code/cli/scripts/sync-package-assets.mjs`).
- Runtime values (settings paths, profile catalog location, onboarding flags)
  are not interpolated into the source. The CLI writes
  `outfitter-extension.config.json` next to the artifact and points the
  `OUTFITTER_PI_EXTENSION_CONFIG` environment variable at it; see
  `src/config.ts` for the contract.

This workspace is not published independently; `private: true` in
`package.json` is npm publish protection, not repository privacy.
