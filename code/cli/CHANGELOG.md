# Changelog

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
