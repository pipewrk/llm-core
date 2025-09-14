import { beforeEach, describe, expect, it } from "bun:test";
import type { ILogger } from "../types/dataset";
import type { PipelineOutcome, PipelineStep } from "../core/pipeline";
import { pipeline } from "../core/pipeline";
import { MockLogger } from "./logger.mock";
import { setEnv } from "../core/env";
import { withErrorHandling, withRetry, withTimeout, withCache, tap, withSequence, pipeSteps, withAlternatives } from "../core/helpers";

describe("Helper Function Tests", () => {
  let logger: MockLogger;
  let ctx: { logger: ILogger; pipeline: any; state: any };

  beforeEach(() => {
    logger = new MockLogger();
    logger.clear();
    setEnv("LOG_PATH", "./");

    ctx = {
      logger,
      pipeline: {},
      state: { history: [] },
    };
  });

  describe("pipeSteps (identity composition)", () => {
    it("runs all identity steps left-to-right when none pause", async () => {
      type Ctx = { count: number };

      const ctx2: Ctx = { count: 0 };
      const t1: PipelineStep<string, string, Ctx> = (c) => (doc) => {
        c.count += 1;
        return doc + "A";
      };

      const t2: PipelineStep<string, string, Ctx> = (c) => (doc) => {
        c.count += 2;
        return doc + "B";
      };

      const piped = pipeSteps<string, Ctx>(t1, t2);
      const p = pipeline<Ctx, string>(ctx2).addStep(piped);
      const result = await p.run("X");

      expect(ctx2.count).toBe(3);
      expect(result).toBe("XAB");
    });

    it("short‑circuits and propagates a pause outcome", async () => {
      type Ctx = { count: number };
      const ctx2: Ctx = { count: 0 };

      const t1: PipelineStep<string, string, Ctx> = () => async (doc) => {
        const outcome: PipelineOutcome<string> = {
          done: false,
          reason: "halt",
          payload: doc,
        };
        return outcome;
      };

      const t2: PipelineStep<string, string, Ctx> = (c) => (doc) => {
        c.count += 10;
        return doc + "Z";
      };

      const piped = pipeSteps<string, Ctx>(t1, t2);
      const p = pipeline<Ctx, string>(ctx2).addStep(piped);

      let paused = false;
      for await (const evt of p.stream("X")) {
        if (evt.type === "pause") {
          paused = true;
          const outcome = evt.info as Extract<PipelineOutcome<string>, { done: false }>;
          expect(outcome.reason).toBe("halt");
          expect(outcome.payload).toBe("X");
          break;
        }
      }
      expect(paused).toBe(true);
      expect(ctx2.count).toBe(0);
    });
  });

  // compose() helper removed in favor of pipeSteps for identity steps


  describe("withErrorHandling", () => {
    it("run returns original document on error", async () => {
      const errorStep: PipelineStep<{ data: string }, { data: string }> =
        () => async (doc) => {
          throw new Error("fail");
        };

      const p = pipeline<typeof ctx, { data: string }>(ctx).addStep(withErrorHandling(errorStep));
      const result = await p.run({ data: "orig" });
      expect(result.data).toBe("orig");
    });

    it("stream yields a pause event on error", async () => {
      const errorStep: PipelineStep<{ data: string }, { data: string }> =
        () => async () => {
          throw new Error("fail");
        };

      const p = pipeline<typeof ctx, { data: string }>(ctx).addStep(withErrorHandling(errorStep));
      for await (const evt of p.stream({ data: "x" })) {
        if (evt.type === "pause") {
          const outcome = evt.info as Extract<
            PipelineOutcome<{ data: string }>,
            { done: false }
          >;
          expect(outcome.reason).toBe("error");
          break;
        }
      }
    });
  });

  describe("withRetry", () => {
    it("retries on error then succeeds (run)", async () => {
      let calls = 0;
      const flaky: PipelineStep<{ data: string }, { data: string }> =
        () => async (doc) => {
          if (calls++ < 1) throw new Error("err");
          return { data: doc.data + "|ok" };
        };

      ctx.pipeline.retries = 1;
      const p = pipeline<typeof ctx, { data: string }>(ctx).addStep(withRetry(flaky));
      const result = await p.run({ data: "start" });
      expect(result.data).toBe("start|ok");
      expect(calls).toBe(2);
    });

    it("stream yields only the final retryExceeded pause", async () => {
      const alwaysFail: PipelineStep<{ data: string }, { data: string }> =
        () => async () => {
          throw new Error("fail");
        };

      ctx.pipeline.retries = 2;
      const p = pipeline<typeof ctx, { data: string }>(ctx).addStep(withRetry(alwaysFail));

      for await (const evt of p.stream({ data: "Y" })) {
        if (evt.type === "pause") {
          const outcome = evt.info as Extract<
            PipelineOutcome<{ data: string }>,
            { done: false }
          >;
          if (outcome.reason === "retryExceeded") {
            expect(outcome.reason).toBe("retryExceeded");
            break;
          }
        }
      }
    });
  });

  describe("withTimeout", () => {
    it("run does not time out when timeout=0 (disabled)", async () => {
      const slow: PipelineStep<{ data: string }, { data: string }> = () => () =>
        new Promise((res) => setTimeout(() => res({ data: "late" }), 10));

      ctx.pipeline.timeout = 0; // disabled
      const p = pipeline<typeof ctx, { data: string }>(ctx).addStep(withTimeout(slow));
      const result = await p.run({ data: "init" });
      expect(result.data).toBe("late");
    });

    it("stream yields timeout pause", async () => {
      const slow: PipelineStep<{ data: string }, { data: string }> = () => () =>
        new Promise((res) => setTimeout(() => res({ data: "late" }), 10));

      ctx.pipeline.timeout = 1; // shorter than step delay
      const p = pipeline<typeof ctx, { data: string }>(ctx).addStep(withTimeout(slow));
      for await (const evt of p.stream({ data: "in" })) {
        if (evt.type === "pause") {
          const outcome = evt.info as Extract<
            PipelineOutcome<{ data: string }>,
            { done: false }
          >;
          expect(outcome.reason).toBe("timeout");
          break;
        }
      }
    });
  });

  describe("withCache", () => {
    it("run caches successful results", async () => {
      let hits = 0;
      const step: PipelineStep<{ data: string }, { data: string }> =
        () => async (doc) => {
          hits++;
          return { data: doc.data + "|c" };
        };

      ctx.pipeline.cache = new Map();
      const p = pipeline<typeof ctx, { data: string }>(ctx).addStep(withCache(step, (d) => d.data));

      const r1 = await p.run({ data: "A" });
      const r2 = await p.run({ data: "A" });
      expect(r1.data).toBe("A|c");
      expect(r2.data).toBe("A|c");
      expect(hits).toBe(1);
    });

    it("stream reuses cache for same key", async () => {
      let hits = 0;
      const step: PipelineStep<{ data: string }, { data: string }> =
        () => async (doc) => {
          hits++;
          return { data: doc.data + "|c" };
        };

      ctx.pipeline.cache = new Map();
      const p = pipeline<typeof ctx, { data: string }>(ctx).addStep(withCache(step, (d) => d.data));

      // first pass
      for await (const _ of p.stream({ data: "B" })) {
      }
      // second pass same key
      for await (const _ of p.stream({ data: "B" })) {
      }
      expect(hits).toBe(1);
    });
  });

  describe("tap helper", () => {
    it("run executes side effect and leaves doc unchanged", async () => {
      let called = 0;
      const t = tap<{ data: string }, typeof ctx>((c, d) => {
        called++;
        c.logger.info("tapped");
      });

      const p = pipeline<typeof ctx, { data: string }>(ctx).addStep(t);
      const result = await p.run({ data: "unchanged" });
      expect(called).toBe(1);
      expect(result.data).toBe("unchanged");
      expect(logger.logs.info).toContain("tapped");
    });

    it("stream yields progress event without altering doc", async () => {
      let called = 0;
      const t = tap<{ data: string }, typeof ctx>((c, d) => {
        called++;
      });

      const p = pipeline<typeof ctx, { data: string }>(ctx).addStep(t);
      for await (const evt of p.stream({ data: "X" })) {
        if (evt.type === "progress") {
          expect(evt.doc.data).toBe("X");
        }
      }
      expect(called).toBe(1);
    });
  });

  describe("withSequence", () => {
    it("run stops when stopCondition is met", async () => {
      const sub1: PipelineStep<{ data: string }, { data: string }> = () => (doc: { data: string }) => ({
        data: doc.data + "1",
      });
      const sub2: PipelineStep<{ data: string }, { data: string }> = () => (doc: { data: string }) => ({
        data: doc.data + "2",
      });

      ctx.pipeline.stopCondition = (doc: { data: string }) => doc.data.endsWith("1");
      const p = pipeline<typeof ctx, { data: string }>(ctx).addStep(withSequence([sub1, sub2]));

      const result = await p.run({ data: "X" });
      expect(result.data).toBe("X1");
    });

    it("stream yields progress events until stopCondition", async () => {
      const sub1: PipelineStep<{ data: string }, { data: string }> = () => (doc: { data: string }) => ({
        data: doc.data + "A",
      });
      const sub2: PipelineStep<{ data: string }, { data: string }> = () => (doc: { data: string }) => ({
        data: doc.data + "B",
      });

      ctx.pipeline.stopCondition = (doc: { data: string }) => doc.data.includes("AB");
      const p = pipeline<typeof ctx, { data: string }>(ctx).addStep(withSequence([sub1, sub2]));

      const seen: string[] = [];
      for await (const evt of p.stream({ data: "Z" })) {
        if (evt.type === "progress") seen.push(evt.doc.data);
      }
      expect(seen).toEqual(["ZAB"]);
    });

    it("propagates done=true value and continues with next strategy", async () => {
      const sub1: PipelineStep<{ data: string }, { data: string }> = () => async (doc) => ({
        done: true,
        value: { data: doc.data + "X" },
      });
      const sub2: PipelineStep<{ data: string }, { data: string }> = () => async (doc) => ({
        data: doc.data + "Y",
      });

      const p = pipeline<typeof ctx, { data: string }>(ctx).addStep(withSequence([sub1, sub2]));
      const result = await p.run({ data: "_" });
      expect(result.data).toBe("_XY");
    });
  });

  describe("withAlternatives", () => {
    it("uses the first acceptable strategy via explicit stopCondition", async () => {
      const s1: PipelineStep<{ data: string }, { data: string }> =
        () => (doc) => ({ data: doc.data + "A" });
      const s2: PipelineStep<{ data: string }, { data: string }> =
        () => (doc) => ({ data: doc.data + "B" });

      const accept = (out: { data: string }) => out.data.endsWith("A");
      const p = pipeline<typeof ctx, { data: string }>(ctx)
        .addStep(withAlternatives([s1, s2], accept));

      const result = await p.run({ data: "X" });
      expect(result.data).toBe("XA"); // s1 accepted; s2 never runs
    });

    it("falls back to ctx.pipeline.stopCondition when none is provided", async () => {
      const s1: PipelineStep<{ data: string }, { data: string }> =
        () => (doc) => ({ data: doc.data + "1" });
      const s2: PipelineStep<{ data: string }, { data: string }> =
        () => (doc) => ({ data: doc.data + "2" });

      ctx.pipeline.stopCondition = (out: { data: string }) => out.data.includes("2");
      const p = pipeline<typeof ctx, { data: string }>(ctx)
        .addStep(withAlternatives([s1, s2]));

      const res = await p.run({ data: "A" });
      // s1 => "A1" (not accepted), s2 => "A12" (accepted)
      expect(res.data).toBe("A12");
    });

    it("propagates a pause from a strategy without running later ones", async () => {
      const pause: PipelineStep<{ data: string }, { data: string }> =
        () => async (_doc) =>
          ({ done: false, reason: "error", payload: { data: "ignored" } });

      const never: PipelineStep<{ data: string }, { data: string }> =
        () => (_doc) => ({ data: "SHOULD_NOT_RUN" });

      const p = pipeline<typeof ctx, { data: string }>(ctx)
        .addStep(withAlternatives([pause, never], () => true));

      const res = await p.next({ data: "_" });

      // res is a StreamEvent, not a raw PipelineOutcome
      if ("type" in res && res.type === "pause") {
        const info = res.info as Extract<PipelineOutcome<{ data: string }>, { done: false }>;
        expect(info.reason).toBe("error");
      } else {
        throw new Error("Expected a pause event");
      }
    });

    it("promotes {done:true, value} output and can still try next strategy if not accepted", async () => {
      const s1: PipelineStep<{ data: string }, { data: string }> =
        () => async (doc) => ({ done: true, value: { data: doc.data + "X" } });
      const s2: PipelineStep<{ data: string }, { data: string }> =
        () => (doc) => ({ data: doc.data + "Y" });

      const accept = (out: { data: string }) => out.data.endsWith("Y");
      const p = pipeline<typeof ctx, { data: string }>(ctx)
        .addStep(withAlternatives([s1, s2], accept));

      const res = await p.run({ data: "_" });
      // s1 yields "_X" (not accepted) → s2 yields "_XY" (accepted)
      expect(res.data).toBe("_XY");
    });

    it("returns the last successful output if no strategy meets the stopCondition", async () => {
      const s1: PipelineStep<{ data: string }, { data: string }> =
        () => (doc) => ({ data: doc.data + "A" });
      const s2: PipelineStep<{ data: string }, { data: string }> =
        () => (doc) => ({ data: doc.data + "B" });

      const neverAccept = () => false;
      const p = pipeline<typeof ctx, { data: string }>(ctx)
        .addStep(withAlternatives([s1, s2], neverAccept));

      const res = await p.run({ data: "Z" });
      // neither accepted → last output wins ("ZAB")
      expect(res.data).toBe("ZAB");
    });
  });

  describe("pipeSteps done=true propagation", () => {
    it("uses done=true value as input to subsequent steps", async () => {
      const s1: PipelineStep<string, string, typeof ctx> = () => async (doc) => ({ done: true, value: doc + "A" });
      const s2: PipelineStep<string, string, typeof ctx> = () => async (doc) => doc + "B";

      const piped = pipeSteps<string, typeof ctx>(s1, s2);
      const p = pipeline<typeof ctx, string>(ctx).addStep(piped);
      const result = await p.run("_");
      expect(result).toBe("_AB");
    });
  });
});
