# Profile repositories

Bootstrap a machine or project from a shared setup repository:

```bash
outfitter setup https://github.com/my_account/outfitter_config
```

A setup repository usually contains either root-level Outfitter files:

```text
outfitter_config/
  settings.yml
  profiles/
    engineering-default/profile.yml
```

or a `.outfitter/` folder:

```text
outfitter_config/
  .outfitter/
    settings.yml
    profiles/
      engineering-default/profile.yml
    deepwork/jobs/
```

Run `outfitter sync` after changing remote settings or profile sources.
