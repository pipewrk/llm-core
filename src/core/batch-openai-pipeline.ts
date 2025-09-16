import type OpenAI from "openai";
import path from "node:path";

import { pipeline, type StreamEvent, type PipelineOutcome, type ResumeState } from "./pipeline";
import {
  uploadInputFileStep,
  createBatchStep,
  waitUntilTerminalOrPauseStep,
  captureOutputFilesStep,
  downloadOutputsStep,
  buildInputIncrementalStep,
  processOutputIncrementalStep,
} from "./batch-steps";

import type {
  IncCtx as _IncCtx,
  WithJsonl as _WithJsonl,
  WithDownloaded as _WithDownloaded,
  Endpoint,
} from "../types/batch-openai";
import type { Logger } from "./logger";

/* ================================================================================================
 * Public types (friendly aliases)
 * ==============================================================================================*/

/**
 * Advanced execution environment for the batch pipeline.
 *
 * Most consumers shouldn’t construct this by hand. Prefer {@link fromArray}
 * or {@link fromAsync} which return a ready-to-use `BatchEnv`.
 *
 * Includes the OpenAI client, optional logger, and incremental hooks for
 * producing inputs and consuming outputs.
 */
export type BatchEnv = _IncCtx;

/**
 * Job/document state used by the pipeline before and through upload.
 *
 * Create one with {@link createJob}. Pass this to {@link tickBatch} (cron/serverless)
 * or {@link runBatch} (CLI/tests). The pipeline appends to `jsonlPath` incrementally
 * until `inputComplete === true`.
 */
export type BatchJob = _WithJsonl;

/**
 * Final job state after the batch has completed, outputs were downloaded,
 * and the output JSONL has been incrementally processed.
 */
export type BatchState = _WithDownloaded;

/**
 * Supported OpenAI Batch endpoints.
 *
 * Must match the `url` field of every line you add to the JSONL.
 */
export type { Endpoint };

/* ================================================================================================
 * Pipeline factory (advanced / power users)
 * ==============================================================================================*/

/**
 * Create the single-batch pipeline.
 *
 * Steps:
 *  1) Incrementally append input rows until `inputComplete` becomes `true`.
 *  2) Upload the JSONL to OpenAI (purpose: "batch").
 *  3) Create the Batch job.
 *  4) Non-blocking wait: yields `{ done:false, reason: "batch:<status>" }` until terminal.
 *  5) Capture output/error file IDs.
 *  6) Download output/error JSONL files.
 *  7) Incrementally process the output JSONL (bounded by `ioSliceBytes`).
 *
 * Power users may drive the pipeline directly; most should call {@link runBatch}
 * or {@link tickBatch} which wrap this with friendlier ergonomics.
 *
 * @param ctx Execution context (use {@link fromArray} or {@link fromAsync} to build).
 * @returns A typed pipeline instance ready to `next()`/`stream()`/`run()`.
 */
export function makeSingleBatchPipeline(ctx: _IncCtx) {
  return (
    pipeline<_IncCtx, _WithJsonl>(ctx)
      // 1) Keep appending input rows until upstream is done.
      .addStep(buildInputIncrementalStep)
      // 2) Upload the JSONL file to OpenAI (purpose: "batch").
      .addStep(uploadInputFileStep)
      // 3) Create the Batch job.
      .addStep(createBatchStep)
      // 4) Non-blocking wait (yields { done:false } with reason "batch:<status>").
      .addStep(waitUntilTerminalOrPauseStep)
      // 5) Capture output and error file ids.
      .addStep(captureOutputFilesStep)
      // 6) Download output/error files into outDir.
      .addStep(downloadOutputsStep)
      // 7) Incrementally process the output JSONL (bounded by ioSliceBytes).
      .addStep(processOutputIncrementalStep)
  );
}

/* ================================================================================================
 * Producer helpers (construct BatchEnv without touching IncCtx)
 * ==============================================================================================*/

