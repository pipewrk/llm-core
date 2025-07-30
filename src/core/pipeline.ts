interface StreamState<T> {
  currentDoc: T;
  nextStep: number;
}

/**
 * Merge your application context `C` with the pipeline’s configuration
 * and runtime state under a single flat object.
 */
export type PipelineContext<C = {}, T = any> = C & {
  /** Pipeline helper/options */
  pipeline: {
    retries?: number;
    timeout?: number;
    cache?: Map<any, unknown>;
    stopCondition?: (doc: T) => boolean;
  };
  /** Internal streaming state */
  state: {
    history: Array<{ step: number; doc: T }>;
    resume?: StreamState<T>;
  };
};

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
  ctx: C
) => (doc: T) => T | PipelineOutcome<T> | Promise<T | PipelineOutcome<T>>;

/**
 * Internal state used by the streaming API.  Contains the document at the
 * point of pause and the index of the next step to run when resuming.
 */
export type StreamEvent<C, T> =
  | { type: "pause"; step: number; doc: T; info: PipelineOutcome<T> }
  | { type: "progress"; step: number; doc: T }
  | { type: "done" };

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
  addStep(step: PipelineStep<C, T>): this;
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
  stream(doc: T): AsyncGenerator<StreamEvent<C, T>, T, void>;
  /**
   * Advance the pipeline one yield at a time.  Pass the current document
   * and (optionally) a state object returned by a previous yield.  Returns
   * either another `StreamYield<T>` or `{ done: true; value: T }` when
   * complete.
   */
  next(doc: T): Promise<StreamEvent<C, T> | { done: true; value: T }>;
}

/**
 * Create a new pipeline instance.
 *
 * @param ctx A context object shared by all steps.  You define the shape
 * of this object; typical fields include loggers, counters, caches,
 * EventEmitters, etc.  Each step receives the same context instance.
 */
export function pipeline<U, T>(
  ctx: PipelineContext<U, T>
): Pipeline<PipelineContext<U, T>, T> {
  const steps: PipelineStep<PipelineContext<U, T>, T>[] = [];

  return {
    addStep(step) {
      steps.push(step);
      return this;
    },
    async run(doc: T): Promise<T> {
      let result = doc;
      for await (const evt of this.stream(result)) {
        switch (evt.type) {
          case "pause":
            // we hit a pause; resolve early
            return result;
          case "progress":
            result = evt.doc;
            break;
          case "done":
            // fully done
            return result;
        }
      }
      return result;
    },
    async *stream(
      doc: T
    ): AsyncGenerator<StreamEvent<PipelineContext<U, T>, T>, T, void> {
      // ctx is now statically known to have .state
      let current = ctx.state.resume?.currentDoc ?? doc;
      let index = ctx.state.resume?.nextStep ?? 0;

      for (; index < steps.length; index++) {
        const stepFn = steps[index](ctx);
        let res: T | PipelineOutcome<T>;

        try {
          res = await stepFn(current);
        } catch (err) {
          (ctx as any).logger?.error?.(err);
          res = current;
        }

        if (isPipelineOutcome<T>(res)) {
          if (!res.done) {
            // pause branch: yield and continue before touching `value`
            ctx.state.resume = { currentDoc: current, nextStep: index };
            yield { type: "pause", step: index, doc: current, info: res };
            continue;
          }
          // here TS knows res.done === true, so .value exists
          current = res.value;
        } else {
          // normal document
          current = res;
        }

        // record resume point for next iteration
        ctx.state.resume = { currentDoc: current, nextStep: index + 1 };
        yield { type: "progress", step: index, doc: current };
      }

      // clear out resume and finish
      delete ctx.state.resume;
      yield { type: "done" };
      return current;
    },

    async next(
      doc: T
    ): Promise<
      StreamEvent<PipelineContext<U, T>, T> | { done: true; value: T }
    > {
      const it = this.stream(doc);
      const res = await it.next();
      if (res.done) {
        return { done: true, value: res.value as T };
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
export function isPipelineOutcome<T>(
  result: unknown
): result is PipelineOutcome<T> {
  return (
    typeof result === "object" &&
    result !== null &&
    "done" in (result as any) &&
    typeof (result as any).done === "boolean"
  );
}
