/**
 * Helper functions for the context‑based pipeline.
 *
 * These helpers provide reusable wrappers and utilities that can be applied
 * to steps or composed transformers.  All helpers operate on the
 * same `(ctx, doc) → [ctx, doc | PipelineOutcome<T>]` shape, synchronously
 * or via Promise, so they compose smoothly.
 */

import { Transform } from "node:stream";
import { EventEmitter } from "node:events";
import { isPipelineOutcome } from "./pipeline";
import type {
  PipelineContext,
  PipelineOutcome,
  PipelineStep,
  StreamEvent,
} from "./pipeline";

/* --------------------------------------------------------------------------
 *  Type aliases for composed transformers
 */

/**
 * A composed transformer takes a context and a document and returns the
 * updated context alongside either the updated document or a pause outcome.
 *
 * The return type may be synchronous (a tuple) or a Promise of that
 * tuple.  Using `await` on the result will work for both cases.
 */
export type Transformer<C, T> = (
  ctx: C,
  doc: T
) => [C, T | PipelineOutcome<T>] | Promise<[C, T | PipelineOutcome<T>]>;

/**
 * Pipe multiple transformers into one.  Runs each transformer in sequence
 * until either all have completed or one returns a pause outcome.  The
 * individual transformers may return their results synchronously or
 * asynchronously; `pipe` handles both by awaiting the result.
 *
 * It also short‑circuits if a pause is encountered before running later
 * transformers, and returns immediately on first pause.
 */
export function pipe<C, T>(...fns: Transformer<C, T>[]): Transformer<C, T> {
  return async (ctx: C, doc: T) => {
    let c = ctx;
    let d: T | PipelineOutcome<T> = doc;

    for (const fn of fns) {
      if (isPipelineOutcome(d) && !d.done) {
        return [c, d];
      }
      const [nextCtx, nextDoc] = await fn(c, d as T);
      c = nextCtx;
      d = nextDoc;
      if (isPipelineOutcome(d) && !d.done) {
        return [c, d];
      }
    }

    return [c, d];
  };
}

/* --------------------------------------------------------------------------
 *  Fp style compose
 *  Applies f3 → f2 → f1 instead of f1 → f2 → f3.
 */
export function compose<C, T>(...fns: Transformer<C, T>[]): Transformer<C, T> {
  // reverse the array so the last supplied fn runs first
  return pipe<C, T>(...fns.slice().reverse());
}

/* --------------------------------------------------------------------------
 *  Step wrappers
 */

/**
 * Wrap a step with error handling.  Catches exceptions and converts them
 * into a pause outcome with reason `'error'`.  Does *not* mutate arbitrary
 * fields on the context, just returns the pause so the caller can react.
 */
export function withErrorHandling<U, T>(
  step: PipelineStep<PipelineContext<U, T>, T>
): PipelineStep<PipelineContext<U, T>, T> {
  return (ctx) => async (doc) => {
    try {
      return await step(ctx)(doc);
    } catch {
      // swallow the exception and signal a pause
      return {
        done: false,
        reason: "error",
        payload: doc,
      } as PipelineOutcome<T>;
    }
  };
}

/**
 * Retry a step when it pauses because of an error.
 * - Reads the retry limit from `ctx.pipeline.retries` (default 0).
 * - Only retries on pauses where `reason === 'error'`.
 * - Other pauses are propagated immediately.
 * - Once retries are exhausted, returns a pause with `reason: 'retryExceeded'`.
 */
export function withRetry<U, T>(
  step: PipelineStep<PipelineContext<U, T>, T>
): PipelineStep<PipelineContext<U, T>, T> {
  return (ctx) => async (doc) => {
    let attempt = 0;
    const maxRetries = ctx.pipeline.retries ?? 0;

    while (attempt <= maxRetries) {
      // wrap step so throws become error‑pauses
      const result = await withErrorHandling(step)(ctx)(doc);

      if (isPipelineOutcome(result)) {
        if (result.done) {
          // done=true means it's actually a normal T in a pause shape
          return result;
        }
        if (result.reason === "error") {
          // retryable pause
          attempt++;
          continue;
        }
        // non‑error pause -> propagate
        return result;
      }

      // successful doc
      return result;
    }

    // out of retries
    return {
      done: false,
      reason: "retryExceeded",
      payload: doc,
    } as PipelineOutcome<T>;
  };
}

/**
 * Add a timeout to a step.
 * - Reads the duration from `ctx.pipeline.timeout` (default 0 = immediate).
 * - Races the step against a timer; if the timer wins, returns
 *   `{ done: false, reason: 'timeout', payload: doc }`.
 * - Does *not* cancel the underlying step.
 */
export function withTimeout<U, T>(
  step: PipelineStep<PipelineContext<U, T>, T>
): PipelineStep<PipelineContext<U, T>, T> {
  return (ctx) => async (doc) => {
    const ms = ctx.pipeline.timeout ?? 0;
    return Promise.race<T | PipelineOutcome<T>>([
      step(ctx)(doc),
      new Promise<PipelineOutcome<T>>((resolve) =>
        setTimeout(
          () => resolve({ done: false, reason: "timeout", payload: doc }),
          ms
        )
      ),
    ]);
  };
}

/**
 * Memoise a step’s result based on a key derived from the document.
 * - Reads the cache Map from `ctx.pipeline.cache`.  If no cache is configured,
 *   the step just runs unmemoised.
 * - Only caches successful results (i.e. non‑pause outcomes).
 */
