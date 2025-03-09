import type { ILogger } from "../types/dataset.ts";

/**
 * A pipeline step is a function returning another function:
 *   (logger: Logger) => (doc: Document) => Promise<Document>
 *
 * The pipeline provides the logger, so your step logic only needs to handle the doc.
 */
export type PipelineStep<T> = (logger: ILogger) => (doc: T) => Promise<T>;

/**
 * Creates a pipeline for processing documents with a series of steps.
 *
 * The pipeline allows adding individual steps or a set of sub-steps
 * with an optional stop condition. Each step is a function that takes
 * a logger and returns an asynchronous function to transform the document.
 *
 * @template T - The type of the document being processed.
 *
 * @param {ILogger} logger - The logger instance used for logging information during the pipeline execution.
 *
 * @returns {object} An object with methods to add steps and run the pipeline:
 * - `addStep(step: PipelineStep<T>)`: Adds a single step to the pipeline.
 * - `addMultiStrategyStep(subSteps: PipelineStep<T>[], stopCondition?: (doc: T) => boolean)`: Adds multiple sub-steps with a stop condition.
 * - `run(doc: T): Promise<T>`: Executes all the steps in the pipeline sequentially on the provided document.
 */

export function pipeline<T>(logger: ILogger) {
  const steps: PipelineStep<T>[] = [];

  return {
    /**
     * Adds a single step to the pipeline.
     *
     * @param {PipelineStep<T>} step - The step to add.
     *
     * @returns {object} The pipeline object itself, allowing for chaining.
     */
    addStep(step: PipelineStep<T>) {
      steps.push(step);
      return this; // chainable
    },

    /**
     * Add a pipeline step with multiple, sequential strategies.
     *
     * Sub-steps will be executed until either all sub-steps have been executed or
     * the stop condition function returns `true`.
     *
     * `stopCondition(doc: T) => boolean` is an optional function that takes
     * the current document and returns `true` if we should stop executing
     * sub-steps. If `undefined` or not provided, all sub-steps will be executed.
     *
     * Chaining supported.
     */
    addMultiStrategyStep(
      subSteps: PipelineStep<T>[],
      stopCondition?: (doc: T) => boolean,
    ) {
      const multiStrategyStep: PipelineStep<T> = (stepLogger: ILogger) => {
        return async (doc: T): Promise<T> => {
          let currentDoc = doc;

          for (const [idx, subStep] of subSteps.entries()) {
            stepLogger.info(
              `--- Running multi-strategy sub-step #${idx + 1} ---`,
            );

            const transformFn = subStep(stepLogger);
            currentDoc = await transformFn(currentDoc);

            // If we have a stop condition and it's fulfilled, break early
            if (stopCondition && stopCondition(currentDoc)) {
              stepLogger.impt(
                `Short-circuited in multi-strategy after sub-step #${idx + 1}`,
              );
              break;
            }
          }

          return currentDoc;
        };
      };

      steps.push(multiStrategyStep);
      return this; // chainable
    },

    /**
     * Executes the pipeline steps sequentially on the provided document.
     *
     * Each step is executed in order, with the document being transformed
     * by each step's asynchronous function. If a step throws an error, the
     * error is logged, and the pipeline continues with the document as it
     * was before the step execution.
     *
     * @param {T} doc - The initial document to be processed by the pipeline.
     * @returns {Promise<T>} A promise that resolves to the final transformed
     * document after all steps have been executed.
     */

    run(doc: T): Promise<T> {
      return steps.reduce<Promise<T>>(async (accPromise, step, index) => {
        const accumulatedDoc = await accPromise;

        logger.info("=".repeat(50));
        logger.info(`Running step #${index + 1}`);
        logger.info("=".repeat(50));

        const transformFn = step(logger);

        try {
          const transformedDoc = await transformFn(accumulatedDoc);
          return transformedDoc;
        } catch (error) {
          const errorMessage = error instanceof Error
            ? error.message
            : JSON.stringify(error);
          logger.error(`Error in step #${index + 1}: ${errorMessage}`);
          return accumulatedDoc;
        }
      }, Promise.resolve(doc));
    },
  };
}
