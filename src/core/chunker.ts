import { withLogger } from "./decorators.ts";
import type { ILogger } from "../types/dataset.ts";
import { split } from "sentence-splitter";
import { cosineSimilarity as cosine } from "./cosine-similarity.ts";
import { markdownSplitter } from "./markdown-splitter.ts";

export type EmbedFunction = (texts: string[]) => Promise<number[][]>;

export interface ChunkOptions {
  bufferSize?: number;
  breakPercentile?: number;
  minChunkSize?: number;
  maxChunkSize?: number;
  overlapSize?: number;
  useHeadingsOnly?: boolean;
  type?: "text" | "markdown";
}

export interface TextChunker {
  chunk(input: string, options: ChunkOptions): Promise<string[]>;
  splitText(text: string): string[];
  splitMarkdown(markdown: string, options: ChunkOptions): string[];
}

@withLogger
export class CosineDropChunker implements TextChunker {
  protected readonly logger!: ILogger;
  private readonly embedFn: EmbedFunction;

  constructor(embedFn: EmbedFunction) {
    this.embedFn = embedFn;
  }

  public splitText(text: string): string[] {
    const preprocessed = CosineDropChunker.preprocessText(text);
    return CosineDropChunker.getSentences(preprocessed);
  }

  public splitMarkdown(markdown: string, options: ChunkOptions): string[] {
    const {
      minChunkSize = 30,
      maxChunkSize = 2000,
      useHeadingsOnly = false,
    } = options;
    const chunks = markdownSplitter(markdown, {
      minChunkSize,
      maxChunkSize,
      useHeadingsOnly,
    });
    return chunks;
  }

  public async chunk(input: string, options: ChunkOptions): Promise<string[]> {
    const segments = this.getSegments(input, options);

    if (segments.length <= (options.bufferSize ?? 2)) {
      this.logger.warn("CosineDrop: not enough segments to chunk");
      return [input];
    }

    const windows = this.buildWindows(segments, options.bufferSize ?? 2);
    const embeddings = await this.embedFn(windows);
    const distances = this.calculateDistances(embeddings);

    if (distances.length === 0) {
      this.logger.warn(
        "CosineDrop: all cosine similarities were invalid; returning full text as single chunk."
      );
      return [input];
    }

    const threshold = this.calculateThreshold(
      distances,
      options.breakPercentile ?? 90
    );
    if (isNaN(threshold)) {
      this.logger.warn(
        "CosineDrop: computed threshold is invalid; skipping chunking."
      );
      return [input];
    }

    return this.performSplitting(segments, distances, threshold, options);
  }

  private getSegments(input: string, options: ChunkOptions): string[] {
    const { type = "text" } = options;
    return type === "markdown"
      ? this.splitMarkdown(input, options)
      : this.splitText(input);
  }

  private buildWindows(segments: string[], bufferSize: number): string[] {
    return segments
      .map((_, i) => segments.slice(i, i + bufferSize).join(" "))
      .slice(0, segments.length - bufferSize + 1);
  }

  private calculateDistances(embeddings: number[][]): number[] {
    const distances: number[] = [];
    for (let i = 0; i + 1 < embeddings.length; i++) {
      const sim = cosine(embeddings[i], embeddings[i + 1]);
      if (!isNaN(sim)) distances.push(1 - sim);
    }
    return distances;
  }

  private calculateThreshold(distances: number[], percentile: number): number {
    const sorted = [...distances].sort((a, b) => a - b);
    const idx = Math.floor((percentile / 100) * (sorted.length - 1));
    return sorted[idx];
  }

  private performSplitting(
    segments: string[],
    distances: number[],
    threshold: number,
    options: ChunkOptions
  ): string[] {
    const {
      bufferSize = 2,
      minChunkSize = 300,
      maxChunkSize = 2000,
      overlapSize = 1,
    } = options;

    this.logger.info(
      `CosineDrop: threshold at ${
        options.breakPercentile ?? 90
      }th percentile = ${threshold.toFixed(4)}`
    );

    const chunks: string[] = [];
    let start = 0;

    for (let i = 0; i + 1 < distances.length; i++) {
      const dist = distances[i];
      const prospective = segments.slice(start, i + bufferSize).join("\n");
      const willSplit = !isNaN(dist) && dist >= threshold;
      const tooBig = prospective.length > maxChunkSize;

      if (willSplit || tooBig) {
        if (prospective.length >= minChunkSize) {
          this.logger.info(
            `CosineDrop: splitting at segment ${i} (dist=${dist.toFixed(
              4
            )}, size=${prospective.length})`
          );
          chunks.push(prospective);
          start = Math.max(i + bufferSize - overlapSize, start + 1);
        }
      }
    }

    if (start < segments.length) {
      const last = segments.slice(start).join("\n");
      if (last.length >= minChunkSize || chunks.length === 0) {
        chunks.push(last);
      } else {
        this.logger.warn(
          "CosineDrop: final chunk dropped due to insufficient length"
        );
      }
    }

    this.logger.info(`CosineDrop: produced ${chunks.length} chunks`);
    return chunks;
  }

  private static preprocessText(text: string): string {
    return text
      .replace(/\r?\n+/g, " ")
      .replace(/([a-z])([\u2013-])\s+([a-z])/gi, "$1$2$3")
      .replace(/\s+/g, " ");
  }

  private static getSentences(pre: string): string[] {
    return split(pre)
      .filter((node) => node.type === "Sentence")
      .map((node) => node.raw.trim())
      .filter((s) => s.length > 0);
  }
}
