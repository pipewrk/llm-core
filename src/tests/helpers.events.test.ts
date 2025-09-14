import { describe, it, expect } from "bun:test";
import { pipeline, type PipelineStep } from "../core/pipeline";
import { eventsFromPipeline, pipelineToTransform, tap } from "../core/helpers";

describe("helpers: eventsFromPipeline and pipelineToTransform", () => {
  const ctx = { logger: { info() {}, warn() {}, error() {}, attn() {}, impt() {} }, pipeline: {} } as any;

  it("eventsFromPipeline emits progress and done", async () => {
    const p = pipeline<typeof ctx, { data: string }>(ctx)
      .addStep((_c) => async (d) => ({ data: d.data + "a" }))
      .addStep((_c) => async (d) => ({ data: d.data + "b" }));

    const initial = { data: "x" };
    const seen: string[] = [];

    const emitter = eventsFromPipeline(p, initial);
    await new Promise<void>((resolve, reject) => {
      emitter
        .on("progress", (evt) => {
          seen.push(evt.doc.data);
        })
        .on("done", () => resolve())
        .on("error", (err) => reject(err));
    });

    expect(seen).toEqual(["xa", "xab"]);
  });

  it("pipelineToTransform processes chunks and handles pause via handler", async () => {
    const pauseStep: PipelineStep<{ data: string }, { data: string }> = () => async () => ({
      done: false,
      reason: "wait",
      payload: {},
    });

    const p = pipeline<typeof ctx, { data: string }>(ctx)
      .addStep((_c) => (d) => ({ data: d.data + "1" }))
      .addStep(pauseStep)
      .addStep((_c) => (d) => ({ data: d.data + "2" }));

    let pauses = 0;
    const tr = pipelineToTransform(p as any, async () => {
      pauses++;
    });

    const outputs: string[] = [];
    tr.on("data", (buf) => outputs.push(String(buf).trim()))
      .on("end", () => {})
      .on("error", () => {});

    tr.write({ data: "x" });
    tr.end();

    await new Promise((r) => setTimeout(r, 10));

    expect(outputs).toEqual([JSON.stringify({ data: "x1" })]);
    expect(pauses).toBe(1);
  });
});

