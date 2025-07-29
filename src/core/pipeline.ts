/**
 * Generic, composable pipeline implementation.
 *
 * A pipeline is a sequence of curried functions (“steps”) that take a
 * user‑defined context `C` and a document `T`.  Each step returns either a
 * new document or a `PipelineOutcome` to signal that execution should pause.
 *
 * The pipeline exposes three ways to execute:
 *  - `run(doc)` executes all steps in order and resolves with the final doc.
 *    If a step returns a pause, `run` resolves early with the current doc.
 *  - `stream(doc)` returns an async generator that yields after every step.
 *    The yielded object contains the step index, the step’s result and a
 *    resumable state.  When a step pauses, the generator yields a
 *    `PipelineOutcome` and continues when you call `next()`.
 *  - `next(doc, state)` advances the pipeline one yield at a time.  You can
 *    use this for fine‑grained control without managing the generator yourself.
 *
 * Steps, context and document types are fully generic.  Define your own
 * context interface to carry shared state (logger, counters, caches, etc.).
 * Define a document type that contains all fields your pipeline might add;
 * optional fields are recommended for properties added by later steps.
 */

export type PipelineOutcome<T> =
  | { done: true; value: T }
  | { done: false; reason: string; payload: any };

/**
 * A step in the pipeline.  Given a context `C`, returns a function that
 * transforms a document `T`.  The function may return the transformed doc
 * synchronously or asynchronously, or it may return a `PipelineOutcome<T>` to
 * pause execution.  If the outcome has `done: true`, the pipeline will
 * continue with the returned value; if `done: false`, the pipeline will
 * pause and yield control to the caller.
 */
export type PipelineStep<C, T> = (
  ctx: C,
) => (doc: T) => T | PipelineOutcome<T> | Promise<T | PipelineOutcome<T>>;

/**
 * Internal state used by the streaming API.  Contains the document at the
 * point of pause and the index of the next step to run when resuming.
 */
export interface StreamState<T> {
  currentDoc: T;
  nextStep: number;
}

/**
 * Object yielded by the streaming API.  Includes the result of the step
 * (either a document or a `PipelineOutcome<T>`), the index of the step
 * executed, and a `StreamState` used to resume the pipeline.
 */
export interface StreamYield<T> {
  value: T | PipelineOutcome<T>;
  stepIndex: number;
  state: StreamState<T>;
}

/**
 * Interface returned by the `pipeline()` factory.  Provides methods to add
 * steps, run the pipeline to completion, stream it, or advance one yield at
 * a time.
 */
export interface Pipeline<C, T> {
  /**
   * Add a single step to the pipeline.  Returns the pipeline to allow
   * chaining.
   */
  addStep(step: PipelineStep<C, T>): Pipeline<C, T>;
  /**
   * Execute all steps on the provided document.  Resolves with the final
   * document when complete.  If a step returns a pause outcome, `run` will
   * resolve early with the document as it stands.
   */
  run(doc: T): Promise<T>;
  /**
   * Stream the pipeline step‑by‑step.  Returns an async generator that
   * yields after each step.  The yield value contains the step index, the
   * step’s result and a state object used to resume.  If a step pauses,
   * the generator yields a `PipelineOutcome<T>` and continues when the
   * caller resumes via `next()`.
   */
  stream(doc: T, start?: StreamState<T>): AsyncGenerator<StreamYield<T>, T, void>;
  /**
   * Advance the pipeline one yield at a time.  Pass the current document
   * and (optionally) a state object returned by a previous yield.  Returns
   * either another `StreamYield<T>` or `{ done: true; value: T }` when
   * complete.
   */
  next(
    doc: T,
    state?: StreamState<T>,
  ): Promise<StreamYield<T> | { done: true; value: T }>;
}

/**
 * Create a new pipeline instance.
 *
 * @param ctx A context object shared by all steps.  You define the shape
 * of this object; typical fields include loggers, counters, caches,
 * EventEmitters, etc.  Each step receives the same context instance.
 */
export function pipeline<C, T>(ctx: C): Pipeline<C, T> {
  const steps: PipelineStep<C, T>[] = [];

  /**
   * Compose multiple sub‑steps into a single step.  Runs each sub‑step in
   * order until either a pause outcome is returned or the stop condition
   * evaluates to true.  If no sub‑steps pause and the stop condition never
   * triggers, returns the result of the last sub‑step.
   */
  function wrapMulti(
    subs: PipelineStep<C, T>[],
    stop?: (doc: T) => boolean,
  ): PipelineStep<C, T> {
    return (c: C) => async (doc: T) => {
      let d = doc;
      for (const sub of subs) {
        const result = await sub(c)(d);
        if (isPipelineOutcome<T>(result)) {
          if (!result.done) return result;
          d = result.value;
        } else {
          d = result;
        }
        if (stop && stop(d)) break;
      }
      return d;
    };
  }

  return {
    addStep(step) {
      steps.push(step);
      return this;
    },
    async run(doc) {
      let final = doc;
      for await (const { value } of this.stream(doc)) {
        final = value as T;
      }
      return final;
    },
    async *stream(doc, start) {
      let currentDoc = start?.currentDoc ?? doc;
      let index = start?.nextStep ?? 0;
      for (; index < steps.length; index++) {
        const stepFn = steps[index](ctx);
        try {
          const result = await stepFn(currentDoc);
          if (isPipelineOutcome<T>(result)) {
            if (!result.done) {
              const state: StreamState<T> = { currentDoc, nextStep: index };
              yield { value: result, stepIndex: index, state };
              continue;
            }
            currentDoc = result.value;
          } else {
            currentDoc = result;
          }
          const state: StreamState<T> = { currentDoc, nextStep: index + 1 };
          yield { value: currentDoc, stepIndex: index, state };
        } catch (err) {
          // If the context has a logger, log the error.  Otherwise ignore.
          (ctx as any)?.logger?.error?.(`Error in step #${index + 1}: ${err}`);
          const state: StreamState<T> = { currentDoc, nextStep: index + 1 };
          yield { value: currentDoc, stepIndex: index, state };
        }
      }
      return currentDoc;
    },
    async next(doc, state) {
      const gen = this.stream(doc, state);
      const res = await gen.next();
      if (res.done) {
        return { done: true as const, value: res.value };
      }
      return res.value;
    },
  };
}

/**
 * Type guard for `PipelineOutcome`.  Returns true if the value is an
 * object with a boolean `done` property.  Used internally to detect
 * pause signals in steps.
 */
export function isPipelineOutcome<T>(result: unknown): result is PipelineOutcome<T> {
  return (
    typeof result === 'object' &&
    result !== null &&
    'done' in (result as any) &&
    typeof (result as any).done === 'boolean'
  );
}