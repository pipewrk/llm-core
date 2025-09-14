import { beforeEach, describe, expect, it } from "bun:test";
import type { ILogger } from "../types/dataset";
import type { PipelineStep, StreamEvent } from "../core/pipeline";
import { pipeline } from "../core/pipeline";
import { MockLogger } from "./logger.mock";
import { appendStep, uppercaseStep } from "./steps.mock";
import { setEnv } from "../core/env";

describe("Generic Pipeline Tests", () => {
  let logger: MockLogger;
  let ctx: { logger: ILogger; pipeline?: any; state?: any };

  beforeEach(() => {
    logger = new MockLogger();
    logger.clear();
    setEnv("LOG_PATH", "./");

    // Build the full pipeline context once per test
    ctx = {
      logger,
      pipeline: {}, // no timeouts/retries/cache/stopCondition by default
      state: { history: [] }, // empty history
    };
  });

  it("should execute a single pipeline step correctly", async () => {
    const initialData = { data: "Hello" };

    // wrap appendStep to pull logger off ctx
    const step: PipelineStep<typeof initialData, typeof initialData> = (c) =>
      appendStep(" World")((c as any).logger);

    const testPipeline = pipeline<typeof ctx, typeof initialData>(ctx).addStep(step);

    const result = await testPipeline.run(initialData);

    expect(result.data).toBe("Hello World");
    expect(logger.logs.info).toContain('Appending " World" to data.');
    expect(logger.logs.error.length).toBe(0);
  });

  it("should execute multiple pipeline steps in order", async () => {
    const initialData = { data: "Hello" };

    const p = pipeline<typeof ctx, { data: string }>(ctx)
      .addStep((c) => appendStep(" World")((c as any).logger))
      .addStep((c) => uppercaseStep((c as any).logger));

    const result = await p.run(initialData);

    expect(result.data).toBe("HELLO WORLD");
    expect(logger.logs.info).toContain('Appending " World" to data.');
    expect(logger.logs.info).toContain("Transforming data to uppercase.");
    expect(logger.logs.error.length).toBe(0);
  });

  it("should log errors within pipeline steps", async () => {
    const initialData = { data: "Hello" };

    // Now errorStep uses ctx.logger
    const errorStep: PipelineStep<typeof initialData, typeof initialData> =
      (c) => async (doc) => {
        (c as any).logger.info("Executing error step.");
        throw new Error("Test Error");
      };

    const p = pipeline<typeof ctx, typeof initialData>(ctx)
      .addStep((c) => appendStep(" World")((c as any).logger))
      .addStep(errorStep)
      .addStep((c) => uppercaseStep((c as any).logger));

    const result = await p.run(initialData);

    expect(logger.logs.info).toContain('Appending " World" to data.');
    expect(logger.logs.info).toContain("Executing error step.");
    // expect(logger.logs.error[0]).toContain("Test Error");
  });

  it("should work with different generic types", async () => {
    // For numbers, wrap steps similarly
    const p = pipeline<typeof ctx, number>({
      logger,
      pipeline: {},
      state: { history: [] },
    } as { logger: ILogger; pipeline?: any; state?: any })
      .addStep((c) => async (num: number) => {
        (c as any).logger.info(`Multiplying ${num} by 2.`);
        return num * 2;
      })
      .addStep((c) => async (num: number) => {
        (c as any).logger.info(`Adding 10 to ${num}.`);
        return num + 10;
      });

    const result = await p.run(5);

    expect(result).toBe(20);
    expect(logger.logs.info).toContain("Multiplying 5 by 2.");
    expect(logger.logs.info).toContain("Adding 10 to 10.");
    expect(logger.logs.error.length).toBe(0);
  });

  it("should maintain immutability by not altering the original input", async () => {
    const initialData = { data: "Hello" };
    const initialDataCopy = { ...initialData };

    const p = pipeline<typeof ctx, { data: string }>(ctx).addStep((c) => appendStep(" World")((c as any).logger));

    const result = await p.run(initialData);

    expect(initialData).toEqual(initialDataCopy);
    expect(result.data).toBe("Hello World");
    expect(logger.logs.info).toContain('Appending " World" to data.');
  });
});

