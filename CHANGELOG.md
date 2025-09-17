# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

### [1.9.1](https://github.com/pipewrk/llm-core/compare/v1.9.0...v1.9.1) (2025-09-17)

## [1.9.0](https://github.com/pipewrk/llm-core/compare/v1.8.0...v1.9.0) (2025-09-16)

## [1.8.0](https://github.com/pipewrk/llm-core/compare/v1.7.1...v1.8.0) (2025-09-16)


### ⚠ BREAKING CHANGES

* **core:** internalize env module; prune prompts; document batch + service helpers

### Features

* **batch-openai:** add resumable batch pipeline, steps, adapter and public types ([5779fe0](https://github.com/pipewrk/llm-core/commit/5779fe0787bb84737f1d05de19cf6da87fbc435d))
* **batch-openai:** export batch pipeline types and remove unused prompts/env type re-exports ([29c9d49](https://github.com/pipewrk/llm-core/commit/29c9d494cb1ff2c6107c86d43192830b045f499f))
* **similarity:** WIP ([44e4f7d](https://github.com/pipewrk/llm-core/commit/44e4f7d0364330d43e390c09a4c02ad377770e74))


* **core:** internalize env module; prune prompts; document batch + service helpers ([db97d7b](https://github.com/pipewrk/llm-core/commit/db97d7b084c3e8615bf187da2fe43bf29f46533e))

### [1.7.1](https://github.com/pipewrk/llm-core/compare/v1.7.0...v1.7.1) (2025-09-14)

## [1.7.0](https://github.com/pipewrk/llm-core/compare/v1.6.1...v1.7.0) (2025-09-14)


### Features

* **chunker:** refactored ([2d493d1](https://github.com/pipewrk/llm-core/commit/2d493d17059a1516064a393e1f10803cc9ff1dc8))
* **pipeline helpers:** new helper and tests ([bdc0edf](https://github.com/pipewrk/llm-core/commit/bdc0edf82cd25068af304d88a1dd8712fe7ee43f))

### [1.6.1](https://github.com/pipewrk/llm-core/compare/v1.6.0...v1.6.1) (2025-09-14)

## [1.6.0](https://github.com/pipewrk/llm-core/compare/v1.5.1...v1.6.0) (2025-09-14)

### [1.5.1](https://github.com/pipewrk/llm-core/compare/v1.5.0...v1.5.1) (2025-09-14)


### Bug Fixes

* **helpers:** prevent OOM by resuming correctly in pipelineToTransform ([69c5fc3](https://github.com/pipewrk/llm-core/commit/69c5fc349eaba01bc3ce704c48939358e479a6b8))

## [1.5.0](https://github.com/pipewrk/llm-core/compare/v1.4.0...v1.5.0) (2025-09-14)


### Features

* **core:** optional context logger for LLM services; align helpers to new pipeline types ([8beac58](https://github.com/pipewrk/llm-core/commit/8beac588cb5df8f0209ce81937c747829f8e2251))

## [1.4.0](https://github.com/pipewrk/llm-core/compare/v1.3.8...v1.4.0) (2025-09-14)


### ⚠ BREAKING CHANGES

* **core:** Public types and signatures changed
- PipelineContext removed; PipelineStep is now (ctx) => (doc) with inferred ctx
- StreamEvent now carries a resume token; stream/next accept optional resume state
- Downstream helpers and tests must be updated to the new API

* **core:** rework pipeline to context-owned steps and resumable streaming ([c151a20](https://github.com/pipewrk/llm-core/commit/c151a201bbedb9e1dd5c0925a15ba65ee1513116))

### [1.3.8](https://github.com/pipewrk/llm-core/compare/v1.3.7...v1.3.8) (2025-08-24)


### Bug Fixes

* workflow failure in upload ([807cb65](https://github.com/pipewrk/llm-core/commit/807cb65c2357452da7bacd86b306666bd663c3e9))

### [1.3.7](https://github.com/pipewrk/llm-core/compare/v1.3.6...v1.3.7) (2025-08-24)


### Bug Fixes

* workflow failure ([e9a4e63](https://github.com/pipewrk/llm-core/commit/e9a4e63af9445c9646f8f8a49c8e1ce704c40a4a))

### [1.3.6](https://github.com/pipewrk/llm-core/compare/v1.3.5...v1.3.6) (2025-08-24)

### [1.3.5](https://github.com/jasonnathan/llm-core/compare/v1.3.4...v1.3.5) (2025-08-24)

### [1.3.4](https://github.com/jasonnathan/llm-core/compare/v1.3.3...v1.3.4) (2025-07-30)

### [1.3.3](https://github.com/jasonnathan/llm-core/compare/v1.3.2...v1.3.3) (2025-07-30)

### [1.3.2](https://github.com/jasonnathan/llm-core/compare/v1.3.1...v1.3.2) (2025-07-30)

### [1.3.1](https://github.com/jasonnathan/llm-core/compare/v1.3.0...v1.3.1) (2025-07-30)

## [1.3.0](https://github.com/jasonnathan/llm-core/compare/v1.2.3...v1.3.0) (2025-07-30)


### Features

* new pipeline and tests ([ee0ed3b](https://github.com/jasonnathan/llm-core/commit/ee0ed3b126bfcd5011b64494f875fdda8f763d36))

### [1.2.3](https://github.com/jasonnathan/llm-core/compare/v1.2.2...v1.2.3) (2025-07-23)

### [1.2.2](https://github.com/jasonnathan/llm-core/compare/v1.2.1...v1.2.2) (2025-07-23)

### [1.2.1](https://github.com/jasonnathan/llm-core/compare/v1.2.0...v1.2.1) (2025-07-23)

## [1.2.0](https://github.com/jasonnathan/llm-core/compare/v1.1.0...v1.2.0) (2025-07-23)

## [1.1.0](https://github.com/jasonnathan/llm-core/compare/v1.0.8...v1.1.0) (2025-07-23)


### Features

* added a stream interface to pipeline to allow pausing ([950e3d6](https://github.com/jasonnathan/llm-core/commit/950e3d6fd9afc8c911e39901afcea700b2166ddc))

### [1.0.8](https://github.com/jasonnathan/llm-core/compare/v1.0.6...v1.0.8) (2025-07-10)

### [1.0.7](https://github.com/jasonnathan/llm-core/compare/v1.0.6...v1.0.7) (2025-07-10)

### [1.0.6](https://github.com/jasonnathan/llm-core/compare/v0.4.0...v1.0.6) (2025-07-10)


### Features

* achieve 100% test coverage and refactor core modules ([481bcf5](https://github.com/jasonnathan/llm-core/commit/481bcf5d74976e698749f7a7dc71598319d78aa6))
* improve project branding and developer experience ([27a6309](https://github.com/jasonnathan/llm-core/commit/27a63098ff23bac1f807ef8e35d8cfa841f4faab))

### [1.0.5](https://github.com/jasonnathan/llm-core/compare/v1.0.4...v1.0.5) (2025-07-09)

### [1.0.4](https://github.com/jasonnathan/llm-core/compare/v1.0.1...v1.0.4) (2025-07-09)

### [1.0.3](https://github.com/jasonnathan/llm-core/compare/v1.0.2...v1.0.3) (2025-07-09)

### [1.0.2](https://github.com/jasonnathan/llm-core/compare/v1.0.1...v1.0.2) (2025-07-09)

### [1.0.1](https://github.com/jasonnathan/llm-core/compare/v1.0.0...v1.0.1) (2025-07-09)

## [1.0.0](https://github.com/jasonnathan/llm-core/compare/v0.4.0...v1.0.0) (2025-07-09)


### Features

* achieve 100% test coverage and refactor core modules ([481bcf5](https://github.com/jasonnathan/llm-core/commit/481bcf5d74976e698749f7a7dc71598319d78aa6))
* improve project branding and developer experience ([27a6309](https://github.com/jasonnathan/llm-core/commit/27a63098ff23bac1f807ef8e35d8cfa841f4faab))

## [0.4.0](https://github.com/jasonnathan/llm-core/compare/v0.3.0...v0.4.0) (2025-07-09)

## [0.3.0](https://github.com/jasonnathan/llm-core/compare/v0.2.0...v0.3.0) (2025-07-09)

## [0.2.0](https://github.com/jasonnathan/llm-core/compare/v0.1.3...v0.2.0) (2025-07-09)


### Features

* Add chunking and similarity modules ([64ff24e](https://github.com/jasonnathan/llm-core/commit/64ff24eb2e0b88e8262fe593e3e31767f78da58a))

### [0.1.3](https://github.com/jasonnathan/llm-core/compare/v0.1.2...v0.1.3) (2025-06-27)

### [0.1.2](https://github.com/jasonnathan/llm-core/compare/v0.1.1...v0.1.2) (2025-06-27)

### 0.1.1 (2025-06-24)


### Features

* **config:** add updated site/category/ignore configs ([f87826b](https://github.com/jasonnathan/llm-core/commit/f87826b5622158d6d9d79e5f8129c7b662bcf2a9))
* **ml:** add classification and ML service modules ([fee2b22](https://github.com/jasonnathan/llm-core/commit/fee2b2225ce72feb4ffcbc319fc4c08c88eb6e33))
