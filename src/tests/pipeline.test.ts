import { beforeEach, describe, expect, it } from "bun:test";
import type { ILogger } from "../types/dataset"; // Adjust the import path if necessary
import {
  pipeline,
  isPipelineOutcome,
  type PipelineStep,
} from "../core/pipeline";
import { MockLogger } from "./logger.mock";
import { appendStep, uppercaseStep } from "./steps.mock";
import { setEnv } from "../core/env";

describe("Generic Pipeline Tests", () => {
  const logger = new MockLogger();
  beforeEach(() => {
    logger.clear();
    setEnv("LOG_PATH", "./");
  });

  it("should execute a single pipeline step correctly", async () => {
    const initialData = { data: "Hello" };

    const testPipeline = pipeline<{ data: string }>(logger).addStep(
      appendStep(" World")
    );

    const result = await testPipeline.run(initialData);

    expect(result.data).toBe("Hello World");
    expect(logger.logs.info).toContain('Appending " World" to data.');
    expect(logger.logs.error.length).toBe(0);
  });

  it("should execute multiple pipeline steps in order", async () => {
    const initialData = { data: "Hello" };

    const testPipeline = pipeline<{ data: string }>(logger)
      .addStep(appendStep(" World"))
      .addStep(uppercaseStep);

    const result = await testPipeline.run(initialData);

    expect(result.data).toBe("HELLO WORLD");
    expect(logger.logs.info).toContain('Appending " World" to data.');
    expect(logger.logs.info).toContain("Transforming data to uppercase.");
    expect(logger.logs.error.length).toBe(0);
  });

  it("should log errors within pipeline steps", async () => {
    // Define a step that throws an error
    const errorStep: PipelineStep<{ data: string }> =
      (logger: ILogger) => async (doc) => {
        logger.info("Executing error step.");
        throw new Error("Test Error");
      };

    const initialData = { data: "Hello" };

    const testPipeline = pipeline<{ data: string }>(logger)
      .addStep(appendStep(" World"))
      .addStep(errorStep)
      .addStep(uppercaseStep); // This step should not execute

    const run = await testPipeline.run(initialData);

    //  expect(run).rejects.toThrow("Test Error");

    expect(logger.logs.info).toContain('Appending " World" to data.');
    expect(logger.logs.info).toContain("Executing error step.");
    expect(logger.logs.error).toContain("Error in step #2: Error: Test Error");
  });

  it("should work with different generic types", async () => {
    // Define a simple pipeline for numbers
    const numberPipeline = pipeline<number>(logger)
      .addStep((logger: ILogger) => async (num: number) => {
        logger.info(`Multiplying ${num} by 2.`);
        return num * 2;
      })
      .addStep((logger: ILogger) => async (num: number) => {
        logger.info(`Adding 10 to ${num}.`);
        return num + 10;
      });

    const initialNumber = 5;
    const result = await numberPipeline.run(initialNumber);

    expect(result).toBe(20); // (5 * 2) + 10 = 20
    expect(logger.logs.info).toContain("Multiplying 5 by 2.");
    expect(logger.logs.info).toContain("Adding 10 to 10.");
    expect(logger.logs.error.length).toBe(0);
  });

  it("should maintain immutability by not altering the original input", async () => {
    const initialData = { data: "Hello" };
    const initialDataCopy = { ...initialData };

    const testPipeline = pipeline<{ data: string }>(logger).addStep(
      appendStep(" World")
    );

    const result = await testPipeline.run(initialData);

    expect(initialData).toEqual(initialDataCopy); // Original input remains unchanged
    expect(result.data).toBe("Hello World");
    expect(logger.logs.info).toContain('Appending " World" to data.');
  });
});
describe("addMultiStrategyStep", () => {
  const logger = new MockLogger();
  beforeEach(() => {
    logger.clear();
    setEnv("LOG_PATH", "./");
  });

  it("should run all sub-steps when no stopCondition is provided", async () => {
    const initialData = { data: "Hi" };

    const testPipeline = pipeline<{ data: string }>(
      logger
    ).addMultiStrategyStep([appendStep(", John"), uppercaseStep]);

    const result = await testPipeline.run(initialData);

    expect(result.data).toBe("HI, JOHN");
    expect(logger.logs.info).toContain(
      "--- Running multi-strategy sub-step #1 ---"
    );
    expect(logger.logs.info).toContain(
      "--- Running multi-strategy sub-step #2 ---"
    );
    expect(logger.logs.impt.length).toBe(0); // no short-circuit
  });

  it("should short-circuit when stopCondition returns true", async () => {
    const initialData = { data: "Hello" };

    const stopAfterUppercase = (doc: { data: string }) =>
      doc.data.includes("WORLD");

    const testPipeline = pipeline<{ data: string }>(
      logger
    ).addMultiStrategyStep(
      [
        appendStep(" World"),
        uppercaseStep,
        appendStep(" Again"), // should be skipped
      ],
      stopAfterUppercase
    );

    const result = await testPipeline.run(initialData);

    expect(result.data).toBe("HELLO WORLD");
    expect(logger.logs.info).toContain(
      "--- Running multi-strategy sub-step #1 ---"
    );
    expect(logger.logs.info).toContain(
      "--- Running multi-strategy sub-step #2 ---"
    );
    expect(logger.logs.info).not.toContain(
      "--- Running multi-strategy sub-step #3 ---"
    );
    expect(logger.logs.impt).toContain(
      "Short-circuited in multi-strategy after sub-step #2"
    );
  });

  it("should support chaining after addMultiStrategyStep", async () => {
    const initialData = { data: "Hi" };

    const testPipeline = pipeline<{ data: string }>(logger)
      .addMultiStrategyStep([appendStep(" there")])
      .addStep(uppercaseStep);

    const result = await testPipeline.run(initialData);

    expect(result.data).toBe("HI THERE");
  });
});

