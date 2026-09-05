# Changelog

## [1.15.1](https://github.com/ai-outfitter/outfitter/compare/v1.15.0...v1.15.1) (2026-09-05)


### Bug Fixes

* **setup:** connect a model provider right after .agents setup ([#374](https://github.com/ai-outfitter/outfitter/issues/374)) ([d4aca76](https://github.com/ai-outfitter/outfitter/commit/d4aca76217c77169ff74fa086f1edabf82a59a38))

## [1.15.0](https://github.com/ai-outfitter/outfitter/compare/v1.14.0...v1.15.0) (2026-09-04)


### Features

* **link:** project the composed tree into Claude Code and Codex homes ([#351](https://github.com/ai-outfitter/outfitter/issues/351)) ([b705a44](https://github.com/ai-outfitter/outfitter/commit/b705a449286311ee94be7ec79e89783a74efdef5))
* **settings:** compose agent defaults into every agent ([#350](https://github.com/ai-outfitter/outfitter/issues/350)) ([b38e099](https://github.com/ai-outfitter/outfitter/commit/b38e0995afc9a4085ea9e7a5321b31707c5e7d02))
* **settings:** project native harness defaults ([#355](https://github.com/ai-outfitter/outfitter/issues/355)) ([69a48e9](https://github.com/ai-outfitter/outfitter/commit/69a48e90700bbc9686672369589d260adbfbe88c))
* **setup:** community-profiles is the default catalog; engineer is the offered default ([#360](https://github.com/ai-outfitter/outfitter/issues/360)) ([2e5cf9b](https://github.com/ai-outfitter/outfitter/commit/2e5cf9bfcec02f7a749a6ac0e80d88594d9fdbcb))


### Bug Fixes

* **cli:** refuse to run on Node below the published floor ([#371](https://github.com/ai-outfitter/outfitter/issues/371)) ([64e588b](https://github.com/ai-outfitter/outfitter/commit/64e588bb32f8d933ffdafa0baed161dbfb4445d5)), closes [#368](https://github.com/ai-outfitter/outfitter/issues/368)
* **pi:** pass materialized skill directories to --skill ([#367](https://github.com/ai-outfitter/outfitter/issues/367)) ([f252000](https://github.com/ai-outfitter/outfitter/commit/f252000734e96b36e79b845378c35feaccc4acef))

## [1.14.0](https://github.com/ai-outfitter/outfitter/compare/v1.13.0...v1.14.0) (2026-09-02)


### Features

* **workflows:** enable explicit workflow roots ([#346](https://github.com/ai-outfitter/outfitter/issues/346)) ([1e4c020](https://github.com/ai-outfitter/outfitter/commit/1e4c020d1689ac148b782d76a7c86276fda64365))

## [1.13.0](https://github.com/ai-outfitter/outfitter/compare/v1.12.0...v1.13.0) (2026-08-31)


### Features

* **workflows:** expose machine-readable workflow resources ([#342](https://github.com/ai-outfitter/outfitter/issues/342)) ([a2d0a43](https://github.com/ai-outfitter/outfitter/commit/a2d0a4383b1b198b4d3a1f9ad05726051d7de346))

## [1.12.0](https://github.com/ai-outfitter/outfitter/compare/v1.11.0...v1.12.0) (2026-08-30)


### Features

* **cache:** repair sources before startup ([#340](https://github.com/ai-outfitter/outfitter/issues/340)) ([02652d1](https://github.com/ai-outfitter/outfitter/commit/02652d17806a5b32cdda9e78899497195f16a6fd))

## [1.11.0](https://github.com/ai-outfitter/outfitter/compare/v1.10.0...v1.11.0) (2026-08-20)


### Features

* **models:** project canonical registry across harnesses ([#324](https://github.com/ai-outfitter/outfitter/issues/324)) ([31bcdb6](https://github.com/ai-outfitter/outfitter/commit/31bcdb64df7d08fde894a2b6c38ed09eda54c7c5))

## [1.10.0](https://github.com/ai-outfitter/outfitter/compare/v1.9.0...v1.10.0) (2026-08-20)


### Features

* **claude:** inherit the user's Claude configuration by default ([#317](https://github.com/ai-outfitter/outfitter/issues/317)) ([1a8ba27](https://github.com/ai-outfitter/outfitter/commit/1a8ba271cef55346b8f9a3ac656d153ab231417e))

## [1.9.0](https://github.com/ai-outfitter/outfitter/compare/v1.8.1...v1.9.0) (2026-08-19)


### Features

* **profiles:** allow dot-namespaced agent slugs ([#302](https://github.com/ai-outfitter/outfitter/issues/302)) ([2625481](https://github.com/ai-outfitter/outfitter/commit/2625481db9288d5718401ebed3edb6f64ab194dd))

## [1.8.1](https://github.com/ai-outfitter/outfitter/compare/v1.8.0...v1.8.1) (2026-08-17)


### Bug Fixes

* **telemetry:** provision the PostHog project key ([#306](https://github.com/ai-outfitter/outfitter/issues/306)) ([d714070](https://github.com/ai-outfitter/outfitter/commit/d714070f4d7a5411641b06979e1e16ff177e1c85))

## [1.8.0](https://github.com/ai-outfitter/outfitter/compare/v1.7.1...v1.8.0) (2026-08-17)


### Features

* **cli:** add opt-outable PostHog analytics ([#300](https://github.com/ai-outfitter/outfitter/issues/300)) ([c5553c4](https://github.com/ai-outfitter/outfitter/commit/c5553c4f73212ff71439363b66af65ee4a95cbf3))


### Bug Fixes

* forward leading harness flags when run is the default command ([#242](https://github.com/ai-outfitter/outfitter/issues/242)) ([7c3dfaa](https://github.com/ai-outfitter/outfitter/commit/7c3dfaac8ce930724f7b0d037bca2bd53ce4dcd2))
* **projection:** stop reporting pi extensions as unsupported ([#305](https://github.com/ai-outfitter/outfitter/issues/305)) ([0d8ba57](https://github.com/ai-outfitter/outfitter/commit/0d8ba57887b3f903c60ec519d1c0db89b3659119))

## [1.7.1](https://github.com/ai-outfitter/outfitter/compare/v1.7.0...v1.7.1) (2026-08-14)


### Bug Fixes

* **engines:** publish an unbounded node range ([#263](https://github.com/ai-outfitter/outfitter/issues/263)) ([3fc2b6b](https://github.com/ai-outfitter/outfitter/commit/3fc2b6bde2235bfe5b9d94eef2acb54a97cb810c))
* harden quiet profile startup ([#297](https://github.com/ai-outfitter/outfitter/issues/297)) ([1f268cd](https://github.com/ai-outfitter/outfitter/commit/1f268cdf6a55909d53869b1da4db21a819f760c5))
* quiet successful profile startup ([#296](https://github.com/ai-outfitter/outfitter/issues/296)) ([3165ac6](https://github.com/ai-outfitter/outfitter/commit/3165ac60b6ea206851809d55d53d74fec358d6b3))

## [1.7.0](https://github.com/ai-outfitter/outfitter/compare/v1.6.0...v1.7.0) (2026-08-12)


### Features

* **sources:** fail on ambiguous resolution under --strict ([#289](https://github.com/ai-outfitter/outfitter/issues/289)) ([0ec08b2](https://github.com/ai-outfitter/outfitter/commit/0ec08b2da4a88319e05f0382ffb4bc687a84663d))
* **sources:** warn when sources disagree on a version or a slug ([#287](https://github.com/ai-outfitter/outfitter/issues/287)) ([e07ed28](https://github.com/ai-outfitter/outfitter/commit/e07ed28e39e5ef563263cc4aefead06a3fa5f28d))

## [1.6.0](https://github.com/ai-outfitter/outfitter/compare/v1.5.0...v1.6.0) (2026-08-11)


### Features

* project MCP servers into Claude launches and add Codex harness ([#264](https://github.com/ai-outfitter/outfitter/issues/264)) ([f35fa28](https://github.com/ai-outfitter/outfitter/commit/f35fa28529dc0a2c5565c0696cdcdf24c0ef7c53))
* resolve catalog-declared sources transitively (OFTR-004.6) ([#262](https://github.com/ai-outfitter/outfitter/issues/262)) ([b2dd1aa](https://github.com/ai-outfitter/outfitter/commit/b2dd1aa55177aad04f8e27e5e435aa560da25f63))
* **system:** system-scope extension hooks for outfitter run ([#268](https://github.com/ai-outfitter/outfitter/issues/268)) ([9f51540](https://github.com/ai-outfitter/outfitter/commit/9f5154093e0aa1fec85d7069481594916894ec4a))


### Bug Fixes

* **claude:** persist session history across the ephemeral projection root ([#272](https://github.com/ai-outfitter/outfitter/issues/272)) ([#273](https://github.com/ai-outfitter/outfitter/issues/273)) ([999693b](https://github.com/ai-outfitter/outfitter/commit/999693b02c85191a23fdd49464de5dae9a4f6f04))
* **claude:** seed credentials and workspace trust into the projection root ([#266](https://github.com/ai-outfitter/outfitter/issues/266)) ([#267](https://github.com/ai-outfitter/outfitter/issues/267)) ([256be0d](https://github.com/ai-outfitter/outfitter/commit/256be0d4942fc5e2a0938e5217ba7b8d9a439fbc))

## [1.5.0](https://github.com/ai-outfitter/outfitter/compare/v1.4.0...v1.5.0) (2026-08-07)


### Features

* **projection:** project loadout `tools` for pi and claude ([#256](https://github.com/ai-outfitter/outfitter/issues/256)) ([4d651ea](https://github.com/ai-outfitter/outfitter/commit/4d651eafcc6397d58ede62b29bf0ef70f8f15ccc))


### Bug Fixes

* **extensions:** compare the pinned git ref before trusting a cached extension ([#258](https://github.com/ai-outfitter/outfitter/issues/258)) ([20d658f](https://github.com/ai-outfitter/outfitter/commit/20d658f1d3cd644c42667811f4d864d6219d0a68))

## [1.4.0](https://github.com/ai-outfitter/outfitter/compare/v1.3.1...v1.4.0) (2026-08-04)


### Features

* make the container a reusable agent runtime ([#235](https://github.com/ai-outfitter/outfitter/issues/235)) ([95d271a](https://github.com/ai-outfitter/outfitter/commit/95d271a24650f9e3e3620e0b4b1eb9e9a38338ab))

## [1.3.1](https://github.com/ai-outfitter/outfitter/compare/v1.3.0...v1.3.1) (2026-08-03)


### Bug Fixes

* **claude:** append prompt documents through the flag Claude actually reads ([#248](https://github.com/ai-outfitter/outfitter/issues/248)) ([0b7d20b](https://github.com/ai-outfitter/outfitter/commit/0b7d20b87be6bef3a2fe10dd735f88988a525c1c))

## [1.3.0](https://github.com/ai-outfitter/outfitter/compare/v1.2.0...v1.3.0) (2026-07-31)


### Features

* **pi:** persist sessions across runs by default ([#243](https://github.com/ai-outfitter/outfitter/issues/243)) ([a1b2dd0](https://github.com/ai-outfitter/outfitter/commit/a1b2dd00f5a0ee93d43ab07821fe9f25619d9672))

## [1.2.0](https://github.com/ai-outfitter/outfitter/compare/v1.1.2...v1.2.0) (2026-07-28)


### Features

* **agents:** restore inheritance and prompt composition ([#232](https://github.com/ai-outfitter/outfitter/issues/232)) ([93afe71](https://github.com/ai-outfitter/outfitter/commit/93afe7177009134640ae013066e95831bb704980))

## [1.1.2](https://github.com/ai-outfitter/outfitter/compare/v1.1.1...v1.1.2) (2026-07-28)


### Bug Fixes

* **pi:** project selected subagents and MCP servers ([#229](https://github.com/ai-outfitter/outfitter/issues/229)) ([68cbcbe](https://github.com/ai-outfitter/outfitter/commit/68cbcbe79a00fa62e6a71b710e07c063a1a85db6))

## [1.1.1](https://github.com/ai-outfitter/outfitter/compare/v1.1.0...v1.1.1) (2026-07-27)


### Bug Fixes

* **setup:** ship the persona review journey ([#227](https://github.com/ai-outfitter/outfitter/issues/227)) ([50c87ba](https://github.com/ai-outfitter/outfitter/commit/50c87ba095fa0179af87bfb462a6a9e7fa2d0b55))

## [1.1.0](https://github.com/ai-outfitter/outfitter/compare/v1.0.3...v1.1.0) (2026-07-26)


### Features

* **cli:** add remote source sync with private-catalog gating ([#219](https://github.com/ai-outfitter/outfitter/issues/219)) ([72e6d19](https://github.com/ai-outfitter/outfitter/commit/72e6d19972ad06c71fc9319aeb549ce8d0c15fee))

## [1.0.3](https://github.com/ai-outfitter/outfitter/compare/v1.0.2...v1.0.3) (2026-07-25)


### Bug Fixes

* **run:** restore Pi profile identity UI ([#200](https://github.com/ai-outfitter/outfitter/issues/200)) ([e882a5f](https://github.com/ai-outfitter/outfitter/commit/e882a5fa8d4ff7a89a3f1269f5b6d5a60d489449))

## [1.0.2](https://github.com/ai-outfitter/outfitter/compare/v1.0.1...v1.0.2) (2026-07-22)


### Bug Fixes

* **container:** build release image with Nix ([2d9d981](https://github.com/ai-outfitter/outfitter/commit/2d9d981f353089ef5f8d7919d65630ab71356514))

## [1.0.1](https://github.com/ai-outfitter/outfitter/compare/v1.0.0...v1.0.1) (2026-07-22)


### Bug Fixes

* **ci:** standardize Node runtime on latest LTS ([795f4ed](https://github.com/ai-outfitter/outfitter/commit/795f4edac2cb6daed966fa7f1672e52a1be660d9))

## [1.0.0](https://github.com/ai-outfitter/outfitter/compare/v0.11.0...v1.0.0) (2026-07-22)


### ⚠ BREAKING CHANGES

* **cleanup:** Outfitter now uses the Dotagents .agents model and removes the legacy profile system, including profile commands, settings, schemas, inheritance, adapters, and compatibility paths. Use .agents agents with the run, list, validate, and dump command surface.

### Features

* **resolver:** agent-local resources (skills, knowledge, commands + mcp/hooks stubs) ([#192](https://github.com/ai-outfitter/outfitter/issues/192)) ([f384388](https://github.com/ai-outfitter/outfitter/commit/f384388e0601a901a7c94b29cee525d95b5b6f60))
* **run:** cache and project pi extensions from profile loadouts ([bc0d2c4](https://github.com/ai-outfitter/outfitter/commit/bc0d2c4743271fbaddb17d8a4f21a361a44cebc6))
* **run:** overlay agent-local pi config into the runtime root ([a88af75](https://github.com/ai-outfitter/outfitter/commit/a88af75eb96ec14886ee6d0440ecf7a887c2f648))
* **setup:** interactive .agents onboarding (explicit + implicit) ([#186](https://github.com/ai-outfitter/outfitter/issues/186)) ([b421577](https://github.com/ai-outfitter/outfitter/commit/b421577f806b3aeba10f2a61d9d7edfc9f6e3040))
* **setup:** restore auto sign-in and auto-start pi after onboarding ([bd5ee4b](https://github.com/ai-outfitter/outfitter/commit/bd5ee4b1507a041d2017f58ef68ede59c8db431a))
* **setup:** restore Pi-native onboarding ([5c00daa](https://github.com/ai-outfitter/outfitter/commit/5c00daa9212dfa6b48de987832acc2d375b2eb14))


### Code Refactoring

* **cleanup:** remove the legacy profile system; main fully green ([#181](https://github.com/ai-outfitter/outfitter/issues/181)) ([d236ac0](https://github.com/ai-outfitter/outfitter/commit/d236ac0897ef21ed215d762ac3ce2441ea5f70ec))

## [0.11.0](https://github.com/ai-outfitter/outfitter/compare/v0.10.0...v0.11.0) (2026-07-16)


### Features

* **skills:** file, directory, and glob targets for references, scripts, and assets ([#158](https://github.com/ai-outfitter/outfitter/issues/158)) ([536a8d3](https://github.com/ai-outfitter/outfitter/commit/536a8d375bd1b8389bc43170794c20db80293b02))


### Bug Fixes

* make the injected pi header extension width-aware (fixes [#162](https://github.com/ai-outfitter/outfitter/issues/162)) ([#163](https://github.com/ai-outfitter/outfitter/issues/163)) ([9ef0c28](https://github.com/ai-outfitter/outfitter/commit/9ef0c28d74a00fc252863af4416494ae7a6b2c32))

## [0.10.0](https://github.com/ai-outfitter/outfitter/compare/v0.9.0...v0.10.0) (2026-07-10)


### Features

* **run:** show the active profile in the pi TUI status line ([#145](https://github.com/ai-outfitter/outfitter/issues/145)) ([5015067](https://github.com/ai-outfitter/outfitter/commit/5015067bc8afa0ae13f1ae868018339b71f636eb))
* **skills:** implement catalog skill selection and reference materialization ([#155](https://github.com/ai-outfitter/outfitter/issues/155)) ([e26f73c](https://github.com/ai-outfitter/outfitter/commit/e26f73ccafefc7c5f0bbad5fc09feed02e3faf52)), closes [#149](https://github.com/ai-outfitter/outfitter/issues/149)
* **skills:** publish the bundled outfitter self-docs skill to pi and claude launches ([#154](https://github.com/ai-outfitter/outfitter/issues/154)) ([0998e14](https://github.com/ai-outfitter/outfitter/commit/0998e143e6baebcc6617860800aa32142bb63bd1))

## [0.9.0](https://github.com/ai-outfitter/outfitter/compare/v0.8.0...v0.9.0) (2026-07-07)


### Features

* **state:** implement the interactive prompt state-persistence strategy ([#134](https://github.com/ai-outfitter/outfitter/issues/134)) ([d76a085](https://github.com/ai-outfitter/outfitter/commit/d76a08593e3bf5f6038e88599bbfcf2d0fca7cd9))


### Bug Fixes

* **onboarding:** remove hardcoded bootstrap model from first-run pi launch ([#137](https://github.com/ai-outfitter/outfitter/issues/137)) ([bb1dfbd](https://github.com/ai-outfitter/outfitter/commit/bb1dfbddd88f7332060d061159c99aef5d57ee3e)), closes [#2](https://github.com/ai-outfitter/outfitter/issues/2)
* **run:** let launches proceed when a remote profile source has never synced ([#140](https://github.com/ai-outfitter/outfitter/issues/140)) ([f3a4a7e](https://github.com/ai-outfitter/outfitter/commit/f3a4a7e6d0274699b75e3093107eccdba7ece059))
* **state:** clean up composite temp dirs on exit, signals, and startup sweep ([#135](https://github.com/ai-outfitter/outfitter/issues/135)) ([b3f969f](https://github.com/ai-outfitter/outfitter/commit/b3f969f959c060e534ac7adeeb53e74801592b6d))
* **state:** handle symlink permission errors with a win32-only fallback via SafeSymlink ([#133](https://github.com/ai-outfitter/outfitter/issues/133)) ([20f385a](https://github.com/ai-outfitter/outfitter/commit/20f385a6a4af466124674dfbd086784157460f87))
* **sync:** resolve nested remote settings files ([#141](https://github.com/ai-outfitter/outfitter/issues/141)) ([68162a5](https://github.com/ai-outfitter/outfitter/commit/68162a56a74cb149e5c916748630bc6789f4101e))
* **sync:** speed up first boot with shallow clones, cache refresh, and progress output ([#138](https://github.com/ai-outfitter/outfitter/issues/138)) ([a18c4e3](https://github.com/ai-outfitter/outfitter/commit/a18c4e3c71de69da63f8cd1e9f8cacea34f334a8)), closes [#4](https://github.com/ai-outfitter/outfitter/issues/4)

## [0.8.0](https://github.com/ai-outfitter/outfitter/compare/v0.7.2...v0.8.0) (2026-07-02)


### Features

* point launched agents at bundled Outfitter user docs ([#123](https://github.com/ai-outfitter/outfitter/issues/123)) ([60ed967](https://github.com/ai-outfitter/outfitter/commit/60ed967a609b76389abf004aeb95f1dffa6399d6))
* Resolve shared profile skill paths for Pi ([#128](https://github.com/ai-outfitter/outfitter/issues/128)) ([fd1f535](https://github.com/ai-outfitter/outfitter/commit/fd1f5353a9a02f72589bb4676bea8e6a2bb094bb))


### Bug Fixes

* **launch:** suppress pi's false self-update notice for bundled launches ([#130](https://github.com/ai-outfitter/outfitter/issues/130)) ([fb2995b](https://github.com/ai-outfitter/outfitter/commit/fb2995b377a72577022043e830ef0adebfc4fe1a)), closes [#3](https://github.com/ai-outfitter/outfitter/issues/3)

## [0.7.2](https://github.com/ai-outfitter/outfitter/compare/v0.7.1...v0.7.2) (2026-07-01)


### Bug Fixes

* **onboarding:** create local profile source directory ([a380826](https://github.com/ai-outfitter/outfitter/commit/a38082658e02dde0ff7dca58fe26adf49171892d))

## [0.7.1](https://github.com/ai-outfitter/outfitter/compare/v0.7.0...v0.7.1) (2026-07-01)


### Bug Fixes

* **setup:** launch pi-native onboarding ([d3d920b](https://github.com/ai-outfitter/outfitter/commit/d3d920b44439b59374d41bb0c534958f3a74e3bc))


### Performance Improvements

* **pi:** cache git extensions before launch ([4f1b2bb](https://github.com/ai-outfitter/outfitter/commit/4f1b2bbac2f757358300ef0f0f04b488a842ecca))

## [0.7.0](https://github.com/ai-outfitter/outfitter/compare/v0.6.1...v0.7.0) (2026-06-30)


### Features

* **profiles:** support typed prompt file includes ([#96](https://github.com/ai-outfitter/outfitter/issues/96)) ([32571b5](https://github.com/ai-outfitter/outfitter/commit/32571b5b23168b99dea9c1128e4dbdf92782d0c9))


### Bug Fixes

* **run:** launch bundled pi so first run works without a global pi install ([#95](https://github.com/ai-outfitter/outfitter/issues/95)) ([735ebe9](https://github.com/ai-outfitter/outfitter/commit/735ebe9e34823074dd84cb378123f620bebfb3c5))
