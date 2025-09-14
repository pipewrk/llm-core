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
import type { PipelineOutcome, PipelineStep, StreamEvent } from "./pipeline";

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
export function withErrorHandling<C, T>(
  step: PipelineStep<T, T>
): PipelineStep<T, T> {
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
export function withRetry<C extends { pipeline?: { retries?: number } }, T>(
  step: PipelineStep<T, T>
): PipelineStep<T, T> {
  return (ctx) => async (doc) => {
    const c = ctx as unknown as C;
    let attempt = 0;
    const maxRetries = c.pipeline?.retries ?? 0;

    while (attempt <= maxRetries) {
      // wrap step so throws become error‑pauses
      const result = await withErrorHandling<C, T>(step)(ctx)(doc);

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
export function withTimeout<C extends { pipeline?: { timeout?: number } }, T>(
  step: PipelineStep<T, T>
): PipelineStep<T, T> {
  return (ctx) => async (doc) => {
    const c = ctx as unknown as C;
    const ms = c.pipeline?.timeout ?? 0;
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
export function withCache<C extends { pipeline?: { cache?: Map<any, unknown> } }, T>(
  step: PipelineStep<T, T>,
  keyFn: (doc: T) => unknown
): PipelineStep<T, T> {
  return (ctx) => async (doc) => {
    const c = ctx as unknown as C;
    const cache = c.pipeline?.cache;
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
): PipelineStep<T, T> {
  return (ctx) => (doc) => {
    sideEffect(ctx as unknown as C, doc);
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
export function withMultiStrategy<C extends { pipeline?: { stopCondition?: (doc: T) => boolean } }, T>(
  subs: PipelineStep<T, T>[]
): PipelineStep<T, T> {
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

      const c = ctx as unknown as C;
      const stop = c.pipeline?.stopCondition;
      if (stop?.(current)) {
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
export interface PipelineEmitter<C, O> extends EventEmitter {
  on(event: 'pause', listener: (evt: Extract<StreamEvent<O>, { type: 'pause' }>) => void): this;
  on(event: 'progress', listener: (evt: Extract<StreamEvent<O>, { type: 'progress' }>) => void): this;
  on(event: 'done', listener: () => void): this;
  on(event: 'error', listener: (err: unknown) => void): this;

  emit(event: 'pause', evt: Extract<StreamEvent<O>, { type: 'pause' }>): boolean;
  emit(event: 'progress', evt: Extract<StreamEvent<O>, { type: 'progress' }>): boolean;
  emit(event: 'done'): boolean;
  emit(event: 'error', err: unknown): boolean;
}

export function eventsFromPipeline<C, TInit, O>(
  p: { stream(doc: TInit, resume?: any): AsyncGenerator<StreamEvent<O>, O, void> },
  initial: TInit,
): PipelineEmitter<C, O> {
  const emitter = new EventEmitter() as PipelineEmitter<C, O>;
  queueMicrotask(async () => {
    try {
      for await (const evt of p.stream(initial)) {
        switch (evt.type) {
          case 'pause': emitter.emit('pause', evt); break;
          case 'progress': emitter.emit('progress', evt); break;
          case 'done': emitter.emit('done'); break;
        }
      }
    } catch (err) {
      emitter.emit('error', err);
    }
  });
  return emitter;
}

/* --------------------------------------------------------------------------
 *  Node stream integration
 */
/**
 * Handler for “pause” events from the stream.
 */
export type PauseEvent<C, O> = Extract<StreamEvent<O>, { type: 'pause' }>;
export type PauseHandler<C, O> = (evt: PauseEvent<C, O>) => Promise<void>;

export function pipelineToTransform<C, TInit, O>(
  p: { next(doc: TInit, resume?: any): Promise<StreamEvent<O> | { done: true; value: O }> },
  onPause?: PauseHandler<C, O>,
): Transform {
  let current: O | TInit;

  return new Transform({
    objectMode: true,

    async transform(chunk: TInit, _enc, callback) {
      current = chunk;            // first iteration is the initial doc
      let resumeState: any | undefined;

      try {
        while (true) {
          const res = await p.next(current as TInit, resumeState);

          if ('done' in res) {
            this.push(JSON.stringify(res.value) + '\n');
            break;
          }

          switch (res.type) {
            case 'pause':
              if (onPause) await onPause(res);
              resumeState = res.resume;
              return callback(); // stop processing this chunk on pause

            case 'progress':
              current = res.doc; // now O (evolves each step)
              this.push(JSON.stringify(current) + '\n');
              resumeState = res.resume;
              break;

            case 'done':
              return callback();
          }
        }
        callback();
      } catch (err) {
        callback(err as Error);
      }
    },
  });
}
