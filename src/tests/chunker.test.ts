import { beforeEach, describe, expect, beforeAll, test } from "bun:test";
import {
  CosineDropChunker,
  type ChunkOptions,
  type EmbedFunction,
} from "../core/chunker.ts";
import { MockLogger } from "./logger.mock.ts";
import type { MarkdownChunk } from "../core/markdown-splitter.ts";

// Tests for chunkText

describe("CosineDropChunker.chunkText", () => {
  const logger = new MockLogger();

  beforeEach(() => {
    logger.clear();
  });

  test("splits into individual sentences when bufferSize=1 and breakPercentile=100", async () => {
    const embeddings = [[1], [0], [1], [0]];
    const embedFn: EmbedFunction = async (_texts) => embeddings;
    const chunker = new CosineDropChunker(embedFn);
    (chunker as any).logger = logger;

    const text = "S1. S2. S3. S4.";
    const options: ChunkOptions = {
      bufferSize: 1,
      breakPercentile: 100,
      minChunkSize: 0,
      maxChunkSize: Infinity,
      overlapSize: 0,
    };

    const chunks = await chunker.chunk(text, options);
    expect(chunks).toEqual(["S1.", "S2.", "S3.\nS4."]);
  });

  test("returns full text when sentences <= bufferSize", async () => {
    const embeddings = [[0], [0]];
    const embedFn: EmbedFunction = async (_texts) => embeddings;
    const chunker = new CosineDropChunker(embedFn);
    (chunker as any).logger = logger;

    const text = "First. Second.";
    const options: ChunkOptions = {
      bufferSize: 3,
      breakPercentile: 50,
      minChunkSize: 0,
      maxChunkSize: Infinity,
      overlapSize: 0,
    };

    const chunks = await chunker.chunk(text, options);
    expect(chunks).toEqual([text]);
  });

  test("splits only on maximum jumps with breakPercentile=99", async () => {
    const embeddings = [[1], [1], [0], [0]];
    const embedFn: EmbedFunction = async (_texts) => embeddings;
    const chunker = new CosineDropChunker(embedFn);
    (chunker as any).logger = logger;

    const text = "A. B. C. D.";
    const options: ChunkOptions = {
      bufferSize: 1,
      breakPercentile: 99,
      minChunkSize: 0,
      maxChunkSize: Infinity,
      overlapSize: 0,
    };

    const chunks = await chunker.chunk(text, options);
    expect(chunks).toEqual(["A. B. C. D."]);
  });
});

// Tests with real-world fixture

describe("CosineDropChunker with real-world text", () => {
  let raw: string;
  const logger = new MockLogger();
  const fixtureURL = new URL(
    "../../data/pride-and-prejudice.txt",
    import.meta.url
  );

  beforeAll(async () => {
    raw = await Bun.file(fixtureURL.pathname).text();
  });

  beforeEach(() => {
    logger.clear();
  });

  test("chunks long text into non-empty chunks", async () => {
    const embedFn: EmbedFunction = async (_texts) => _texts.map(() => [1]);
    const chunker = new CosineDropChunker(embedFn);
    (chunker as any).logger = logger;

    const options: ChunkOptions = {
      bufferSize: 3,
      breakPercentile: 90,
      minChunkSize: 0,
      maxChunkSize: Infinity,
      overlapSize: 0,
    };

    const chunks = await chunker.chunk(raw, options);
    expect(Array.isArray(chunks)).toBe(true);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(typeof c).toBe("string");
      expect(c.length).toBeGreaterThan(0);
    }
  });

  test("handles large unstructured text reasonably", async () => {
    const mockSemanticEmbedFn: EmbedFunction = async (texts) =>
      texts.map((t, i) => {
        const score = [...t].reduce((sum, char) => sum + char.charCodeAt(0), 0);
        return [Math.sin(score * 0.001), Math.cos(i * 0.05)];
      });

    const chunker = new CosineDropChunker(mockSemanticEmbedFn);
    (chunker as any).logger = logger;

    const options: ChunkOptions = {
      bufferSize: 5,
      breakPercentile: 90,
      minChunkSize: 0,
      maxChunkSize: Infinity,
      overlapSize: 0,
    };

    const chunks = await chunker.chunk(raw, options);
    expect(chunks.length).toBeGreaterThan(10);

    const chunkLengths = chunks.map((c) => c.length);
    const threshold = 150;
    const majority = chunkLengths.filter((l) => l > threshold).length;
    expect(majority).toBeGreaterThan(chunks.length * 0.5);

    for (const chunk of chunks) {
      expect(chunk).toMatch(/\w+/);
    }
  });
});

// Tests for chunkMarkdown

describe("CosineDropChunker.chunkMarkdown", () => {
  const logger = new MockLogger();

  beforeEach(() => {
    logger.clear();
  });

  const embedFn: EmbedFunction = async (_texts) => _texts.map(() => [0]);

  test("chunks markdown without heading grouping", async () => {
    const chunker = new CosineDropChunker(embedFn);
    (chunker as any).logger = logger;

    const markdown = `
# Alpha

This is sentence one. Sentence two. Sentence three.

# Beta

Sentence four.`;

    const options: ChunkOptions = {
      bufferSize: 2,
      breakPercentile: 50,
      minChunkSize: 0,
      maxChunkSize: Infinity,
      overlapSize: 0,
      type: "markdown",
    };

    const chunks = await chunker.chunk(markdown, options);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((c) => typeof c === "string")).toBe(true);
  });

  test("chunks markdown with heading grouping", async () => {
    const logger = new MockLogger();
    const embeddings = [[1], [0.1], [1], [0.1]];
    const embedFn: EmbedFunction = async (_texts) => embeddings;
    const chunker = new CosineDropChunker(embedFn);
    (chunker as any).logger = logger;

    const markdown = `
# Intro

Sentence A1. Sentence A2.

# Details

Sentence B1. Sentence B2.`;

    const options: ChunkOptions = {
      bufferSize: 1,
      breakPercentile: 50,
      minChunkSize: 0,
      maxChunkSize: Infinity,
      overlapSize: 0,
      useHeadingsOnly: true,
      type: "markdown",
    };

    const chunks = await chunker.chunk(markdown, options);
    // const segments = (chunker as any).getSegments(markdown, options);
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toContain("Sentence A1");
    expect(chunks[1]).toContain("Sentence B1");
  });
});

describe("CosineDropChunker static helpers", () => {
  test("preprocessText normalises whitespace and dashes", () => {
    const raw = "Line1\n\nLine-  two  words";
    const out = (CosineDropChunker as any).preprocessText(raw);
    expect(out).toBe("Line1 Line-two words");
  });

  test("getSentences splits into trimmed sentences", () => {
    const pre = "Hello world.  This is a test!";
    const sents = (CosineDropChunker as any).getSentences(pre);
    expect(sents).toEqual(["Hello world.", "This is a test!"]);
  });
});