/**
 * Build a producer context from an in-memory array (eager mode).
 *
 * Ideal when you already have all rows and want a simple path. The pipeline
 * will append up to `maxPerTick` rows per call to {@link tickBatch}.
 *
 * @param params.client        OpenAI client instance.
 * @param params.rows          Full set of JSON-serialisable rows.
 * @param params.onOutputLine  Optional callback invoked for each parsed output line.
 * @param params.maxPerTick    Max rows appended per tick (default: 1000).
 * @param params.ioSliceBytes  Bytes read per output slice (default: 131072 ≈ 128 KiB).
 * @param params.logger        Optional logger with `info/warn/error`.
 * @returns A {@link BatchEnv} suitable for {@link makeSingleBatchPipeline}/{@link tickBatch}.
 *
 * @example
 * const ctx = fromArray({ client, rows, onOutputLine: saveRow });
 */
export function fromArray(params: {
  client: OpenAI;
  rows: unknown[];
  onOutputLine?: (line: any) => Promise<void> | void;
  maxPerTick?: number;
  ioSliceBytes?: number;
  logger?: Logger;
}): _IncCtx {
  let i = 0;

  return {
    openai: params.client,
    logger: params.logger,
    maxPerTick: params.maxPerTick ?? 1000,
    ioSliceBytes: params.ioSliceBytes ?? 128 * 1024,
    onOutputLine: params.onOutputLine,
    pullInputLines: async (max) => {
      const take = Math.min(max, params.rows.length - i);
      const items = params.rows.slice(i, i + take);
      i += take;
      return { items, done: i >= params.rows.length };
    },
  };
}

/**
 * Build a producer context from an async iterable (streaming/incremental mode).
 *
 * Use when inputs arrive over time (e.g. DB cursor, queue, file reader).
 * Each {@link tickBatch} call pulls up to `maxPerTick` items from `src`.
 *
 * @param params.client        OpenAI client instance.
 * @param params.src           Async iterable yielding JSON-serialisable rows.
 * @param params.onOutputLine  Optional callback invoked for each parsed output line.
 * @param params.maxPerTick    Max rows appended per tick (default: 1000).
 * @param params.ioSliceBytes  Bytes read per output slice (default: 131072 ≈ 128 KiB).
 * @param params.logger        Optional logger with `info/warn/error`.
 * @returns A {@link BatchEnv} suitable for {@link makeSingleBatchPipeline}/{@link tickBatch}.
 *
 * @example
 * async function* src() { for await (const row of stream) yield row; }
 * const ctx = fromAsync({ client, src, onOutputLine: saveRow });
 */
export function fromAsync(params: {
  client: OpenAI;
  src: AsyncIterable<unknown>;
  onOutputLine?: (line: any) => Promise<void> | void;
  maxPerTick?: number;
  ioSliceBytes?: number;
  logger?: Logger;
}): _IncCtx {
  const it = params.src[Symbol.asyncIterator]();

  return {
    openai: params.client,
    logger: params.logger,
    maxPerTick: params.maxPerTick ?? 1000,
    ioSliceBytes: params.ioSliceBytes ?? 128 * 1024,
    onOutputLine: params.onOutputLine,
    pullInputLines: async (max) => {
      const items: unknown[] = [];
      while (items.length < max) {
        const n = await it.next();
        if (n.done) return { items, done: true };
        items.push(n.value);
      }
      return { items, done: false };
    },
  };
}

/* ================================================================================================
 * Job helper
 * ==============================================================================================*/

/**
 * Create an initial job/document describing a single-batch run.
 *
 * The pipeline will append to `jsonlPath` until inputs are complete, then upload,
 * create the batch, wait non-blocking, download outputs, and process them.
 *
 * @param params.id               Stable job ID (used in filenames/logs).
 * @param params.outDir           Output directory for artefacts.
 * @param params.endpoint         Target endpoint (must equal each line’s `url`).
 * @param params.jsonlPath        Optional explicit path for the input JSONL (defaults to `${outDir}/${id}.input.jsonl`).
 * @param params.completionWindow Batch completion window (default: "24h").
 * @returns A {@link BatchJob} to pass to {@link tickBatch} or {@link runBatch}.
 *
 * @example
 * const job = createJob({ id: "daily-2025-09-16", outDir: "./.runs", endpoint: "/v1/chat/completions" });
 */
