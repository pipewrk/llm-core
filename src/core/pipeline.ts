import type { ILogger } from "../types/dataset.ts";

export type PipelineOutcome<T> =
  | { done: true; value: T }
  | { done: false; reason: string; payload: any };

export type PipelineStep<T> = (
  logger: ILogger
) => (doc: T) => Promise<T | PipelineOutcome<T>>;

export interface Pipeline<T> {
  addStep: (step: PipelineStep<T>) => Pipeline<T>;
  addMultiStrategyStep: (
    subSteps: PipelineStep<T>[],
    stopCondition?: (doc: T) => boolean
  ) => Pipeline<T>;
  run: (doc: T) => Promise<T>; // 🔁 restored for ergonomic default
  stream: (doc: T) => AsyncGenerator<T | PipelineOutcome<T>, T, void>; // new
}

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
export function pipeline<T>(logger: ILogger): Pipeline<T> {
  const steps: PipelineStep<T>[] = [];

  return {
    /**
     * Adds a single step to the pipeline.
     *
     * @param {PipelineStep<T>} step - The step to add.
     *
     * @returns {Pipeline<T>} The pipeline object itself, allowing for chaining.
     */
    addStep(step: PipelineStep<T>): Pipeline<T> {
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
    addMultiStrategyStep(subSteps, stopCondition) {
      const multiStrategyStep: PipelineStep<T> = (stepLogger: ILogger) => {
        return async (doc: T): Promise<T | PipelineOutcome<T>> => {
          let currentDoc = doc;

          for (const [idx, subStep] of subSteps.entries()) {
            stepLogger.info(
              `--- Running multi-strategy sub-step #${idx + 1} ---`
            );

            const transformFn = subStep(stepLogger);
            const result = await transformFn(currentDoc);

            if (isPipelineOutcome<T>(result)) {
              if (!result.done) return result;
              currentDoc = result.value;
            } else {
              currentDoc = result;
            }

            if (stopCondition && stopCondition(currentDoc)) {
              stepLogger.impt(
                `Short-circuited in multi-strategy after sub-step #${idx + 1}`
              );
              break;
            }
          }

          return currentDoc;
        };
      };

      steps.push(multiStrategyStep);
      return this;
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
    async run(doc: T): Promise<T> {
      let final: T = doc;
      for await (const stepResult of this.stream(doc)) {
        // at this point stepResult is always T, never PipelineOutcome
        final = stepResult as T;
      }
      return final;
    },
    stream(doc: T): AsyncGenerator<T | PipelineOutcome<T>, T, void> {
      const self = this;

      async function* generator(): AsyncGenerator<
        T | PipelineOutcome<T>,
        T,
        void
      > {
        let currentDoc = doc;

        for (const [index, step] of steps.entries()) {
          logger.info("=".repeat(50));
          logger.info(`Running step #${index + 1}`);
          logger.info("=".repeat(50));

          try {
            const result = await step(logger)(currentDoc);

            if (isPipelineOutcome(result)) {
              if (!result.done) {
                yield result; // pause + signal
                return currentDoc; // halt stream
              }

              currentDoc = result.value;
            } else {
              currentDoc = result;
            }

            yield currentDoc;
          } catch (err) {
            const errorMsg =
              err instanceof Error ? err.toString() : JSON.stringify(err);
            logger.error(`Error in step #${index + 1}: ${errorMsg}`);
            yield currentDoc;
          }
        }

        return currentDoc;
      }

      return generator();
    },
  };
}

export function isPipelineOutcome<T>(
  result: unknown
): result is PipelineOutcome<T> {
  return (
    typeof result === "object" &&
    result !== null &&
    "done" in result &&
    typeof (result as any).done === "boolean"
  );
}
