import fs from "node:fs/promises";
import path from "node:path";
import { toFile } from "openai"; // value import is fine here; type-only elsewhere
import { openReadStream, openWriteStream, pipeResponseToFile } from "./file-utils";

import type {
  IncCtx,
  WithJsonl,
  WithInputFile,
  WithBatch,
  WithOutputFiles,
  WithDownloaded,
} from "../types/batch-openai";

import type { PipelineOutcome, PipelineStep } from "./pipeline";

/* -------------------------------------------------------------------------------------------------
 * Helpers
 * -------------------------------------------------------------------------------------------------*/

/**
 * Download an OpenAI file to disk (creates parent dirs).
 */
export async function downloadFile(client: IncCtx["openai"], fileId: string, outPath: string): Promise<string> {
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  const res = await client.files.content(fileId);
  await pipeResponseToFile(res, outPath);
  return outPath;
}

/* -------------------------------------------------------------------------------------------------
 * Steps (incremental input → upload → create batch → wait → capture → download → incremental output)
 * -------------------------------------------------------------------------------------------------*/

/**
 * Append up to `maxPerTick` lines to `jsonlPath`.
 *
 * Yields a pause with reason `"awaiting-input"` until the upstream producer reports `done: true`.
 * When `done`, progresses with `inputComplete: true`.
 */
export const buildInputIncrementalStep: PipelineStep<WithJsonl, WithJsonl, IncCtx> =
  (ctx) => async (doc) => {
    const max = ctx.maxPerTick ?? 1000;

    await fs.mkdir(path.dirname(doc.jsonlPath), { recursive: true });

    const { items, done } = await ctx.pullInputLines(max);

    if (items.length > 0) {
      const blob = items
        .map((x) =>
          typeof x === "string"
            ? (x.endsWith("\n") ? x : x + "\n")
            : JSON.stringify(x) + "\n",
        )
        .join("");
      await fs.appendFile(doc.jsonlPath, blob, "utf8");
      doc = { ...doc, lineCount: doc.lineCount + items.length };
    }

    if (!done) {
      const pause: PipelineOutcome<WithJsonl> = {
        done: false,
        reason: "awaiting-input",
        payload: { appended: items.length, total: doc.lineCount },
      };
      return pause;
    }

    return { ...doc, inputComplete: true };
  };

/**
 * Upload the completed JSONL input file to OpenAI (purpose: "batch").
 */
export const uploadInputFileStep: PipelineStep<WithJsonl, WithInputFile, IncCtx> =
  (ctx) => async (doc) => {
    const file = await ctx.openai.files.create({
      file: await toFile(openReadStream(doc.jsonlPath), path.basename(doc.jsonlPath)),
      purpose: "batch",
    });

    ctx.logger?.info?.(`Uploaded input file: ${file.id}`);

    return { ...doc, inputFileId: file.id };
  };

/**
 * Create a Batch job for the uploaded input file.
 *
 * The `endpoint` must match each line’s `url`.
 */
export const createBatchStep: PipelineStep<WithInputFile, WithBatch, IncCtx> =
  (ctx) => async (doc) => {
    const batch = await ctx.openai.batches.create({
      input_file_id: doc.inputFileId,
      endpoint: doc.endpoint,
      completion_window: doc.completionWindow,
    });

    ctx.logger?.info?.(`Batch created: ${batch.id} (${batch.status})`);

    return {
      ...doc,
      batchId: batch.id,
      status: batch.status as WithBatch["status"],
    };
  };

/**
 * Non-blocking wait: polls the batch status and pauses until terminal.
 *
 * Returns `{ done:false, reason: "batch:<status>" }` for non-terminal states.
 * Progresses when status ∈ { completed, failed, cancelled, expired }.
 */
export const waitUntilTerminalOrPauseStep: PipelineStep<WithBatch, WithBatch, IncCtx> =
  (ctx) => async (doc) => {
    const b = await ctx.openai.batches.retrieve(doc.batchId);
    const status = b.status as WithBatch["status"];
    const terminal = ["completed", "failed", "cancelled", "expired"].includes(status);

    if (!terminal) {
      const pause: PipelineOutcome<WithBatch> = {
        done: false,
        reason: `batch:${status}`,
        payload: {
          suggestedDelayMs: ctx.minPollIntervalMs ?? 60_000,
          status,
        },
      };
      return pause;
    }

    return { ...doc, status };
  };