export function withCache<U, T>(
  step: PipelineStep<PipelineContext<U, T>, T>,
  keyFn: (doc: T) => unknown
): PipelineStep<PipelineContext<U, T>, T> {
  return (ctx) => async (doc) => {
    const cache = ctx.pipeline.cache;
    if (!cache) {
      // no cache configured → just delegate
      return step(ctx)(doc);
    }

    const key = keyFn(doc);
    if (cache.has(key)) {
      return cache.get(key) as T;
    }

    const result = await step(ctx)(doc);
    if (!isPipelineOutcome(result)) {
      cache.set(key, result);
    }
    return result;
  };
}

/**
 * Create a tap step that executes a side effect and returns the document
 * unchanged.  Useful for logging or metrics.
 */
export function tap<C, T>(
  sideEffect: (ctx: C, doc: T) => void
): PipelineStep<C, T> {
  return (ctx) => (doc) => {
    sideEffect(ctx, doc);
    return doc;
  };
}

/* --------------------------------------------------------------------------
 *  Multi‑strategy transformer
 */

/**
 * Compose multiple pipeline steps into one.
 *
 * - Runs each sub‑step in sequence with the same context.
 * - If a sub‑step returns a pause (`done === false`), that pause is
 *   returned immediately (no further subs are run).
 * - If a sub‑step returns a completion pause (`done === true`), we extract
 *   the `.value` safely.
 * - After any normal result, if `ctx.pipeline.stopCondition(doc)` returns
 *   `true`, we break early.
 */
export function withMultiStrategy<U, T>(
  subs: PipelineStep<PipelineContext<U, T>, T>[]
): PipelineStep<PipelineContext<U, T>, T> {
  return (ctx) => async (doc) => {
    let current = doc;

    for (const sub of subs) {
      const result = await sub(ctx)(current);

      if (isPipelineOutcome<T>(result)) {
        if (!result.done) {
          // Pause branch: propagate immediately
          return result;
        }
        // Here TS knows result.done === true, so .value exists
        current = result.value;
      } else {
        // Normal (non-pause) branch
        current = result;
      }

      const stop = ctx.pipeline.stopCondition;
      if (stop && stop(current)) {
        break;
      }
    }

    return current;
  };
}

/* --------------------------------------------------------------------------
 *  EventEmitter integration
 */


/**
 * Dispatcher interface: strongly typed `.on(...)`, `emit(...)` and returns `this`.
 */
export interface PipelineEmitter<C, T> extends EventEmitter {
  on(event: 'pause',    listener: (evt: Extract<StreamEvent<C, T>, { type: 'pause' }>)    => void): this;
  on(event: 'progress', listener: (evt: Extract<StreamEvent<C, T>, { type: 'progress' }>) => void): this;
  on(event: 'done',     listener: () => void): this;
  on(event: 'error',    listener: (err: unknown) => void): this;

  emit(event: 'pause',    evt: Extract<StreamEvent<C, T>, { type: 'pause' }>): boolean;
  emit(event: 'progress', evt: Extract<StreamEvent<C, T>, { type: 'progress' }>): boolean;
  emit(event: 'done'): boolean;
  emit(event: 'error',    err: unknown): boolean;
}

/**
 * Convert a pipeline into an EventEmitter.  Emits `progress` when a step
 * completes normally, `pause` when a step returns a pause outcome, `done`
 * when the pipeline finishes, and `error` if an exception is thrown.
 */
export function eventsFromPipeline<C, T>(
  p: { stream(doc: T): AsyncGenerator<StreamEvent<C, T>, T, void> },
  initial: T,
): PipelineEmitter<C, T> {
  const emitter = new EventEmitter() as PipelineEmitter<C, T>;

  (async () => {
    try {
      for await (const evt of p.stream(initial)) {
        switch (evt.type) {
          case 'pause':
            emitter.emit('pause', evt);
            break;
          case 'progress':
            emitter.emit('progress', evt);
            break;
          case 'done':
            emitter.emit('done');
            break;
        }
      }
    } catch (err) {
      emitter.emit('error', err);
    }
  })();

  return emitter;
}

/* --------------------------------------------------------------------------
 *  Node stream integration
 */
/**
 * Handler for “pause” events from the stream.
 */
export type PauseEvent<C, T> = Extract<StreamEvent<C, T>, { type: 'pause' }>;
export type PauseHandler<C, T> = (evt: PauseEvent<C, T>) => Promise<void>;

/**
 * Create a Transform stream from a pipeline.  Each chunk is processed
 * through the pipeline; pauses trigger the optional handler; normal results
 * are pushed downstream as JSON strings.  Context state is preserved
 * across chunks.
 */
export function pipelineToTransform<C, T>(
  p: {
    next(doc: T): Promise<StreamEvent<C, T> | { done: true; value: T }>;
  },
  onPause?: PauseHandler<C, T>,
): Transform {
  let current: T;

  return new Transform({
    objectMode: true,

    async transform(chunk: T, _enc, callback) {
      current = chunk;
      try {
        while (true) {
          const res = await p.next(current);

          // **Pipeline-complete** case: raw {done,value}
          if ('done' in res) {
            this.push(JSON.stringify(res.value) + '\n');
            break;
          }

          // **StreamEvent** case:
          switch (res.type) {
            case 'pause':
              // res is guaranteed to be PauseEvent<C,T>
              if (onPause) await onPause(res);
              break;

            case 'progress':
              current = res.doc;
              this.push(JSON.stringify(current) + '\n');
              break;

            case 'done':
              // A StreamEvent 'done' signals end-of-stream
              return callback(); // exit without error
          }
        }
        callback();
      } catch (err) {
        callback(err as Error);
      }
    },
  });
}