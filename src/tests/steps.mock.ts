// File: ./tests/steps.mock.ts

import type { PipelineStep } from "../core/pipeline";

/**
 * A sample PipelineStep that appends a string to a document's data.
 */
export const appendStep = (
  appendString: string,
): PipelineStep<{ data: string }, { data: string }> => {
  return (logger) => async (doc) => {
    (logger as any).info(`Appending "${appendString}" to data.`);
    return { ...doc, data: doc.data + appendString };
  };
};

/**
 * A sample PipelineStep that transforms data to uppercase.
 */
export const uppercaseStep: PipelineStep<{ data: string }, { data: string }> =
  (logger) => async (doc) => {
    (logger as any).info("Transforming data to uppercase.");
    return { ...doc, data: doc.data.toUpperCase() };
  };