export function createJob(params: {
  id: string;
  outDir: string;
  endpoint: Endpoint;
  jsonlPath?: string;
  completionWindow?: "24h";
}): _WithJsonl {
  const jsonlPath =
    params.jsonlPath ?? path.join(params.outDir, `${params.id}.input.jsonl`);

  return {
    jobId: params.id,
    outDir: params.outDir,
    endpoint: params.endpoint,
    completionWindow: params.completionWindow ?? "24h",
    jsonlPath,
    lineCount: 0,
    inputComplete: false,
  };
}

/**
 * Apply cursor updates for a `"processing-outputs"` pause.
 *
 * Steps that stream-read the downloaded `output.jsonl` may emit a pause with:
 *
 *  - `info.reason === "processing-outputs"`
 *  - `info.payload.nextPos`: byte offset to resume reading from
 *  - `info.payload.rows`: number of complete lines processed in this slice
 *
 * This helper updates the evolving job `doc` with:
 *  - `outPos` set to `nextPos` (or left as-is if not provided)
 *  - `processedCount` incremented by `rows` (or left as-is if missing)
 *
 * It is a pure function and does not mutate the input object.
 *
 * @typeParam T - A document shape that carries `outPos` and `processedCount` fields.
 * @param doc   The current document to update.
 * @param info  Pause info from the step, potentially containing `nextPos` and `rows`.
 * @returns A new document with advanced `outPos` and `processedCount` if applicable.
 *
 * @example
 * const evt = await p.next(doc, resume);
 * if ('done' in evt) return evt.value;
 * const newDoc = applyProcessingOutputsCursor(evt.doc, evt.info);
 */
function applyProcessingOutputsCursor<
  T extends { outPos?: number; processedCount?: number; outCarry?: string }
>(
  doc: T,
  info?: PipelineOutcome<unknown>
): T {
  if (!info || info.done || info.reason !== "processing-outputs") return doc;
  const p = info.payload as { nextPos?: number; rows?: number; carry?: string } | undefined;
  return {
    ...doc,
    outPos: p?.nextPos ?? doc.outPos,
    processedCount: (doc.processedCount ?? 0) + (p?.rows ?? 0),
    outCarry: p?.carry ?? doc.outCarry,
  };
}


/* ================================================================================================
 * Runners
 * ==============================================================================================*/
type PauseEvent<T>    = Extract<StreamEvent<T>, { type: "pause" }>;
type ProgressEvent<T> = Extract<StreamEvent<T>, { type: "progress" }>;
type DoneResult<T>    = { done: true; value: T };

const isPause = <T>(e: StreamEvent<T>): e is PauseEvent<T> => e.type === "pause";
const isProgress = <T>(e: StreamEvent<T>): e is ProgressEvent<T> => e.type === "progress";
/**
 * Run a single batch end-to-end in-process (blocking).
 *
 * Convenience for CLIs/tests where a long-lived process is fine. For cron/serverless,
 * prefer {@link tickBatch} which is non-blocking and resumable.
 *
 * @param options.client        OpenAI client instance.
 * @param options.endpoint      Target endpoint.
 * @param options.id            Job ID.
 * @param options.outDir        Output directory.
 * @param options.rows          Full set of input rows (eager mode).
 * @param options.onOutputLine  Optional callback invoked for each parsed output line.
 * @param options.maxPerTick    Max rows appended per internal tick (default: 1000).
 * @param options.ioSliceBytes  Bytes read per output slice (default: 131072 ≈ 128 KiB).
 * @param options.logger        Optional logger with `info/warn/error`.
 * @returns Final {@link BatchState}.
 *
 * @example
 * const final = await runBatch({ client, endpoint: "/v1/embeddings", id: "emb-001", outDir: "./.runs", rows });
 */
