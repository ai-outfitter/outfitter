# Outfitter Enterprise Code

Files in this directory and its descendants are licensed under the Outfitter Enterprise/Business Source License in [`LICENSE`](./LICENSE).

Everything outside `code/enterprise/**` is licensed under the root [`LICENSE.md`](../../LICENSE.md) terms.

`privateCatalog.js` defines the package-visible commercial boundary for private profile catalog support. Shared policy lives in `shared/`, CLI sync/settings helpers live in `cli/`, and Pi-native onboarding helpers live in `pi-extension/`. Package staging imports the policy marker and emits `private-catalog-boundary.json` so the published package carries executed enterprise policy artifacts, while public sync/setup behavior remains non-enforcing and continues to rely on the user's ambient Git configuration.