describe("Pipeline Stream Tests", () => {
  const logger = new MockLogger();
  beforeEach(() => {
    logger.clear();
    setEnv("LOG_PATH", "./");
  });

  const doneStep: PipelineStep<{ data: string }> = () => async (doc) => ({
    done: true,
    reason: "Completed early",
    value: { data: `${doc.data} (done)` },
  });
it("should complete pipeline with a done: true outcome", async () => {
  const initialData = { data: "Start" };

  const finalOutcomeStep = (logger: ILogger) => async (doc: { data: string }) => {
    logger.info("Returning final done:true outcome");
    return {
      done: true,
      value: { data: doc.data + " +Finalised" },
      reason: "Completion",
    };
  };

  const testPipeline = pipeline<{ data: string }>(logger).addStep(finalOutcomeStep);

  const result = await testPipeline.run(initialData);

  expect(result.data).toBe("Start +Finalised");
  expect(logger.logs.info).toContain("Returning final done:true outcome");
});

  it("should update final when step returns PipelineOutcome with done: true", async () => {
    const initialData = { data: "Finished" };

    const testPipeline = pipeline<{ data: string }>(logger).addStep(doneStep);

    const result = await testPipeline.run(initialData);

    expect(result.data).toBe("Finished (done)");
  });

  it("should handle PipelineOutcome with done: true in run()", async () => {
    const initialData = { data: "Run" };

    const testPipeline = pipeline<{ data: string }>(logger)
      .addStep(doneStep)
      .addStep(uppercaseStep); // should still run, because done: true doesn't pause

    const result = await testPipeline.run(initialData);

    expect(result.data).toBe("RUN (DONE)");
  });

  it("should handle PipelineOutcome with done: true in multi-strategy", async () => {
    const initialData = { data: "Multi" };

    const testPipeline = pipeline<{ data: string }>(
      logger
    ).addMultiStrategyStep([doneStep, uppercaseStep]);

    const result = await testPipeline.run(initialData);

    expect(result.data).toBe("MULTI (DONE)");
  });

  it("should yield result.value when PipelineOutcome has done: true in stream", async () => {
    const initialData = { data: "Stream" };
    const values: { data: string }[] = [];

    const testPipeline = pipeline<{ data: string }>(logger).addStep(doneStep);

    for await (const out of testPipeline.stream(initialData)) {
      if ("done" in out) continue; // skip PipelineOutcome directly
      values.push(out);
    }

    expect(values[0].data).toBe("Stream (done)");
  });

  it("should stream each intermediate step via stream()", async () => {
    const initialData = { data: "Hello" };
    const testPipeline = pipeline<{ data: string }>(logger)
      .addStep(appendStep(" World"))
      .addStep(uppercaseStep);

    const stream = testPipeline.stream(initialData);
    const results: { data: string }[] = [];

    for await (const output of stream) {
      if ("done" in output && !output.done) break; // skip HITL
      results.push(output as { data: string });
    }

    expect(results).toHaveLength(2);
    expect(results[0].data).toBe("Hello World");
    expect(results[1].data).toBe("HELLO WORLD");
  });

  it("should yield HITL pause when step returns PipelineOutcome", async () => {
    const hitlStep: PipelineStep<{ data: string }> =
      (logger) => async (doc) => {
        logger.info("Pausing for HITL...");
        return {
          done: false,
          reason: "human-input",
          payload: { hint: "continue?" },
        };
      };

    const initialData = { data: "Hi" };
    const testPipeline = pipeline<{ data: string }>(logger)
      .addStep(appendStep(", John"))
      .addStep(hitlStep) // should pause here
      .addStep(uppercaseStep); // should not run

    const stream = testPipeline.stream(initialData);

    const steps: any[] = [];
    for await (const output of stream) {
      steps.push(output);
    }

    expect(steps).toHaveLength(2); // appendStep + HITL
    expect((steps[0] as { data: string }).data).toBe("Hi, John");
    expect("done" in steps[1] && !steps[1].done).toBe(true);
    expect(steps[1].reason).toBe("human-input");
    expect(logger.logs.info).toContain("Pausing for HITL...");
  });

  it("should continue streaming after error and yield current state", async () => {
    const errorStep: PipelineStep<{ data: string }> =
      (logger) => async (_doc) => {
        logger.info("Executing error step.");
        throw new Error("Kaboom");
      };

    const initialData = { data: "Boom" };
    const testPipeline = pipeline<{ data: string }>(logger)
      .addStep(appendStep(" Pow"))
      .addStep(errorStep)
      .addStep(uppercaseStep);

    const results: { data: string }[] = [];
    for await (const output of testPipeline.stream(initialData)) {
      if ("done" in output && !output.done) break;
      results.push(output as { data: string });
    }

    expect(results).toHaveLength(3);
    expect(results[0].data).toBe("Boom Pow"); // After append
    expect(results[1].data).toBe("Boom Pow"); // After error step, unchanged
    expect(results[2].data).toBe("BOOM POW"); // After uppercase step

    expect(logger.logs.info).toContain("Executing error step.");
    expect(logger.logs.error).toContain("Error in step #2: Error: Kaboom");
  });

  it("should support stream().next() for manual control", async () => {
    const initialData = { data: "Start" };
    const testPipeline = pipeline<{ data: string }>(logger)
      .addStep(appendStep(" -> Step1"))
      .addStep(appendStep(" -> Step2"));

    const stream = testPipeline.stream(initialData);

    const res1 = await stream.next();
    if (isPipelineOutcome(res1.value)) throw new Error("Unexpected outcome");
    expect(res1.value.data).toBe("Start -> Step1");

    const res2 = await stream.next();
    if (isPipelineOutcome(res2.value)) throw new Error("Unexpected outcome");
    expect(res2.value.data).toBe("Start -> Step1 -> Step2");

    const res3 = await stream.next();
    expect(res3.done).toBe(true);
  });
  it("should pause and return outcome from addMultiStrategyStep", async () => {
    const initialData = { data: "Hello" };

    const pauseStep: PipelineStep<{ data: string }> = () => async (_doc) => {
      return {
        done: false,
        reason: "Human review needed",
        payload: {},
      };
    };

    const pipelineWithPause = pipeline<{ data: string }>(
      logger
    ).addMultiStrategyStep([
      appendStep(" World"),
      pauseStep,
      uppercaseStep, // should be skipped
    ]);

    const result = await pipelineWithPause.stream(initialData).next();

    expect(result.value).toEqual({
      done: false,
      reason: "Human review needed",
      payload: {},
    });
  });

  it("should yield pause outcome and halt stream", async () => {
    const initialData = { data: "Hi" };

    const pauseStep: PipelineStep<{ data: string }> = () => async (_doc) => ({
      done: false,
      reason: "Midstream pause",
      payload: {},
    });

    const testPipeline = pipeline<{ data: string }>(logger)
      .addStep(appendStep(", John"))
      .addStep(pauseStep)
      .addStep(uppercaseStep); // should not be reached

    const stream = testPipeline.stream(initialData);

    const results: any[] = [];

    for await (const output of stream) {
      results.push(output);
    }

    expect(results).toHaveLength(2); // appendStep result + pause outcome
    expect(results[0].data).toBe("Hi, John");

    expect(results[1]).toEqual({
      done: false,
      reason: "Midstream pause",
      payload: {},
    });
  });
});
