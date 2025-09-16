import type OpenAI from "openai";
import type { Logger } from "src/core";

/**
 * Batch/OpenAI Types (single-file public surface)
 * ------------------------------------------------
 * This module defines:
 *  - Core request/endpoint types
 *  - Job lifecycle types (WithJsonl → WithInputFile → WithBatch → WithOutputFiles → WithDownloaded)
 *  - Incremental I/O cursors (lightweight overlays)
 *  - Context types (BatchCtx / IncCtx)
 *  - Optional parsed-output model (legacy)
 */

/* -------------------------------------------------------------------------------------------------
 * Core request/endpoint types
 * -------------------------------------------------------------------------------------------------*/

/** Supported OpenAI Batch endpoints for this package. */
export type Endpoint =
  | "/v1/chat/completions"
  | "/v1/embeddings";

/** Chat completion request body for a batch line. */
export interface ChatBody {
  /** Model name (e.g. "gpt-4o-mini"). */
  model: string;

  /** Temperature; omit or set 0 for determinism. */
  temperature?: number;

  /** Response format, e.g. { type: "json_object" }. */
  response_format?: { type: "json_object" | "text" };

  /** Message list in OpenAI format. */
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
}

/** Embeddings request body for a batch line. */
export interface EmbeddingsBody {
  /** Model name (e.g. "text-embedding-3-large"). */
  model: string;

  /** Single string or array of strings to embed. */
  input: string | string[];
}

/** Union of supported batch request bodies. */
export type BatchLineBody = ChatBody | EmbeddingsBody;

/** One JSONL record representing a single asynchronous request. */
export interface BatchLine {
  /** Stable identifier used to reconcile outputs. */
  custom_id: string;

  /** HTTP method (Batch API supports POST). */
  method: "POST";

  /** Target endpoint; must match the batch’s endpoint. */
  url: Endpoint;

  /** Request body (chat or embeddings). */
  body: BatchLineBody;
}

/* -------------------------------------------------------------------------------------------------
 * Job lifecycle types
 * -------------------------------------------------------------------------------------------------*/

/** Runtime status of a Batch job as returned by OpenAI. */
export type BatchStatus =
  | "validating"
  | "in_progress"
  | "finalizing"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired";

/** Common fields used to initialise a batch job. */
export interface BaseInit {
  /** Stable job identifier used for filenames and logs. */
  jobId: string;

  /** Endpoint this job targets. */
  endpoint: Endpoint;

  /** Completion window contract; currently "24h". */
  completionWindow: "24h";

  /** Output directory for artefacts. */
  outDir: string;
}

/**
 * Job state while constructing the input JSONL.
 * The file grows incrementally until `inputComplete` is true.
 */
export interface WithJsonl extends BaseInit {
  /** Absolute or relative path to the single input JSONL file. */
  jsonlPath: string;

  /** Number of lines appended so far (metrics only). */
  lineCount: number;

  /** True once upstream has finished producing input. */
  inputComplete: boolean;
}

/** Job state after the JSONL file has been uploaded to OpenAI. */
export interface WithInputFile extends WithJsonl {
  /** OpenAI file id for the uploaded JSONL input. */
  inputFileId: string;
}

/** Job state after the Batch job has been created. */
export interface WithBatch extends WithInputFile {
  /** OpenAI batch id. */
  batchId: string;

  /** Latest known status for the batch. */
  status: BatchStatus;
}

/** Job state once OpenAI exposes output and/or error file ids. */
export interface WithOutputFiles extends WithBatch {
  /** OpenAI file id for successful results (if any). */
  outputFileId?: string;

  /** OpenAI file id for per-line errors (if any). */
  errorFileId?: string;
}

/**
 * Job state after outputs have been downloaded locally.
 * Includes cursors used to process the output JSONL incrementally.
 */
export interface WithDownloaded extends WithOutputFiles {
  /** Local path to the downloaded output JSONL (if any). */
  outputPath?: string;

  /** Local path to the downloaded error JSONL (if any). */
  errorPath?: string;

