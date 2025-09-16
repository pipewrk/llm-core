import { describe, it, expect, beforeEach, mock } from "bun:test";
import { OpenAIBatchServiceAdapter } from "../core/batch-openai-service";
import { Readable } from "node:stream";
import path from "node:path";
import fs from "node:fs/promises";
import { MockLogger } from "./logger.mock";

function createReadable(data: string) { return Readable.from([data]); }

// statuses sequence for initiate (validating -> in_progress) then poll (in_progress -> completed)
function makeClient(statusSeq: string[], outputs: any[]) {
  let retrieveIdx = 0;
  const outputFileId = "out_file_1";
  const contentMock = mock().mockImplementation((fid: string) => ({ body: createReadable(outputs.map(o => JSON.stringify(o)).join("\n") + "\n") }));
  return {
    files: {
      create: mock().mockResolvedValue({ id: "input_file_1" }),
      content: contentMock,
    },
    batches: {
      create: mock().mockResolvedValue({ id: "batchX", status: statusSeq[0] }),
      retrieve: mock().mockImplementation(() => {
        const st = statusSeq[Math.min(retrieveIdx, statusSeq.length - 1)];
        retrieveIdx++;
        return Promise.resolve({ id: "batchX", status: st, output_file_id: st === "completed" ? outputFileId : undefined });
      }),
    },
  } as any;
}

describe("OpenAIBatchServiceAdapter", () => {
  const tmpRoot = path.join(process.cwd(), "tmp-batch-adapter");
  let logger: MockLogger;

  beforeEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
    await fs.mkdir(tmpRoot, { recursive: true });
    logger = new MockLogger();
  });

  it("initiateBatch then pollBatch returns outputs", async () => {
    const outputs = [
      { custom_id: "c1", response: { body: { n: 1 } } },
      { custom_id: "c2", response: { body: { n: 2 } } },
    ];
    const client = makeClient(["validating", "in_progress", "in_progress", "completed"], outputs);

    const svc = new OpenAIBatchServiceAdapter({
      client,
      endpoint: "/v1/chat/completions",
      outDir: tmpRoot,
      defaultModel: "m",
      minPollIntervalMs: 0, // <-- ensure no sleep on batch:... pauses
    });

    const batchId = await svc.initiateBatch([
      { custom_id: "c1", systemPrompt: "s", userPrompt: "u1", options: { schema: {}, schema_name: "Resp", model: "m" } },
      { custom_id: "c2", systemPrompt: "s", userPrompt: "u2", options: { schema: {}, schema_name: "Resp", model: "m" } },
    ] as any);
    expect(typeof batchId).toBe("string");

    // Optional: keep your stub, but restore it after
    const originalSetTimeout = global.setTimeout;
    (global as any).setTimeout = (fn: any, _ms?: number) => originalSetTimeout(fn, 0);

    const res = await svc.pollBatch<{ n: number }>(batchId, ["c1", "c2"]);
    expect(res.c1.n).toBe(1);
    expect(res.c2.n).toBe(2);

    (global as any).setTimeout = originalSetTimeout; // <-- restore!

    // ensure store cleared
    const again = await (svc as any).store.get(batchId);
    expect(again).toBeUndefined();
  });
});
