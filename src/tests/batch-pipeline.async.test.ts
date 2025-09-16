import {describe, it, expect} from "bun:test";
import { fromAsync, createJob, tickBatch } from "../core/batch-openai-pipeline";
import type { Endpoint } from "../types/batch-openai";

class FakeFiles {
  store = new Map<string, any>();
  async create(opts: any) { return { id: `file_${this.store.size+1}` }; }
  async retrieve(id: string) { return this.store.get(id); }
  async content(id: string) { return new Response(this.store.get(id)?.content ?? "", { headers: { "content-type": "application/json" }}); }
}

class FakeBatches {
  statuses: string[];
  idx = 0;
  files: FakeFiles;
  constructor(files: FakeFiles, statuses: string[]) { this.files = files; this.statuses = statuses; }
  async create(opts: any) {
    return { id: "batch_1", status: this.statuses[0], output_file_ids: [], error_file_ids: [] };
  }
  async retrieve(id: string) {
    const status = this.statuses[Math.min(this.idx, this.statuses.length - 1)];
    const terminal = ["completed", "failed", "cancelled"].includes(status);
    if (!terminal) this.idx++;
    const outputFile = { id: "out_1", content: JSON.stringify({ out: this.idx }) + "\n" };
    this.files.store.set("out_1", outputFile);
    return { id: "batch_1", status, output_file_ids: ["out_1"], error_file_ids: [] };
  }
}

class FakeOpenAI { files = new FakeFiles(); batches = new FakeBatches(this.files, ["validating","in_progress","completed"]); }

describe("batch pipeline async source", () => {
  it("tickBatch advances with fromAsync context", async () => {
    const src: AsyncIterable<any> = {
      [Symbol.asyncIterator]() {
        let done = false;
        return {
          async next() {
            if (done) return { done: true, value: undefined };
            done = true;
            return { done: false, value: { custom_id: "1", method: "POST", url: "/v1/embeddings" as Endpoint, body: { input: "hi", model: "m" } } };
          },
        };
      },
    };
    const client = new FakeOpenAI() as any;
    const ctx = fromAsync({ client, src });
    const job = createJob({ id: "async1", outDir: ".", endpoint: "/v1/embeddings" });
    let doc: any = job;
    let resume: any | undefined;
    for (let i = 0; i < 20; i++) {
      const step = await tickBatch({ ctx, doc, resume });
      if (step.done) { expect(step.value.processedCount).toBeGreaterThanOrEqual(0); return; }
      doc = step.doc; resume = step.resume;
    }
    throw new Error("Did not complete within iteration budget");
  });
});
