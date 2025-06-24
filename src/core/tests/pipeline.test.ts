import { beforeEach, describe, expect, it } from "bun:test";
import type { ILogger } from "../../types/dataset"; // Adjust the import path if necessary
import { pipeline, type PipelineStep } from "../pipeline";
import { MockLogger } from "./logger.mock";
import { appendStep, uppercaseStep } from "./steps.mock";
import { setEnv } from "../env";

describe("Generic Pipeline Tests", () => {
  const logger = new MockLogger();
  beforeEach(() => {
    logger.clear();
    setEnv("LOG_PATH", "./")
  });

  it("should execute a single pipeline step correctly", async () => {
    const initialData = { data: "Hello" };

    const testPipeline = pipeline<{ data: string }>(logger).addStep(
      appendStep(" World"),
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
    expect(logger.logs.error).toContain("Error in step #2: Test Error");
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
      appendStep(" World"),
    );

    const result = await testPipeline.run(initialData);

    expect(initialData).toEqual(initialDataCopy); // Original input remains unchanged
    expect(result.data).toBe("Hello World");
    expect(logger.logs.info).toContain('Appending " World" to data.');
  });

  // Additional tests can be added here as needed
});
