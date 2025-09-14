import { beforeEach, describe, expect, beforeAll, test } from "bun:test";
import {
  cosineDropChunker,
  // expose these tiny helpers from core/chunker.ts
  preprocessText as _preprocessText,
  getSentences as _getSentences,
  sThreshold,
  sDistances,
  sGuardFew,
} from "../core/chunker.ts";
import {
  type ChunkOptions,
  type EmbedFunction,
} from "../types/chunker.ts";
import { MockLogger } from "./logger.mock.ts";

// Convenience to build a ctx per test
function makeCtx(embed: EmbedFunction, logger: MockLogger) {
  return {
    logger,
    embed,
    pipeline: { retries: 0, timeout: 0 }, // harmless defaults
  };
}

// Tests for chunkText

describe("CosineDropChunker.chunkText", () => {
  const logger = new MockLogger();

  beforeEach(() => {
    logger.clear();
  });

  test("splits into individual sentences when bufferSize=1 and breakPercentile=100", async () => {
    const embeddings = [[1], [0], [1], [0]];
    const embedFn: EmbedFunction = async (_texts) => embeddings;
    const text = "S1. S2. S3. S4.";
    const options: ChunkOptions = {
      bufferSize: 1,
      breakPercentile: 100,
      minChunkSize: 0,
      maxChunkSize: Infinity,
      overlapSize: 0,
    };
    const chunks = await cosineDropChunker(makeCtx(embedFn, logger), text, options);
    expect(chunks).toEqual(["S1.", "S2.", "S3.\nS4."]);
  });

  test("returns full text when sentences <= bufferSize", async () => {
    const embeddings = [[0], [0]];
    const embedFn: EmbedFunction = async (_texts) => embeddings;

    const text = "First. Second.";
    const options: ChunkOptions = {
      bufferSize: 3,
      breakPercentile: 50,
      minChunkSize: 0,
      maxChunkSize: Infinity,
      overlapSize: 0,
    };

    const chunks = await cosineDropChunker(makeCtx(embedFn, logger), text, options);
    expect(chunks).toEqual([text]);
  });

  test("splits only on maximum jumps with breakPercentile=99", async () => {
    const embeddings = [[1], [1], [0], [0]];
    const embedFn: EmbedFunction = async (_texts) => embeddings;

    const text = "A. B. C. D.";
    const options: ChunkOptions = {
      bufferSize: 1,
      breakPercentile: 99,
      minChunkSize: 0,
      maxChunkSize: Infinity,
      overlapSize: 0,
    };

    const chunks = await cosineDropChunker(makeCtx(embedFn, logger), text, options);
    expect(chunks).toEqual(["A. B. C. D."]);
  });
});

// Tests with real-world fixture

describe("CosineDropChunker with real-world text", () => {
  let raw: string;
  const logger = new MockLogger();
  const fixtureURL = new URL("./fixtures/who-sea.txt", import.meta.url);

  beforeAll(async () => {
    raw = await Bun.file(fixtureURL.pathname).text();
  });

  beforeEach(() => {
    logger.clear();
  });

  test("chunks long text into non-empty chunks", async () => {
    const embedFn: EmbedFunction = async (_texts) => _texts.map(() => [1]);

    const options: ChunkOptions = {
      bufferSize: 3,
      breakPercentile: 90,
      minChunkSize: 0,
      maxChunkSize: Infinity,
      overlapSize: 0,
    };

    const chunks = await cosineDropChunker(makeCtx(embedFn, logger), raw, options);
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

    const options: ChunkOptions = {
      bufferSize: 5,
      breakPercentile: 90,
      minChunkSize: 0,
      maxChunkSize: Infinity,
      overlapSize: 0,
    };

    const chunks = await cosineDropChunker(makeCtx(mockSemanticEmbedFn, logger), raw, options);
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

    const chunks = await cosineDropChunker(makeCtx(embedFn, logger), markdown, options);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((c) => typeof c === "string")).toBe(true);
  });

  test("chunks markdown with heading grouping", async () => {
    const logger = new MockLogger();
    const embeddings = [[1], [0.1], [1], [0.1]];
    const embedFn: EmbedFunction = async (_texts) => embeddings;
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

    const chunks = await cosineDropChunker(makeCtx(embedFn, logger), markdown, options);
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toContain("Sentence A1");
    expect(chunks[1]).toContain("Sentence B1");
  });
});

