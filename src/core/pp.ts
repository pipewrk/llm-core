import cliProgress from "cli-progress";
import process from "node:process";
import type { ILogger } from "../types/dataset.ts";

export type PipelineStep<T> = (logger: ILogger) => (doc: T) => Promise<T>;

export function pipeline<T>(
  logger: ILogger,
  logPath: string,
  pollInterval: number = 5,
) {
  const steps: PipelineStep<T>[] = [];
  const multiBar = new cliProgress.MultiBar(
    {
      clearOnComplete: false,
      hideCursor: true,
      format: "{bar} | {percentage}% | ETA: {eta_formatted} | {message}",
    },
    cliProgress.Presets.shades_grey,
  );

  const taskBar = multiBar.create(100, 0, { message: "Current Task" });
  const overallBar = multiBar.create(steps.length || 1, 0, {
    message: "Overall Progress",
  });

  let currentTask = "";
  let pollTimeRemaining = pollInterval;

  const updatePollTimer = (_interval: Timer) => {
    process.stdout.cursorTo(0);
    process.stdout.clearLine(0);
    console.log(`Polling in: ${pollTimeRemaining}s`);
    pollTimeRemaining -= 1;

    if (pollTimeRemaining < 0) {
      pollTimeRemaining = pollInterval;
    }
  };

  return {
    addStep(step: PipelineStep<T>) {
      steps.push(step);
      overallBar.setTotal(steps.length);
      return this;
    },

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
            currentTask = `Sub-step ${idx + 1}`;
            taskBar.update(0, { message: currentTask });

            const transformFn = subStep(stepLogger);
            currentDoc = await transformFn(currentDoc);

            taskBar.update(100);

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
      overallBar.setTotal(steps.length);
      return this;
    },

    async run(doc: T): Promise<T> {
      console.log(`Logs can be found at: ${logPath}`);
      const pollIntervalId = setInterval(
        () => updatePollTimer(pollIntervalId),
        1000,
      );

      const result = await steps.reduce<Promise<T>>(
        async (accPromise, step, index) => {
          const accumulatedDoc = await accPromise;

          logger.info("=".repeat(50));
          logger.info(`Running step #${index + 1}`);
          currentTask = `Step ${index + 1}`;
          taskBar.update(0, { message: currentTask });

          const transformFn = step(logger);

          try {
            const transformedDoc = await transformFn(accumulatedDoc);
            taskBar.update(100);
            overallBar.increment(1, { message: `Completed step ${index + 1}` });
            return transformedDoc;
          } catch (error) {
            const errorMessage = error instanceof Error
              ? error.message
              : JSON.stringify(error);
            logger.error(`Error in step #${index + 1}: ${errorMessage}`);
            return accumulatedDoc;
          }
        },
        Promise.resolve(doc),
      );

      clearInterval(pollIntervalId);
      taskBar.stop();
      overallBar.stop();
      multiBar.stop();

      return result;
    },
  };
}