export async function runBatch(options: {
  client: OpenAI;
  endpoint: Endpoint;
  id: string;
  outDir: string;
  rows: unknown[];
  onOutputLine?: (line: any) => Promise<void> | void;
  maxPerTick?: number;
  ioSliceBytes?: number;
  logger?: Logger;
}): Promise<_WithDownloaded> {
  const ctx = fromArray({
    client: options.client,
    rows: options.rows,
    onOutputLine: options.onOutputLine,
    maxPerTick: options.maxPerTick,
    ioSliceBytes: options.ioSliceBytes,
    logger: options.logger,
  });

  const doc0 = createJob({
    id: options.id,
    outDir: options.outDir,
    endpoint: options.endpoint,
  });

  const p = makeSingleBatchPipeline(ctx);

  let resume: any | undefined;
  let current: any = doc0;

  while (true) {
    const evt = (await p.next(current, resume)) as
      | StreamEvent<_WithDownloaded>
      | DoneResult<_WithDownloaded>;

    if ("done" in evt) {
      return evt.value; // _WithDownloaded
    }

    if (isPause(evt)) {
      // advance cursor from pause info
      const updated = applyProcessingOutputsCursor(current, evt.info);
      current = updated;

      // CRITICAL: keep resume's doc aligned with our updated doc
      resume = { ...evt.resume, doc: updated } as ResumeState<_WithDownloaded>;
      continue;
    }

    // progress
    if (isProgress(evt)) {
      current = evt.doc;
      resume  = evt.resume;
      continue;
    }

  }
}

/**
 * Resume token returned by {@link tickBatch} for non-terminal events.
 *
 * Serialise this as JSON and store it alongside `doc`. On the next invocation,
 * pass both back to `tickBatch` to continue exactly where you stopped.
 *
 * `nextStep` is the index of the step to re-enter. `doc` is the evolving job object.
 */
export type ResumeToken<T> = { nextStep: number; doc: T };

/**
 * Advance the batch pipeline by a single step (non-blocking).
 *
 * Call once per schedule (e.g. cron/serverless). Persist the returned `resume` token
 * and `doc`, then call again later with those to continue. When finished, the return
 * value is `{ done: true, value }`.
 *
 * For pause events from the wait step, inspect `info.payload?.suggestedDelayMs`
 * to choose your next wake-up cadence.
 *
 * @param options.ctx     Producer context from {@link fromArray} or {@link fromAsync}.
 * @param options.doc     Current job state (from {@link createJob} or last tick’s `doc`).
 * @param options.resume  Optional resume token from the previous tick.
 * @returns
 *  - `{ done:true, value: BatchState }` when the job is complete, or
 *  - `{ done:false, type, resume, doc, info }` when more work remains.
 *
 * @example
 * const step = await tickBatch({ ctx, doc, resume });
 * if (step.done) finish(step.value); else { save(step.doc); save(step.resume); }
 */
export async function tickBatch(options: {
  ctx: _IncCtx;
  doc: _WithJsonl | _WithDownloaded;
  resume?: ResumeToken<any>;
}): Promise<
  | { done: true; value: _WithDownloaded }
  | {
      done: false;
      type: "pause" | "progress";
      resume: ResumeToken<any>;
      doc: any;
      info?: any;
    }
> {
  const p = makeSingleBatchPipeline(options.ctx);
  const evt = (await p.next(options.doc as any, options.resume as any)) as
    | StreamEvent<_WithDownloaded>
    | DoneResult<_WithDownloaded>;

  if ("done" in evt) {
    return evt; // { done:true, value }
  }

  let doc = evt.doc;                        // safe: both variants have doc
  let resume: ResumeState<_WithDownloaded> = evt.resume; // safe: both have resume
  let info: import("./pipeline").PipelineOutcome<_WithDownloaded> | undefined;

  if (isPause(evt)) {
    info = evt.info;                        // only on pause
    doc  = applyProcessingOutputsCursor(evt.doc, evt.info);
    resume = { ...evt.resume, doc };        // keep resume in sync with updated doc
  }

  return {
    done: false as const,
    type: evt.type,                         // "pause" | "progress"
    resume,
    doc,
    info,                                   // undefined on progress, populated on pause
  };
}
