# Changelog

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
