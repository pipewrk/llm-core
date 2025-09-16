import { describe, it, expect, mock } from "bun:test";
import { pipeline, type PipelineStep } from "../core/pipeline";
import { eventsFromPipeline, pipelineToTransform } from "../core/helpers";

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

  it("pipelineToTransform does not push on pause (calls onPause and stops chunk)", async () => {
    let calls = 0;

    const pauseEvt = {
      type: "pause" as const,
      step: 2,
      doc: { data: "x" },
      info: { done: false as const, reason: "processing-outputs", payload: { nextPos: 10, rows: 1 } },
      resume: { nextStep: 2, doc: { data: "x" } },
    };

    const p = {
      async next(_doc: { data: string }) {
        calls++;
        return pauseEvt;
      },
    };

    const onPause = mock().mockResolvedValue(undefined);
    const tr = pipelineToTransform(p as any, onPause);
    const outputs: string[] = [];
    tr.on("data", (buf) => outputs.push(String(buf).trim()));
    tr.write({ data: "x" });
    tr.end();
    await new Promise((r) => setTimeout(r, 5));

    expect(outputs).toEqual([]);        // pause should not push
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(calls).toBe(1);
  });

  it("pipelineToTransform pushes progress docs and then final exactly once", async () => {
    let i = 0;
    const seq = [
      {
        type: "progress" as const,
        step: 0,
        doc: { data: "mid" },
        resume: { nextStep: 1, doc: { data: "mid" } },
      },
      { done: true as const, value: { data: "final" } },
    ];

    const p = {
      async next(_doc: { data: string }) {
        return seq[Math.min(i++, seq.length - 1)];
      },
    };

    const tr = pipelineToTransform(p as any);
    const outputs: string[] = [];
    tr.on("data", (buf) => outputs.push(String(buf).trim()));
    tr.write({ data: "start" });
    tr.end();
    await new Promise((r) => setTimeout(r, 5));

    expect(outputs).toEqual([
      JSON.stringify({ data: "mid" }),
      JSON.stringify({ data: "final" }),
    ]);
  });

  it("pipelineToTransform forwards errors from next() to 'error' event", async () => {
    const p = {
      async next() {
        throw new Error("boom");
      },
    };
    const tr = pipelineToTransform(p as any);
    const errors: string[] = [];
    tr.on("error", (e) => errors.push((e as Error).message));
    tr.write({});
    tr.end();
    await new Promise((r) => setTimeout(r, 5));
    expect(errors[0]).toBe("boom");
  });
});
