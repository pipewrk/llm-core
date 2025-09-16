import { describe, expect, it, beforeEach, mock } from "bun:test";
import { buildInputIncrementalStep, uploadInputFileStep, createBatchStep, waitUntilTerminalOrPauseStep, captureOutputFilesStep, downloadOutputsStep, processOutputIncrementalStep } from "../core/batch-steps";
import { MockLogger } from "./logger.mock";
import fs from "node:fs/promises";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";

// Minimal fake OpenAI client pieces we exercise
function makeFakeClient(overrides: Partial<any> = {}) {
  return {
    files: {
      create: mock().mockResolvedValue({ id: "file_in_123" }),
      content: mock().mockImplementation((_id: string) => ({ body: createReadable("line1\nline2\n") })),
    },
    batches: {
      create: mock().mockResolvedValue({ id: "batch_123", status: "validating" }),
      retrieve: mock().mockResolvedValue({ id: "batch_123", status: "completed", output_file_id: "of_1", error_file_id: undefined }),
    },
    ...overrides,
  };
}

function createReadable(data: string) { return Readable.from([data]); }

describe("batch steps", () => {
  const tmpRoot = path.join(process.cwd(), "tmp-test-batch-steps");
  const inputPath = path.join(tmpRoot, "job.input.jsonl");
  let logger: MockLogger;
  let client: any;
  let ctx: any;

  beforeEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
    await fs.mkdir(tmpRoot, { recursive: true });
    logger = new MockLogger();
    client = makeFakeClient();
    ctx = {
      openai: client,
      logger,
      maxPerTick: 2,
      ioSliceBytes: 1024,
      pullInputLines: async (max: number) => ({ items: [ { a: 1 }, { b: 2 } ].slice(0, max), done: true }),
      onOutputLine: mock(),
    };
  });

  it("buildInputIncrementalStep writes lines and marks complete", async () => {
    const step = buildInputIncrementalStep(ctx);
  const doc0 = { jobId: "job", endpoint: "/v1/chat/completions" as const, completionWindow: "24h" as const, outDir: tmpRoot, jsonlPath: inputPath, lineCount: 0, inputComplete: false };
  const out = await step(doc0);
    const text = await fs.readFile(inputPath, "utf8");
    expect(text.split("\n").filter(Boolean).length).toBe(2);
    expect((out as any).inputComplete).toBe(true);
    expect((out as any).lineCount).toBe(2);
  });

  it("uploadInputFileStep uploads", async () => {
    const up = uploadInputFileStep(ctx);
    const doc = { jobId: "job", endpoint: "/v1/chat/completions" as const, completionWindow: "24h" as const, outDir: tmpRoot, jsonlPath: inputPath, lineCount: 0, inputComplete: true };
    await fs.writeFile(inputPath, "{\"a\":1}\n");
    const out = await up(doc as any);
    if ((out as any).done === false) throw new Error("unexpected pause");
    expect((out as any).inputFileId).toBe("file_in_123");
    expect(client.files.create.mock.calls.length).toBe(1);
  });

  it("createBatchStep creates batch", async () => {
    const step = createBatchStep(ctx);
    const doc = { jobId: "job", endpoint: "/v1/chat/completions" as const, completionWindow: "24h" as const, outDir: tmpRoot, jsonlPath: inputPath, lineCount: 2, inputComplete: true, inputFileId: "file_in_123" };
    const out = await step(doc as any);
    if ((out as any).done === false) throw new Error("unexpected pause");
    expect((out as any).batchId).toBe("batch_123");
    expect((out as any).status).toBe("validating");
  });

  it("waitUntilTerminalOrPauseStep pauses then completes", async () => {
    // First call returns non-terminal -> pause
    client.batches.retrieve.mockResolvedValueOnce({ id: "batch_123", status: "in_progress" });
    const step = waitUntilTerminalOrPauseStep(ctx);
  const doc = { jobId: "job", endpoint: "/v1/chat/completions" as const, completionWindow: "24h" as const, outDir: tmpRoot, jsonlPath: inputPath, lineCount: 2, inputComplete: true, inputFileId: "file_in_123", batchId: "batch_123", status: "validating" };
    const pause = await step(doc as any);
    expect((pause as any).done).toBe(false);
    expect((pause as any).reason).toBe("batch:in_progress");

    // Second resolves to terminal
    client.batches.retrieve.mockResolvedValueOnce({ id: "batch_123", status: "completed" });
    const done = await step(doc as any);
    if ((done as any).done === false) throw new Error("expected terminal");
    expect((done as any).status).toBe("completed");
  });

  it("captureOutputFilesStep captures ids", async () => {
    const step = captureOutputFilesStep(ctx);
    const doc = { jobId: "job", endpoint: "/v1/chat/completions" as const, completionWindow: "24h" as const, outDir: tmpRoot, jsonlPath: inputPath, lineCount: 2, inputComplete: true, inputFileId: "file_in_123", batchId: "batch_123", status: "completed" };
    const out = await step(doc as any);
    if ((out as any).done === false) throw new Error("unexpected pause");
    expect((out as any).outputFileId).toBe("of_1");
  });

  it("downloadOutputsStep downloads file", async () => {
    const step = downloadOutputsStep(ctx);
    const doc = { jobId: "job", endpoint: "/v1/chat/completions" as const, completionWindow: "24h" as const, outDir: tmpRoot, jsonlPath: inputPath, lineCount: 2, inputComplete: true, inputFileId: "file_in_123", batchId: "batch_123", status: "completed", outputFileId: "of_1" };
    const out = await step(doc as any);
    if ((out as any).done === false) throw new Error("unexpected pause");
    expect((out as any).outputPath).toBe(path.join(tmpRoot, "job.output.jsonl"));
    const content = await fs.readFile((out as any).outputPath!, "utf8");
    expect(content).toContain("line1");
  });

  it("processOutputIncrementalStep processes chunks and pauses", async () => {
    // Prepare output file with 3 lines
    const outputPath = path.join(tmpRoot, "job.output.jsonl");
    const lines = Array.from({ length: 5 }, (_, i) => JSON.stringify({ custom_id: `c${i}`, response: { body: { v: i } } }));
    await fs.writeFile(outputPath, lines.join("\n") + "\n", "utf8");

    const processed: any[] = [];
    ctx.onOutputLine = async (l: any) => processed.push(l);
    ctx.ioSliceBytes = 100; // small slices to force pause

    const step = processOutputIncrementalStep(ctx);
  let doc: any = { jobId: "job", endpoint: "/v1/chat/completions" as const, completionWindow: "24h" as const, outDir: tmpRoot, jsonlPath: inputPath, lineCount: 5, inputComplete: true, inputFileId: "file_in_123", batchId: "batch_123", status: "completed", outputFileId: "of_1", outputPath, outPos: 0, processedCount: 0 };

    // Loop until done
    for (let i = 0; i < 10; i++) {
      const r = await step(doc);
      if ((r as any).done === false) {
        const p = (r as any).payload || {};
        doc = {
          ...doc,
          outPos: p.nextPos ?? doc.outPos,
          processedCount: (doc.processedCount || 0) + (p.rows || 0),
          outCarry: p.carry ?? doc.outCarry, 
        };
      } else {
        doc = r as any; 
        break;
      }
    }

    expect(processed.length).toBe(5);
    expect(processed[0].custom_id).toBe("c0");
  });
});