  /** Byte offset processed so far from `outputPath`. */
  outPos?: number;

  /** Carry-over buffer for a partial JSON line between slices. */
  outCarry?: string;

  /** Number of output lines processed so far. */
  processedCount?: number;
}

/* -------------------------------------------------------------------------------------------------
 * Incremental I/O cursor overlays (optional)
 * -------------------------------------------------------------------------------------------------*/

/**
 * Overlay describing the input JSONL construction state.
 * Use only if you need a distinct cursor object; otherwise WithJsonl suffices.
 */
export interface WithInputCursor {
  /** Path to the single input JSONL file. */
  jsonlPath: string;

  /** True when the upstream producer has no more items. */
  inputComplete: boolean;

  /** Number of lines appended so far (metrics only). */
  lineCount: number;
}

/**
 * Overlay describing incremental consumption of a downloaded output file.
 * Use only if you need to store cursors separate from WithDownloaded.
 */
export interface WithOutputCursor {
  /** Local path to the downloaded output JSONL. */
  outputPath?: string;

  /** Byte offset processed so far. */
  outPos?: number;

  /** Carry-over buffer for a partial JSON line between slices. */
  outCarry?: string;

  /** Number of processed lines (metrics only). */
  processedCount?: number;
}

/* -------------------------------------------------------------------------------------------------
 * Context types (execution environment)
 * -------------------------------------------------------------------------------------------------*/


/**
 * Base context required to talk to OpenAI.
 * Prefer importing the type only (`import type OpenAI from "openai"`).
 */
export interface BatchCtx {
  /** OpenAI client instance. */
  openai: OpenAI;

  /** Optional logger. */
  logger?: Logger;

  /** Suggested minimum poll interval for non-blocking waits (ms). */
  minPollIntervalMs?: number;
}

/**
 * Extended context for incremental production/consumption.
 * Supply either via a helper (fromArray/fromAsync) or your own implementation.
 */
export interface IncCtx extends BatchCtx {
  /**
   * Pull up to `max` input items to append to the JSONL.
   * Return `done: true` when no more items remain.
   */
  pullInputLines: (max: number) => Promise<{ items: unknown[]; done: boolean }>;

  /** Callback invoked for each parsed output line (optional). */
  onOutputLine?: (line: any) => Promise<void> | void;

  /** Max items to append per tick; defaults to 1000 if omitted. */
  maxPerTick?: number;

  /** Bytes to read per output-processing slice; defaults to ~128KB. */
  ioSliceBytes?: number;
}

/* -------------------------------------------------------------------------------------------------
 * Optional parsed-output model (legacy)
 * -------------------------------------------------------------------------------------------------*/

/** Parsed representation of a single output line keyed by `custom_id`. */
export type ParsedLine =
  | { custom_id: string; ok: true; body: unknown; status_code: number }
  | { custom_id: string; ok: false; error: unknown; status_code?: number };

/**
 * @deprecated
 * Prefer incremental `onOutputLine` processing with {@link WithDownloaded}.
 * This type represents a materialised map of all outputs and error counts.
 */
export interface WithParsed extends WithDownloaded {
  /** Map of `custom_id` → parsed line. */
  results: Map<string, ParsedLine>;

  /** Number of successful lines. */
  okCount: number;

  /** Number of failed lines. */
  errCount: number;
}

/* -------------------------------------------------------------------------------------------------
 * Deprecated/compat types
 * -------------------------------------------------------------------------------------------------*/

/**
 * @deprecated
 * Old input shape used before the incremental single-file design.
 * Keep only for compatibility with legacy code that still builds
 * an entire JSONL in memory.
 */
export interface InputDoc {
  /** Legacy shard identifier (unused in single-batch mode). */
  shardId: string;

  /** Endpoint this input targets. */
  endpoint: Endpoint;

  /** Completion window contract; currently "24h". */
  completionWindow: "24h";

  /** Directory where artefacts should be written. */
  outDir: string;

  /** Full set of batch lines (eager mode). */
  lines: BatchLine[];
}