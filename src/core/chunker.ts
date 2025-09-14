// chunker.pipeline.ts — low-cog version
import { pipeline, type PipelineStep } from "./pipeline";
import { withErrorHandling, withRetry, withTimeout, tap, withAlternatives } from "./helpers";
import type { ChunkerContext, ChunkInput, Segments, Windows, Distances, Threshold, ChunkResult } from "../types/chunker";
import { split } from "sentence-splitter";
import { markdownSplitter } from "./markdown-splitter";
import { cosineSimilarity as cosine } from "./cosine-similarity";

/* ────────────────────────────────────────────────────────────────────────── */
/* Local type shorthands                                                      */
/* ────────────────────────────────────────────────────────────────────────── */
type Ctx = ChunkerContext;
type Step<I, O> = PipelineStep<I, O, Ctx>;

/* ────────────────────────────────────────────────────────────────────────── */
/* Small pure utilities                                                       */
/* ────────────────────────────────────────────────────────────────────────── */
export function preprocessText(text: string): string {
  return text
    .replace(/\r?\n+/g, " ")
    .replace(/([a-z])([\u2013-])\s+([a-z])/gi, "$1$2$3")
    .replace(/\s+/g, " ");
}
export function getSentences(pre: string): string[] {
  return split(pre)
    .filter(n => n.type === "Sentence")
    .map(n => n.raw.trim())
    .filter(s => s.length > 0);
}
export function opts(o: ChunkInput["options"]): Required<ChunkInput["options"]> {
  return {
    bufferSize: o.bufferSize ?? 2,
    breakPercentile: o.breakPercentile ?? 90,
    minChunkSize: o.minChunkSize ?? 300,
    maxChunkSize: o.maxChunkSize ?? 2000,
    overlapSize: o.overlapSize ?? 1,
    useHeadingsOnly: o.useHeadingsOnly ?? false,
    type: o.type ?? "text",
  };
}

export function splitText(text: string): string[] {
  const preprocessed = preprocessText(text);
  return getSentences(preprocessed);
}