describe("Pipeline Stream Tests", () => {
  let logger: MockLogger;
  let ctx: { logger: ILogger; pipeline?: any; state?: any };

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

  const doneStep: PipelineStep<{ data: string }, { data: string }> =
    () => async (doc) => ({
      done: true,
      reason: "Completed early",
      value: { data: `${doc.data} (done)` },
    });

  it("should complete pipeline with a done: true outcome", async () => {
    const finalOutcomeStep: PipelineStep<{ data: string }, { data: string }> =
      (c) => async (doc) => {
        (c as any).logger.info("Returning final done:true outcome");
        return {
          done: true,
          reason: "Completion",
          value: { data: doc.data + " +Finalised" },
        };
      };

    const p = pipeline<typeof ctx, { data: string }>(ctx).addStep(finalOutcomeStep);
    const result = await p.run({ data: "Start" });

    expect(result.data).toBe("Start +Finalised");
    expect(logger.logs.info).toContain("Returning final done:true outcome");
  });

  it("should update final when step returns done: true", async () => {
    const p = pipeline<typeof ctx, { data: string }>(ctx).addStep(doneStep);
    const result = await p.run({ data: "Finished" });
    expect(result.data).toBe("Finished (done)");
  });

  it("should continue through done: true in run()", async () => {
    const p = pipeline<typeof ctx, { data: string }>(ctx)
      .addStep(doneStep)
      .addStep((c) => uppercaseStep((c as any).logger));

    const result = await p.run({ data: "Run" });
    // doneStep.value → { data: "Run (done)" } then uppercase
    expect(result.data).toBe("RUN (DONE)");
  });

  it("should yield progress.doc when done: true via stream()", async () => {
    const p = pipeline<typeof ctx, { data: string }>(ctx).addStep(doneStep);
    const seen: string[] = [];

    for await (const evt of p.stream({ data: "Stream" })) {
      if (evt.type === "progress") {
        seen.push(evt.doc.data);
      }
    }

    expect(seen).toEqual(["Stream (done)"]);
  });

  it("should stream each intermediate step", async () => {
    const p = pipeline<typeof ctx, { data: string }>(ctx)
      .addStep((c) => appendStep(" World")((c as any).logger))
      .addStep((c) => uppercaseStep((c as any).logger));

    const seen: string[] = [];
    for await (const evt of p.stream({ data: "Hello" })) {
      if (evt.type === "progress") seen.push(evt.doc.data);
    }

    expect(seen).toEqual(["Hello World", "HELLO WORLD"]);
  });

  it("should yield a pause event when a step pauses", async () => {
    const hitlStep: PipelineStep<{ data: string }, { data: string }> =
      () => async (doc) => {
        logger.info("Pausing for HITL...");
        return {
          done: false,
          reason: "human-input",
          payload: { hint: "continue?" },
        };
      };

    const p = pipeline<typeof ctx, { data: string }>(ctx)
      .addStep((c) => appendStep(", John")((c as any).logger))
      .addStep(hitlStep)
      .addStep((c) => uppercaseStep((c as any).logger));

    const events = [];
    for await (const evt of p.stream({ data: "Hi" })) {
      events.push(evt);
      // stop once we hit the first pause
      if (evt.type === "pause") break;
    }

    expect(events).toHaveLength(2);
    // first is progress
    expect(events[0]).toMatchObject({
      type: "progress",
      step: 0,
      doc: { data: "Hi, John" },
    });

    // second is pause
    const pauseEvt = events[1] as Extract<
      StreamEvent<{ data: string }>,
      { type: "pause" }
    >;
    expect(pauseEvt.type).toBe("pause");
    expect(pauseEvt.info).toMatchObject({
      done: false,
      reason: "human-input",
      payload: { hint: "continue?" },
    });
    expect(logger.logs.info).toContain("Pausing for HITL...");
  });

  it("should continue after an error in stream()", async () => {
    const errorStep: PipelineStep<{ data: string }, { data: string }> =
      () => async () => {
        logger.info("Executing error step.");
        throw new Error("Kaboom");
      };

    const p = pipeline<typeof ctx, { data: string }>(ctx)
      .addStep((c) => appendStep(" Pow")((c as any).logger))
      .addStep(errorStep)
      .addStep((c) => uppercaseStep((c as any).logger));

    const seen: string[] = [];
    for await (const evt of p.stream({ data: "Boom" })) {
      if (evt.type === "progress") seen.push(evt.doc.data);
    }
    // After the error step, stream yields unchanged doc, then uppercase
    expect(seen).toEqual(["Boom Pow", "Boom Pow", "BOOM POW"]);
    expect(logger.logs.info).toContain("Executing error step.");
    // expect(logger.logs.error).toContain("Error in step #2: Error: Kaboom");
  });

  it("should support manual control via stream().next()", async () => {
    const p = pipeline<typeof ctx, { data: string }>(ctx)
      .addStep((c) => appendStep(" -> Step1")((c as any).logger))
      .addStep((c) => appendStep(" -> Step2")((c as any).logger));

    const it = p.stream({ data: "Start" });

    const r1 = await it.next();
    expect(r1.done).toBe(false);
    expect((r1.value as Extract<StreamEvent<{ data: string }>, { type: "progress" }>).doc.data).toBe(
      "Start -> Step1",
    );

    const r2 = await it.next();
    expect(r2.done).toBe(false);
    expect((r2.value as Extract<StreamEvent<{ data: string }>, { type: "progress" }>).doc.data).toBe(
      "Start -> Step1 -> Step2",
    );

    const r3 = await it.next();
    // The third next() yields the 'done' event, not completion.
    expect(r3.done).toBe(false);
    expect((r3.value as StreamEvent<{ data: string }>).type).toBe(
      "done"
    );
  });

  it("should yield pause event and stop stream()", async () => {
    const pauseStep: PipelineStep<{ data: string }, { data: string }> =
      () => async () => ({
        done: false,
        reason: "Midstream pause",
        payload: {},
      });

    const p = pipeline<typeof ctx, { data: string }>(ctx)
      .addStep((c) => appendStep(", John")((c as any).logger))
      .addStep(pauseStep)
      .addStep((c) => uppercaseStep((c as any).logger));

    const events = [];
    // capture only until the first pause
    for await (const evt of p.stream({ data: "Hi" })) {
      events.push(evt);
      if (evt.type === "pause") break;
    }

    // we expect exactly 2 events: progress then pause
    expect(events).toHaveLength(2);

    // first is the appendStep progress
    expect(events[0]).toMatchObject({
      type: "progress",
      step: 0,
      doc: { data: "Hi, John" },
    });

    // second is the pause
    const pauseEvt = events[1] as Extract<
      StreamEvent<{ data: string }>,
      { type: "pause" }
    >;
    expect(pauseEvt.type).toBe("pause");
    expect(pauseEvt.step).toBe(1);
    expect(pauseEvt.doc).toEqual({ data: "Hi, John" });
    expect(pauseEvt.info).toMatchObject({
      done: false,
      reason: "Midstream pause",
      payload: {},
    });
  });
});
