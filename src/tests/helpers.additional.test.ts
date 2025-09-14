import { describe, it, expect } from "bun:test";
import { pipeline, type PipelineStep, type PipelineOutcome } from "../core/pipeline";
import {
  withCache,
  withTimeout,
  withRetry,
} from "../core/helpers";

describe("helpers additional coverage", () => {
  const ctx: any = { pipeline: {}, logger: { info() {}, warn() {}, error() {}, attn() {}, impt() {} } };

  it("withCache falls back when no cache configured", async () => {
    let calls = 0;
    const step: PipelineStep<{ data: string }, { data: string }> = () => async (d) => {
      calls++;
      return { data: d.data + "!" };
    };

    delete ctx.pipeline.cache;
    const p = pipeline(ctx).addStep(withCache(step, (d) => d.data));
    const r1 = await p.run({ data: "A" });
    const r2 = await p.run({ data: "A" });
    expect(r1.data).toBe("A!");
    expect(r2.data).toBe("A!");
    expect(calls).toBe(2);
  });

  it("withTimeout returns result when step wins the race", async () => {
    const fast: PipelineStep<{ data: string }, { data: string }> = () => async (d) => {
      return { data: d.data + "fast" };
    };

    ctx.pipeline.timeout = 50; // slower than the step
    const p = pipeline(ctx).addStep(withTimeout(fast));
    const out = await p.run({ data: "X" });
    expect(out.data).toBe("Xfast");
  });

  it("withRetry does not retry non-error pauses", async () => {
    const pause: PipelineStep<{ data: string }, { data: string }> = () => async (d) => {
      const o: PipelineOutcome<{ data: string }> = { done: false, reason: "wait", payload: d };
      return o;
    };

    ctx.pipeline.retries = 5;
    const p = pipeline(ctx).addStep(withRetry(pause));
    let paused = false;
    for await (const evt of p.stream({ data: "Y" })) {
      if (evt.type === "pause") {
        expect(evt.info.reason).toBe("wait");
        paused = true;
        break;
      }
    }
    expect(paused).toBe(true);
  });

  it("withRetry propagates done=true outcome without extra attempts", async () => {
    let attempts = 0;
    const doneStep: PipelineStep<{ data: string }, { data: string }> = () => async (d) => {
      attempts++;
      const o: PipelineOutcome<{ data: string }> = { done: true, value: { data: d.data + "D" } };
      return o;
    };

    ctx.pipeline.retries = 3;
    const p = pipeline(ctx).addStep(withRetry(doneStep));
    const result = await p.run({ data: "Q" });
    expect(result.data).toBe("QD");
    expect(attempts).toBe(1);
  });
});

