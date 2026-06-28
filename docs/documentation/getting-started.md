# Getting started

Install Outfitter globally:

```bash
npm install -g @ai-outfitter/outfitter
outfitter --help
```

Outfitter launches agent CLIs; install the agents you plan to use separately.

## First-time setup

Set up profiles from the Outfitter [default profiles repo](https://github.com/ai-outfitter/default-profiles), then launch the default profile:

```bash
outfitter setup
outfitter
```

## Common commands

```bash
outfitter run --profile engineering-default
outfitter run --agent claude --profile support
outfitter sync
outfitter welcome
outfitter profile list
outfitter profile create regulated --scope user
```

## Other install options

Upgrade a global install:

```bash
npm update -g @ai-outfitter/outfitter
```

Try without a global install:

```bash
npx --yes @ai-outfitter/outfitter@latest --help
```
