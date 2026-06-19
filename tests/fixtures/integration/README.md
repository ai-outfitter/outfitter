# Integration Fixtures

Integration fixtures are complete synthetic Outfitter filesystem trees.
Tests copy a fixture to a temporary directory before running so the fixture source remains immutable.

## Required fixture shape

Each fixture set under this directory MUST include:

```text
<fixture>/
  README.md
  home/
  project/
```

A fixture MAY also include:

```text
<fixture>/
  cache/
  native/
  expected/
    composite profile-summary.json
    warnings.json
    durable-files-after.json
    pi/
    claude/
```

## Authoring rules

- The fixture root `README.md` explains the user/project setup, selected profile or profiles, expected state ownership, and mutation/write-back behavior under test.
- `home/` is the synthetic user home directory passed to Outfitter.
- `project/` is the synthetic project directory passed to Outfitter.
- Test code owns active mutation behavior.
  Fixture files provide static inputs and optional expected outputs.
- Adapter-specific expected outputs should be nested by adapter, for example `expected/pi/` or `expected/claude/`.
- Fixture names should describe the user/project situation rather than the adapter whenever possible.