export function splitMarkdown(markdown: string, options: ChunkInput["options"]): string[] {
  const {
    minChunkSize = 30,
    maxChunkSize = 2000,
    useHeadingsOnly = false,
  } = options;
  return markdownSplitter(markdown, {
    minChunkSize,
    maxChunkSize,
    useHeadingsOnly,
  });
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Tiny steps (readable, unit-testable)                                       */
/* ────────────────────────────────────────────────────────────────────────── */

// 1) split into segments
export const sSplit: Step<ChunkInput, Segments> =
  () => ({ input, options }) => {
    const o = opts(options);
    const segments =
      o.type === "markdown"
        ? markdownSplitter(input, { minChunkSize: o.minChunkSize, maxChunkSize: o.maxChunkSize, useHeadingsOnly: o.useHeadingsOnly })
        : getSentences(preprocessText(input));
    return { segments, options: o };
  };

// 2) guard: few segments → stitch and return one chunk later
export const sGuardFew: Step<Segments, Segments> =
  (ctx) => (s) => {
    const o = opts(s.options);
    if (s.segments.length <= o.bufferSize) {
      ctx.logger?.warn?.("CosineDrop: not enough segments to chunk");
      return { ...s, segments: [s.segments.join("\n")] };
    }
    return s;
  };

// 3) windows
export const sWindows: Step<Segments, Windows> =
  () => (s) => {
    const o = opts(s.options);
    const windows = s.segments
      .map((_, i) => s.segments.slice(i, i + o.bufferSize).join(" "))
      .slice(0, s.segments.length - o.bufferSize + 1);
    return { ...s, windows };
  };

// 4) embeddings (only async step; wrapped with error/timeout/retry)
export const sEmbed: Step<Windows, Windows & { embeddings: number[][] }> =
  (ctx) => (w) => {
    const inner: Step<Windows, Windows & { embeddings: number[][] }> =
      () => async (doc) => {
        const embeddings = await ctx.embed(doc.windows);
        return { ...doc, embeddings };
      };
    return withRetry(withTimeout(withErrorHandling(inner)))(ctx)(w);
  };

// 5) distances
export const sDistances: Step<Windows & { embeddings: number[][] }, Distances> =
  (ctx) => (w) => {
    const distances: number[] = [];
    for (let i = 0; i + 1 < w.embeddings.length; i++) {
      const sim = cosine(w.embeddings[i], w.embeddings[i + 1]);
      if (!Number.isNaN(sim)) distances.push(1 - sim);
    }
    if (distances.length === 0) {
      ctx.logger?.warn?.("CosineDrop: all cosine similarities invalid; emitting single chunk");
      return { segments: [w.segments.join("\n")], options: w.options, distances: [] };
    }
    return { segments: w.segments, options: w.options, distances };
  };

// 6) threshold
export const sThreshold: Step<Distances, Threshold> =
  (ctx) => (d) => {
    const o = opts(d.options);
    const sorted = [...d.distances].sort((a, b) => a - b);
    const idx = Math.floor((o.breakPercentile / 100) * (sorted.length - 1));
    const threshold = sorted[idx];
    if (Number.isNaN(threshold)) {
      ctx.logger?.warn?.("CosineDrop: computed threshold invalid; emitting single chunk");
      return { ...d, threshold: Number.NaN };
    }
    ctx.logger?.info?.(`CosineDrop: threshold at ${o.breakPercentile}th percentile = ${threshold.toFixed(4)}`);
    return { ...d, threshold };
  };

// 7) split by threshold (final)
export const sSplitBy: Step<Threshold, ChunkResult> =
  (ctx) => (t) => {
    const { bufferSize, minChunkSize, maxChunkSize, overlapSize } = opts(t.options);

    if (Number.isNaN(t.threshold)) {
      return { chunks: [t.segments.join("\n")] };
    }

    const chunks: string[] = [];
    let start = 0;

    for (let i = 0; i + 1 < t.distances.length; i++) {
      const dist = t.distances[i];
      const prospective = t.segments.slice(start, i + bufferSize).join("\n");
      const willSplit = !Number.isNaN(dist) && dist >= t.threshold;
      const tooBig = prospective.length > maxChunkSize;

      if (willSplit || tooBig) {
        if (prospective.length >= minChunkSize) {
          ctx.logger?.info?.(`CosineDrop: splitting at segment ${i} (dist=${dist.toFixed(4)}, size=${prospective.length})`);
          chunks.push(prospective);
          start = Math.max(i + bufferSize - overlapSize, start + 1);
        }
      }
    }

    if (start < t.segments.length) {
      const last = t.segments.slice(start).join("\n");
      if (last.length >= minChunkSize || chunks.length === 0) chunks.push(last);
      else ctx.logger?.warn?.("CosineDrop: final chunk dropped — too short");
    }

    ctx.logger?.info?.(`CosineDrop: produced ${chunks.length} chunks`);
    return { chunks };
  };

/* ────────────────────────────────────────────────────────────────────────── */
/* Precomposed programs                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

export function buildCosinePipeline(ctx: Ctx) {
  return pipeline<Ctx, ChunkInput>(ctx)
    .addStep(sSplit)
    .addStep(sGuardFew)
    .addStep(sWindows)
    .addStep(sEmbed)
    .addStep(sDistances)
    .addStep(sThreshold)
    .addStep(sSplitBy);
}

export const cosineStrategy: Step<ChunkInput, ChunkResult> =
  (ctx) => (doc) => buildCosinePipeline(ctx).run(doc);

export const identityStrategy: Step<ChunkInput, ChunkResult> =
  () => (doc) => ({ chunks: [doc.input] });

export const stopWhenAnyChunks = (r: ChunkResult) => r.chunks.length >= 1;

/* ────────────────────────────────────────────────────────────────────────── */
/* Public API                                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

export async function cosineDropChunker(
  ctx: Ctx,
  input: string,
  options: ChunkInput["options"] = {}
): Promise<string[]> {
  const buf = Math.max(1, options.bufferSize ?? 2);

  // 1) Segment first
  const segments =
    (options.type ?? "text") === "markdown"
      ? splitMarkdown(input, options)
      : splitText(input);

  // 2) Early return - preserve EXACT original text
  if (segments.length <= buf) {
    ctx.logger?.warn?.("CosineDrop: not enough segments to chunk");
    return [input];
  }

  const multiStrategy = withAlternatives<ChunkInput, ChunkResult, Ctx>(
    [cosineStrategy, identityStrategy],
    stopWhenAnyChunks
  );

  const p = pipeline<Ctx, ChunkInput>(ctx)
    .addStep(tap<ChunkInput, Ctx>((ctx) => {
      ctx.logger?.info?.("CosineDrop: start");
    }))
    .addStep(multiStrategy)
    .addStep(tap<ChunkResult, Ctx>((ctx, doc) => {
      ctx.logger?.info?.(`CosineDrop: done (${doc.chunks.length} chunks)`);
    }));

  const out = await p.run({ input, options });
  return out.chunks;
}