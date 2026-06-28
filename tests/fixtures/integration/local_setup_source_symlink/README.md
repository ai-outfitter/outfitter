# Local Setup Source Symlink

This fixture models `outfitter setup <local-path>` pointed at a shared local setup repository with a `.outfitter/` tree.

Expected behavior:

- copy/cache import remains the default setup-source mode;
- interactive setup may explicitly choose symlink mode;
- symlink mode links the selected target `.outfitter` to `source/.outfitter` so shared-profile edits are visible to later Outfitter runs;
- symlink mode refuses to replace a non-empty target `.outfitter`.

The integration test copies this fixture to a temp directory, chooses project-target symlink mode, and then verifies the project `.outfitter` is a symlink to the fixture source.
