import { describe, it, expect } from "bun:test";
import { pipeline, type PipelineStep, isPipelineOutcome } from "../core/pipeline";
import { withSequence } from "src/core/helpers";

describe("pipeline (new API)", () => {
  const ctx = { logger: { info() {}, warn() {}, error() {}, attn() {}, impt() {} } } as any;

  it("run processes steps and returns final doc", async () => {
    const p = pipeline<typeof ctx, { v: number }>(ctx)
      .addStep((_c) => (d) => ({ v: d.v + 1 }))
      .addStep((_c) => (d) => ({ v: d.v * 2 }));

    const out = await p.run({ v: 2 });
    expect(out.v).toBe(6);
  });

  it("run resolves early on pause", async () => {
    const pause: PipelineStep<{ v: number }, { v: number }> = () => async () => ({
      done: false,
      reason: "hitl",
      payload: {},
    });
    const p = pipeline<typeof ctx, { v: number }>(ctx)
      .addStep((_c) => (d) => ({ v: d.v + 1 }))
      .addStep(pause)
      .addStep((_c) => (d) => ({ v: d.v + 100 }));

    const out = await p.run({ v: 1 });
    // early resolve keeps doc as of previous progress
    expect(out.v).toBe(2);
  });

  it("stream yields resume token and supports next(resume)", async () => {
    const p = pipeline<typeof ctx, { s: string }>(ctx)
      .addStep((_c) => (d) => ({ s: d.s + "A" }))
      .addStep((_c) => (d) => ({ s: d.s + "B" }));

    let resume: { nextStep: number; doc: { s: string } } | undefined;
    for await (const evt of p.stream({ s: "X" })) {
      if (evt.type === "progress") { resume = evt.resume; break; }
    }
    expect(resume?.doc.s).toBe("XA");

    const n = await p.next(resume!.doc, resume);
    if ("type" in n && n.type === "progress") {
      expect(n.doc.s).toBe("XAB");
    } else {
      throw new Error("expected progress event");
    }
  });

  it("withSequence runs subs with stopCondition and propagates pause", async () => {
    const pause: PipelineStep<{ s: string }, { s: string }> = () => async () => ({
      done: false,
      reason: "wait",
      payload: {},
    });
    // Use helpers.withSequence to compose sub-steps into a single step
    const p = pipeline<typeof ctx, { s: string }>(ctx)
      .addStep(withSequence([
        (_c) => (d) => ({ s: d.s + "1" }),
        pause,
        (_c) => (d) => ({ s: d.s + "2" }),
      ]));

    const it = p.stream({ s: "a" });
    const first = await it.next();
    // multi strategy returns a pause immediately (no progress)
    expect(!first.done && first.value.type === "pause").toBe(true);
  });
});
