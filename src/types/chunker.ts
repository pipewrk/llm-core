// chunker.types.ts
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

export type ChunkerContext = {
  logger?: { info?: (s: string)=>void; warn?: (s: string)=>void; error?: (e:unknown)=>void };
  pipeline?: { retries?: number; timeout?: number };
  embed: EmbedFunction;                // injected, makes this trivially mockable
};

export type ChunkInput = { input: string; options: ChunkOptions };
export type Segments = { segments: string[]; options: ChunkOptions };
export type Windows = Segments & { windows: string[] };
export type Distances = Segments & { distances: number[] };
export type Threshold = Distances & { threshold: number };
export type ChunkResult = { chunks: string[] };