/**
 * Capture OpenAI output and error file ids (when available).
 */
export const captureOutputFilesStep: PipelineStep<WithBatch, WithOutputFiles, IncCtx> =
  (ctx) => async (doc) => {
    const b = await ctx.openai.batches.retrieve(doc.batchId);
    return {
      ...doc,
      outputFileId: b.output_file_id ?? undefined,
      errorFileId: b.error_file_id ?? undefined,
    };
  };

/**
 * Download outputs (and errors, if any) into `outDir`.
 *
 * File names default to `${jobId}.output.jsonl` and `${jobId}.errors.jsonl`,
 * falling back to the `jsonlPath` basename if `jobId` is not set.
 */
export const downloadOutputsStep: PipelineStep<WithOutputFiles, WithDownloaded, IncCtx> =
  (ctx) => async (doc) => {
    const base = doc.jobId || path.basename(doc.jsonlPath, ".jsonl");

    let outputPath: string | undefined;
    let errorPath: string | undefined;

    if (doc.outputFileId) {
      outputPath = path.join(doc.outDir, `${base}.output.jsonl`);
      await downloadFile(ctx.openai, doc.outputFileId, outputPath);
      ctx.logger?.info?.(`Downloaded output → ${outputPath}`);
    }

    if (doc.errorFileId) {
      errorPath = path.join(doc.outDir, `${base}.errors.jsonl`);
      await downloadFile(ctx.openai, doc.errorFileId, errorPath);
      ctx.logger?.warn?.(`Downloaded errors → ${errorPath}`);
    }

    return {
      ...doc,
      outputPath,
      errorPath,
      outPos: 0,
      outCarry: undefined,
      processedCount: 0,
    };
  };

/**
 * Incrementally process the downloaded `output.jsonl`.
 *
 * Reads up to `ioSliceBytes` per tick, splits by newline, invokes `onOutputLine`
 * for each complete JSON record, and pauses if more remains.
 */
export const processOutputIncrementalStep: PipelineStep<WithDownloaded, WithDownloaded, IncCtx> =
  (ctx) => async (doc) => {
    if (!doc.outputPath) return doc;

    const budget = ctx.ioSliceBytes ?? 128 * 1024;
    const fh = await fs.open(doc.outputPath, "r");
    try {
      const st = await fh.stat();
      const start = doc.outPos ?? 0;
      if (start >= st.size) return doc;

      const end = Math.min(st.size, start + budget);
      const buf = Buffer.alloc(end - start);
      await fh.read(buf, 0, buf.length, start);

      const chunk = (doc.outCarry ?? "") + buf.toString("utf8");
      const parts = chunk.split("\n");
      const tail = parts.pop() ?? "";                 // partial line (if any)
      const rows = parts.filter(Boolean);

      for (const raw of rows) {
        const parsed = JSON.parse(raw);
        await ctx.onOutputLine?.(parsed);
      }

      const updated: WithDownloaded = {
        ...doc,
        outPos: end,
        outCarry: end === st.size ? undefined : tail, // persist carry only if not at EOF
        processedCount: (doc.processedCount ?? 0) + rows.length,
      };

      if (end < st.size) {
        // ⬅️ include `carry` so the caller can persist it across ticks
        return { done: false, reason: "processing-outputs", payload: { rows: rows.length, nextPos: end, carry: tail } };
      }

      return updated;
    } finally {
      await fh.close();
    }
  };


/** Apply cursor updates for 'processing-outputs' pauses. */
export function applyProcessingOutputsCursor<T extends { outPos?: number; processedCount?: number }>(
  doc: T,
  info?: { reason?: string; payload?: { nextPos?: number; rows?: number } }
): T {
  if (info?.reason !== "processing-outputs") return doc;
  const nextPos = info.payload?.nextPos;
  const rows = info.payload?.rows ?? 0;
  return {
    ...doc,
    outPos: nextPos ?? doc.outPos,
    processedCount: (doc.processedCount ?? 0) + rows,
  };
}