<p align="center">
  <img src="./logo.png" alt="llm-core logo" width="360" />

  <h1 align="center">@jasonnathan/llm-core</h1>

  <p align="center">
    Lightweight, composable TypeScript tools for chunking, pipelining, and LLM orchestration.
  </p>

  <p align="center">
    <a href="https://github.com/jasonnathan/llm-core/actions/workflows/coverage.yml">
      <img alt="Build Status" src="https://github.com/jasonnathan/llm-core/actions/workflows/coverage.yml/badge.svg" />
    </a>
    <a href="https://codecov.io/gh/jasonnathan/llm-core">
      <img alt="Code Coverage" src="https://codecov.io/gh/jasonnathan/llm-core/branch/main/graph/badge.svg" />
    </a>
    <a href="https://www.npmjs.com/package/@jasonnathan/llm-core">
      <img
        alt="npm version"
        src="https://img.shields.io/npm/v/@jasonnathan/llm-core.svg"
      />
    </a>
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-Strict-blue?logo=typescript" />
    <img alt="Bun" src="https://img.shields.io/badge/Runtime-Bun-%23000000?logo=bun" />
    <img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-yellow.svg" />
  </p>
</p>

## Table of Contents

- [Why Use `llm-core`?](#why-use-llm-core)
- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
  - [Set Up Environment](#set-up-environment)
  - [Example: Building a Question Generation Pipeline](#example-building-a-question-generation-pipeline)
- [Core Modules](#core-modules)
  - [`pipeline`](#pipeline)
  - [`OllamaService` and `OpenAIService`](#ollamaservice-and-openaiservice)
  - [`CosineDropChunker`](#cosinedropchunker)
  - [`markdownSplitter`](#markdownsplitter)
- [Development](#development)
  - [Building the Project](#building-the-project)
  - [Running Tests](#running-tests)
  - [Release and Publish](#release-and-publish)

## `jasonnathan/llm-core`
`llm-core` is a lightweight, modular TypeScript library for building robust, production-ready data processing and Large Language Model (LLM) workflows. It provides a focused set of powerful tools designed to solve common but complex problems in preparing, processing, and orchestrating LLM-centric tasks.

It is unopinionated and designed to be composed into any existing application.

## Why Use `llm-core`?

While many libraries can connect to LLM APIs, `llm-core` excels by providing solutions for the practical, real-world challenges that arise when building serious applications.

- **Advanced Semantic Chunking**: Most libraries offer basic, fixed-size or recursive chunking. The `CosineDropChunker` is a significant step up, using semantic understanding to split content at natural topic boundaries. This is crucial for creating high-quality, contextually-aware chunks for Retrieval-Augmented Generation (RAG) systems, leading to more accurate results.

- **Pragmatic Workflow Orchestration**: The `pipeline` module provides a simple, powerful, and "no-frills" way to chain data processing steps. It avoids the complexity of heavier workflow frameworks while offering a flexible, type-safe structure to build and reuse complex sequences of operations.

- **Robust Local LLM Integration**: The `OllamaService` is more than just a basic API client. It includes first-class support for structured JSON output, response sanitization, and custom validation, making it easy to get reliable, machine-readable data from local models.

- **Modular and Unopinionated**: This library is not a monolithic framework. It's a toolkit. You can pick and choose the components you need - the chunker, the pipeline, the services - and integrate them into your existing application without being forced into a specific architecture.

## Features

- **🤖 Service Connectors**: Type-safe clients for OpenAI and Ollama APIs with built-in retry logic.
- **🧩 Smart Chunking**: Advanced text and Markdown chunking based on semantic similarity (`CosineDropChunker`).
- **✂️ Markdown Splitting**: Intelligently splits Markdown content while preserving its structure, ideal for preprocessing.
- **⛓️ Pipelining**: A simple, generic, and powerful pipeline builder to chain data processing steps.
- **✅ Type-Safe**: Fully written in TypeScript to ensure type safety across your workflows.
- **⚙️ Environment-Aware**: Easily configured through environment variables.

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

### 2. Example: Building a Question Generation Pipeline

The `pipeline` module is a powerful feature for creating complex, multi-step data processing workflows. This example demonstrates a simplified pipeline that processes documents to generate questions.

For a complete guide to the Pipeline API and its advanced features, please see the **[Pipeline Module Developer Guide](./PIPELINE.md)**.

```typescript
import { pipeline, createLogger, PipelineStep } from "@jasonnathan/llm-core";

// Define the shape of our data object
interface QuestionDoc {
  source: string;
  content: string;
  questions: string[];
}

// 1. Initialize a logger
const logger = createLogger();

// 2. Define pipeline steps
const collectContentStep: PipelineStep<QuestionDoc[]> =
  (logger) => async (docs) => {
    logger.info("Collecting content...");
    // In a real implementation, this would read from files or a database
    const newDocs = [
      { source: "doc1.md", content: "Pipelines are great.", questions: [] },
      { source: "doc2.md", content: "They are easy to use.", questions: [] },
    ];
    return [...docs, ...newDocs];
  };

const generateQuestionsStep: PipelineStep<QuestionDoc[]> =
  (logger) => async (docs) => {
    logger.info("Generating questions...");
    // In a real implementation, this would call an LLM
    return docs.map((doc) => ({
      ...doc,
      questions: [`What is the main point of ${doc.source}?`],
    }));
  };

// 3. Build the pipeline
const questionPipeline = pipeline<QuestionDoc[]>(logger)
  .addStep(collectContentStep)
  .addStep(generateQuestionsStep);

// 4. Run the pipeline
async function main() {
  const initialDocs: QuestionDoc[] = [];
  const result = await questionPipeline.run(initialDocs);

  console.log(JSON.stringify(result, null, 2));
  // Output:
  // [
  //   {
  //     "source": "doc1.md",
  //     "content": "Pipelines are great.",
  //     "questions": ["What is the main point of doc1.md?"]
  //   },
  //   {
  //     "source": "doc2.md",
  //     "content": "They are easy to use.",
  //     "questions": ["What is the main point of doc2.md?"]
  //   }
  // ]
}

main();
```

## Core Modules

### `pipeline`

The `pipeline` module allows you to chain together a series of processing steps to create sophisticated, reusable workflows. Each step is a function that receives the output of the previous one, making it easy to compose complex logic. It's generic, type-safe, and includes logging for each stage.

For detailed usage and advanced examples, see the **[Pipeline Module Developer Guide](./PIPELINE.md)**.

### `OllamaService` and `OpenAIService`

These services provide a consistent interface for interacting with Ollama and OpenAI APIs, handling requests, retries, and error handling. `OllamaService` is particularly powerful when paired with models that support structured JSON output.

For detailed usage, including structured JSON responses and embeddings, see the **[OllamaService Developer Guide](./OLLAMA_SERVICE.md)**.

**Usage:**

```typescript
import { OllamaService } from "@jasonnathan/llm-core";

const ollama = new OllamaService("llama3:8b-instruct-q8_0");

async function getGreeting() {
  const response = await ollama.generatePromptAndSend(
    "You are a friendly assistant.",
    "Provide a one-sentence greeting to a new user.",
    {}
  );
  console.log(response);
}
```

### `CosineDropChunker`

The `CosineDropChunker` is a sophisticated tool for splitting text or markdown based on semantic similarity. Instead of using fixed sizes, it finds natural breaks in the content's topics, resulting in more contextually coherent chunks. This is ideal for preparing data for RAG systems.

For a deep dive into semantic chunking and all configuration options, see the **[Semantic Chunker Developer Guide](./CHUNKER.md)**.

**Usage:**

```typescript
import { CosineDropChunker, OllamaService } from "@jasonnathan/llm-core";

const ollama = new OllamaService("mxbai-embed-large");
const embedFn = (texts: string[]) => ollama.embedTexts(texts);

const chunker = new CosineDropChunker(embedFn);

async function chunkMyMarkdown() {
  const markdown =
    "# Title\n\nThis is the first paragraph. A second paragraph discusses a new topic.";
  const chunks = await chunker.chunk(markdown, {
    type: "markdown",
    breakPercentile: 95,
  });
  console.log(chunks);
}
```

### `markdownSplitter`

This utility intelligently splits a Markdown document into smaller segments based on its structure (headings, paragraphs, code blocks, tables). It's useful for preprocessing documentation before embedding or analysis.

**Usage:**

```typescript
import { markdownSplitter } from "@jasonnathan/llm-core";
import fs from "fs/promises";

async function splitMarkdown() {
  const markdownContent = await fs.readFile("my-doc.md", "utf-8");
  const chunks = markdownSplitter(markdownContent);
  console.log(chunks);
}
```

## Development

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