describe("CosineDropChunker static helpers", () => {
  test("preprocessText normalises whitespace and dashes", () => {
    const raw = "Line1\n\nLine-  two  words";
    const out = _preprocessText(raw);
    expect(out).toBe("Line1 Line-two words");
  });

  test("getSentences splits into trimmed sentences", () => {
    const pre = "Hello world.  This is a test!";
    const sents = _getSentences(pre);
    expect(sents).toEqual(["Hello world.", "This is a test!"]);
  });
});
describe("chunker helpers", () => {
  let logger: MockLogger;

  beforeEach(() => {
    logger = new MockLogger();
    logger.clear();
  });

  test("sGuardFew returns single chunk & warns when segments <= bufferSize", () => {
    const ctx = makeCtx(async () => [], logger); // dummy embedFn
    const state = {
      segments: ["A", "B"],                   // 2 segments
      options: { bufferSize: 3 },             // bufferSize = 3 -> guard hits
    };
    const out = sGuardFew(ctx)(state) as any;

    expect(out.segments).toEqual(["A\nB"]);   // joined verbatim
    expect(logger.logs.warn.some((w) => w.includes("not enough segments"))).toBe(true);
  });

  test("sGuardFew passes through unchanged when segments > bufferSize", () => {
    const ctx = makeCtx(async () => [], logger);
    const state = {
      segments: ["A", "B", "C", "D"],
      options: { bufferSize: 2 },             // 4 > 2 -> no guard
    };
    const out = sGuardFew(ctx)(state) as any;

    expect(out.segments).toEqual(["A", "B", "C", "D"]);
    expect(logger.logs.warn.length).toBe(0);
  });

  test("sDistances warns and emits single chunk when no valid distances computed", () => {
    const ctx = makeCtx(async () => [], logger);
    const state = {
      segments: ["S1", "S2", "S3"],
      options: { bufferSize: 2 },
      windows: [],
      embeddings: [[1, 0, 0]],                // length 1 => loop computes 0 distances
    };
    const out = sDistances(ctx)(state) as any;

    expect(out.distances).toEqual([]);        // as per branch
    expect(out.segments).toEqual(["S1\nS2\nS3"]);
    expect(logger.logs.warn.some((w) => w.includes("cosine similarities invalid"))).toBe(true);
  });

  test("sDistances produces distances and passes through segments when valid", () => {
    const ctx = makeCtx(async () => [], logger);
    const state = {
      segments: ["S1", "S2", "S3", "S4"],
      options: { bufferSize: 2 },
      windows: [],
      embeddings: [[1], [0], [1]],            // yields two distances
    };
    const out = sDistances(ctx)(state) as any;

    expect(out.segments).toEqual(state.segments);
    expect(out.distances).toEqual([1, 1]);
    expect(logger.logs.warn.length).toBe(0);
  });

  test("sThreshold logs info and sets a numeric threshold when distances present", () => {
    const ctx = makeCtx(async () => [], logger);
    const state = {
      segments: ["S1", "S2", "S3"],
      options: { breakPercentile: 50 },       // median
      distances: [0, 0.25, 0.5, 0.75, 1],
    };
    const out = sThreshold(ctx)(state) as any;

    expect(Number.isNaN(out.threshold)).toBe(false);
    expect(out.threshold).toBe(0.5);
    expect(logger.logs.info.some((s) => s.includes("threshold at 50th percentile"))).toBe(true);
  });

  test("sThreshold warns and sets threshold=NaN when computed value is invalid", () => {
    const ctx = makeCtx(async () => [], logger);
    const state = {
      segments: ["S1", "S2"],
      options: { breakPercentile: 90 },
      distances: [Number.NaN],                // sorted still [NaN] -> pick NaN
    };
    const out = sThreshold(ctx)(state) as any;

    expect(Number.isNaN(out.threshold)).toBe(true);
    expect(logger.logs.warn.some((w) => w.includes("computed threshold invalid"))).toBe(true);
  });
});
