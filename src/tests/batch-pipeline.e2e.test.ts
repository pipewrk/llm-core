import { describe, it, expect, mock, beforeEach } from "bun:test";
import { fromArray, createJob, tickBatch, runBatch } from "../core/batch-openai-pipeline";
import { Readable } from "node:stream";
import path from "node:path";
import fs from "node:fs/promises";
import { MockLogger } from "./logger.mock";

function createReadable(data: string) { return Readable.from([data]); }

function fakeClientFactory(statuses: string[], outputLines: any[]) {
  let retrieveCalls = 0;
  const outputFileId = "out_file_1";
  const filesContentMock = mock().mockImplementation((fid: string) => {
    if (fid === outputFileId) {
      const body = outputLines.map(l => JSON.stringify(l)).join("\n") + "\n";
      return { body: createReadable(body) };
    }
    return { body: createReadable("") };
  });

  return {
    files: {
      create: mock().mockResolvedValue({ id: "in_file_1" }),
      content: filesContentMock,
    },
    batches: {
      create: mock().mockResolvedValue({ id: "batch_1", status: statuses[0] }),
      retrieve: mock().mockImplementation(() => {
        const st = statuses[Math.min(retrieveCalls, statuses.length - 1)];
        retrieveCalls++;
        return Promise.resolve({ id: "batch_1", status: st, output_file_id: st === "completed" ? outputFileId : undefined });
      }),
    },
  } as any;
}

describe("single batch pipeline e2e", () => {
  const tmpRoot = path.join(process.cwd(), "tmp-batch-e2e");
  let logger: MockLogger;

  beforeEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
    await fs.mkdir(tmpRoot, { recursive: true });
    logger = new MockLogger();
  });

  it("runBatch completes and processes outputs", async () => {
    const rows = [ { custom_id: "x1", method: "POST", url: "/v1/chat/completions", body: { model: "m", messages: [], max_tokens: 5 } } ];
    const outputLines = [ { custom_id: "x1", response: { body: { value: 42 } } } ];
    const client = fakeClientFactory(["validating","in_progress","completed"], outputLines);
    const processed: any[] = [];
    const final = await runBatch({ client, endpoint: "/v1/chat/completions", id: "job1", outDir: tmpRoot, rows, onOutputLine: (l) => { processed.push(l); } });
    expect(final.status).toBe("completed");
    expect(processed.length).toBe(1);
    expect(processed[0].response.body.value).toBe(42);
  });

  it("tickBatch non-blocking progression", async () => {
    
    const rows = [ { custom_id: "a", method: "POST", url: "/v1/embeddings", body: { model: "m", input: "hi" } } ];
    const outputLines = [ { custom_id: "a", response: { body: { embedding: [1,2,3] } } } ];
    const client = fakeClientFactory(["validating","in_progress","completed"], outputLines);

    const processed: any[] = [];
  const ctx = fromArray({ client, rows, onOutputLine: (l) => { processed.push(l); } });
    let doc: any = createJob({ id: "job2", outDir: tmpRoot, endpoint: "/v1/embeddings" });
    let resume: any = undefined;

    for (let i=0;i<60;i++) {
      const step = await tickBatch({ ctx, doc, resume });
      if (step.done) {
        expect(step.value.status).toBe("completed");
        break;
      }
      doc = step.doc;
      resume = step.resume;
      if (step.type === 'pause') {
        const reason = (step.info as any)?.reason as string | undefined;
        if (reason?.startsWith('batch:')) continue; // status polling
      }
      if (i === 59) throw new Error("tickBatch iteration cap reached");
    }

    expect(processed.length).toBe(1);
    expect(processed[0].custom_id).toBe("a");
    
  });
});
