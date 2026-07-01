# Outfitter Enterprise Code

Files in this directory and its descendants are licensed under the Outfitter Enterprise/Business Source License in [`LICENSE`](./LICENSE).

Everything outside `code/enterprise/**` is licensed under the root [`LICENSE.md`](../../LICENSE.md) terms.

`privateCatalog.js` defines the commercial boundary for private profile catalog support. Package staging imports it and emits `private-catalog-boundary.json` so the published package carries an executed enterprise policy artifact, while public sync/setup behavior remains non-enforcing and continues to rely on the user's ambient Git configuration.
