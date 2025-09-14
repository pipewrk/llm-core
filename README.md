# @pipewrk/llm-core

Composable LLM pipelines and semantic chunking tools, written in TypeScript, ready for production.

<p align="center">
  <img src="./logo.png" alt="llm-core logo" width="360" />
</p>
<p align="center">
  <a href="https://github.com/pipewrk/llm-core/actions/workflows/coverage.yml">
    <img alt="Build Status" src="https://github.com/pipewrk/llm-core/actions/workflows/coverage.yml/badge.svg" />
  </a>
  <a href="https://codecov.io/gh/pipewrk/llm-core">
    <img alt="Code Coverage" src="https://codecov.io/gh/pipewrk/llm-core/branch/main/graph/badge.svg" />
  </a>
  <a href="https://www.npmjs.com/package/@jasonnathan/llm-core">
    <img alt="npm version" src="https://img.shields.io/npm/v/@jasonnathan/llm-core.svg" />
  </a>
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-Strict-blue?logo=typescript" />
  <img alt="Bun" src="https://img.shields.io/badge/Runtime-Bun-%23000000?logo=bun" />
  <img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-yellow.svg" />
</p>

## Table of Contents

- [Why Use `llm-core`?](#why-use-llm-core)
- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
  - [Set Up Environment](#set-up-environment)
- [Core Modules](#core-modules)

  - [`pipeline`](#pipeline)
  - [`OllamaService` and `OpenAIService`](#ollamaservice-and-openaiservice)
  - [`CosineDropChunker`](#cosinedropchunker)

- [Development](#development)
  - [Building the Project](#building-the-project)
  - [Running Tests](#running-tests)
  - [Release and Publish](#release-and-publish)

## `jasonnathan/llm-core`

`llm-core` is a lightweight, modular TypeScript library for building robust, production-ready data processing and Large Language Model (LLM) workflows. It provides a focused set of powerful tools designed to solve common but complex problems in preparing, processing, and orchestrating LLM-centric tasks.

It is unopinionated and designed to be composed into any existing application.

## What Makes `llm-core` Different?

While many libraries can connect to LLM APIs, `llm-core` excels by providing solutions for the practical, real-world challenges that arise when building serious applications.

- **Advanced Semantic Chunking**: Most libraries offer basic, fixed-size or recursive chunking. The `CosineDropChunker` is a significant step up, using semantic understanding to split content at natural topic boundaries. This is crucial for creating high-quality, contextually-aware chunks for Retrieval-Augmented Generation (RAG) systems, leading to more accurate results.

- **Pragmatic Workflow Orchestration**: The `pipeline` module provides a simple, powerful, and "no-frills" way to chain data processing steps. It avoids the complexity of heavier workflow frameworks while offering a flexible, type-safe structure to build and reuse complex sequences of operations.

- **Robust Local LLM Integration**: The `OllamaService` is more than just a basic API client. It includes first-class support for structured JSON output, response sanitization, and custom validation, making it easy to get reliable, machine-readable data from local models.

- **Modular and Unopinionated**: This library is not a monolithic framework. It's a toolkit. You can pick and choose the components you need - the chunker, the pipeline, the services - and integrate them into your existing application without being forced into a specific architecture.

## Features

- **Service Connectors**: Type-safe clients for OpenAI and Ollama APIs with built-in retry logic.
- **Smart Chunking**: Advanced text and Markdown chunking based on semantic similarity (`CosineDropChunker`).
- **Markdown Splitting**: Intelligently splits Markdown content while preserving its structure, ideal for preprocessing.
- **Pipelining**: A simple, generic, and powerful pipeline builder to chain data processing steps.
- **Type-Safe**: Fully written in TypeScript to ensure type safety across your workflows.
- **Environment-Aware**: Easily configured through environment variables.

## Installation

Install the package using your preferred package manager:

```bash
bun install @jasonnathan/llm-core
```

```bash
npm install @jasonnathan/llm-core
```

## Quick Start

### 1. Set Up Environment

Create a `.env` file in your project root to configure the LLM services:

```env
# For OpenAI
OPENAI_API_KEY="sk-..."
OPENAI_ENDPOINT="https://api.openai.com"

# For Ollama
OLLAMA_ENDPOINT="http://localhost:11434"
```

That’s it, once your environment is configured, you’re ready to import only what you need from llm-core and start composing robust, production-ready LLM workflows.

## Core Modules

Overview of the main building blocks you’ll use in applications.

### `pipeline`

The `pipeline` module provides a lightweight, context‑based way to orchestrate data‑processing workflows. You provide a single context object which can be your `logger`, `counters`, `cache` or any other shared state. You then build the pipeline by chaining curried steps: 

> each step receives that context and the current document, applies a synchronous or asynchronous transformation, and can optionally pause processing.

#### Example: Building a Question Generation Pipeline

Here's a simplified pipeline that processes documents to generate questions.

```js
import { pipeline } from "@jasonnathan/llm-core";

// 1) Build your context once
const ctx = {
  logger: console,
  pipeline: {},
  state: { history: [] },
};

// 2) Define your steps as curried functions
const collectContentStep = (ctx) => async (docs) => {
  ctx.logger.info("Collecting content…");
  return [
    ...docs,
    { source: "doc1.md", content: "Pipelines are great.", questions: [] },
    { source: "doc2.md", content: "They’re easy to use.", questions: [] },
  ];
};

const generateQuestionsStep = (ctx) => async (docs) => {
  ctx.logger.info("Generating questions…");
  return docs.map((doc) => ({
    ...doc,
    questions: [`What is the main point of ${doc.source}?`],
  }));
};

// 3) Assemble and run
const questionPipeline = pipeline(ctx)
  .addStep(collectContentStep)
  .addStep(generateQuestionsStep);

;(async () => {
  const result = await questionPipeline.run([]);
  console.log(JSON.stringify(result, null, 2));
})();
```

And here's the same thing in typescript:

```ts
import { pipeline, PipelineStep } from "@jasonnathan/llm-core";

interface QuestionDoc {
  source: string;
  content: string;
  questions: string[];
}

// 1) Define your application context shape
type Ctx = {
  logger: Console;
  pipeline: {
    retries?: number;
    timeout?: number;
    cache?: Map<any, unknown>;
    stopCondition?: (doc: QuestionDoc[]) => boolean;
  };
  state: { history: Array<{ step: number; doc: QuestionDoc[] }> };
};

const ctx: Ctx = {
  // your own fields
  logger: console,

  // pipeline helper slots (empty for defaults)
  pipeline: {},

  // internal state for stream/resume
  state: { history: [] },
};

// 2) Define steps; each is (ctx) => (doc) => T | PipelineOutcome<T>
const collectContentStep: PipelineStep<QuestionDoc[], QuestionDoc[], Ctx> = (ctx) => async (docs) => {
  ctx.logger.info("Collecting content…");
  return [
    ...docs,
    { source: "doc1.md", content: "Pipelines are great.", questions: [] },
    { source: "doc2.md", content: "They’re easy to use.", questions: [] },
  ];
};

const generateQuestionsStep: PipelineStep<QuestionDoc[], QuestionDoc[], Ctx> = (ctx) => async (docs) => {
  ctx.logger.info("Generating questions…");
  return docs.map((doc) => ({
    ...doc,
    questions: [`What is the main point of ${doc.source}?`],
  }));
};

// 3) Build and run the pipeline
const questionPipeline = pipeline<Ctx, QuestionDoc[]>(ctx)
  .addStep(collectContentStep)
  .addStep(generateQuestionsStep);

async function main() {
  const initial: QuestionDoc[] = [];
  const result = await questionPipeline.run(initial);
  console.log(JSON.stringify(result, null, 2));
}

main();

```

That's how simple and powerful the pipeline abstraction is, allowing you to compose steps and inject logging or other effects across the whole workflow. For detailed usage and advanced examples, see the **[Pipeline Module Developer Guide](./PIPELINE.md)**.

TL;DR

- Compose with `pipeline<Ctx, Initial>(ctx).addStep(...).addStep(...).addStep(...)`.
- `run(initial)` returns the final output; if a step pauses, it resolves early with the last completed doc.
- `stream(initial, [resume])` yields `{progress|pause|done}` and provides a resume token you can feed back to `stream`/`next`.
- `next(initial, [resume])` advances one step at a time for UI/CLI drivers.

### OpenAI and Ollama services

Functional, pipeline-aware facades for OpenAI and Ollama with typed JSON responses and embeddings. Configure context once and call helpers.

```ts
import { createOllamaContext, generatePromptAndSend } from "@jasonnathan/llm-core";

const ctx = createOllamaContext({ ollama: { model: "llama3:8b-instruct-q8_0" } });

async function getGreeting() {
  const response = await generatePromptAndSend<{ greeting: string }>(
    ctx,
    "You are a friendly assistant.",
    "Provide a JSON greeting: {greeting}",
    { schema: { type: "object", properties: { greeting: { type: "string" } }, required: ["greeting"] } }
  );
  console.log(response.greeting);
}
```

For detailed usage and embeddings, see **[Ollama Facade Guide](./OLLAMA_SERVICE.md)**.

### `cosineDropChunker`

Split text or markdown by semantic similarity using a functional, context-driven chunker.

```ts
import { cosineDropChunker, createOllamaContext, embedTexts } from "@jasonnathan/llm-core";

const svc = createOllamaContext({ ollama: { model: "all-minilm:l6-v2" } });
const embed = (texts: string[]) => embedTexts(svc, texts);
const ctx = { embed, logger: console, pipeline: { retries: 0, timeout: 0 } };

async function chunkMyMarkdown() {
  const markdown = "# Title\n\nThis is the first paragraph. A second paragraph discusses a new topic.";
  const chunks = await cosineDropChunker(ctx as any, markdown, { type: "markdown", breakPercentile: 95 });
  console.log(chunks);
}
```

For a deep dive into semantic chunking and all configuration options, see the **[Semantic Chunker Developer Guide](./CHUNKER.md)**.

## Development

Guides for building, testing, and releasing this project.

### Building the Project

To build the project from the source, run:

```bash
bun run build
```

This command uses `tsup` to bundle the code and `tsc` to generate type declarations, placing the output in the `dist` directory.

### Running Tests

To run the test suite:

```bash
bun test
```

### Release and Publish

This project uses `standard-version` for versioning and changelog generation. To create a new release and publish to the configured NPM registry:

1.  Ensure your `.npmrc` and `.env` files are correctly configured.
2.  Run the release command, loading the environment variables:

```bash
# For a minor release
bun --env-file=.env release:minor

# For a patch release
bun --env-file=.env release:patch
```

This will bump the version, create a git tag, generate a changelog, and publish the package.

<p align="center">
  <sub>
    Proudly brought to you by 
    <a href="https://github.com/theGeekist" target="_blank">@theGeekist</a> and <a href="https://github.com/pipewrk" target="_blank">@pipewrk</a>
  </sub>
</p>
