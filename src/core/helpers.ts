/**
 * Helper functions for the context‑based pipeline.
 *
 * These helpers provide reusable wrappers and utilities that can be applied
 * to steps or composed transformers.  All helpers operate on the same
 * `(ctx, doc) → [ctx, result]` shape, making them easy to compose.
 */

import { Transform } from "node:stream";
import { EventEmitter } from "node:events";
import { isPipelineOutcome } from "./pipeline";
import type {
  PipelineOutcome,
  PipelineStep,
  StreamState,
  StreamYield,
} from "./pipeline";

/* --------------------------------------------------------------------------
 *  Type aliases for composed transformers
 */

export type Transformer<C, T> = (
  ctx: C,
  doc: T
) => Promise<[C, T | PipelineOutcome<T>]>;

/** Compose multiple transformers into one.  Runs each transformer in sequence
 * until either all have completed or one returns a pause outcome.
 */
export function compose<C, T>(...fns: Transformer<C, T>[]): Transformer<C, T> {
  return async (ctx: C, doc: T) => {
    let c: C = ctx;
    let d: T | PipelineOutcome<T> = doc;
    for (const fn of fns) {
      if (isPipelineOutcome(d) && !d.done) {
        // propagate pause without further processing
        return [c, d];
      }
      const result = await fn(c, d as T);
      c = result[0];
      d = result[1];
      // if we paused, break early
      if (isPipelineOutcome(d) && !d.done) {
        return [c, d];
      }
    }
    return [c, d];
  };
}

/* --------------------------------------------------------------------------
 *  Step wrappers
 */

/**
 * Wrap a step with error handling.  Catches exceptions and converts them
 * into a pause outcome with reason `'error'`.  Adds the error to the
 * context under the optional `error` key.
 */
export function withErrorHandling<C extends { error?: unknown }, T>(
  step: PipelineStep<C, T>
): PipelineStep<C, T> {
  return (ctx) => async (doc) => {
    try {
      return await step(ctx)(doc);
    } catch (err) {
      ctx.error = err;
      return {
        done: false,
        reason: "error",
        payload: doc,
      } as PipelineOutcome<T>;
    }
  };
}

/**
 * Retry a step up to `retries` times when it pauses with reason `'error'`.
 * If the step pauses for another reason, the pause is propagated immediately.
 */
export function withRetry<C extends { error?: unknown }, T>(
  step: PipelineStep<C, T>,
  retries = 3
): PipelineStep<C, T> {
  return (ctx) => async (doc) => {
    let attempt = 0;
    let result: T | PipelineOutcome<T> | undefined;
    while (attempt <= retries) {
      const res = await withErrorHandling(step)(ctx)(doc);
      if (isPipelineOutcome(res)) {
        if (res.done) {
          return res;
        }
        // pause with error
        if (res.reason === "error") {
          attempt++;
          continue;
        }
        return res; // propagate other pauses
      } else {
        return res;
      }
    }
    // if we exhausted retries, return a pause
    return {
      done: false,
      reason: "retryExceeded",
      payload: doc,
    } as PipelineOutcome<T>;
  };
}

/**
 * Add a timeout to a step.  If the step does not complete within `ms`
 * milliseconds, returns a pause outcome with reason `'timeout'`.
 */
export function withTimeout<C, T>(
  step: PipelineStep<C, T>,
  ms: number
): PipelineStep<C, T> {
  return (ctx) => async (doc) => {
    return await Promise.race([
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

export interface CacheCtx {
  cache: Map<any, unknown>;
}

// A cache wrapper that uses the context's cache Map
export function withCache<C extends CacheCtx, T>(
  step: PipelineStep<C, T>,
  keyFn: (doc: T) => any,
): PipelineStep<C, T> {
  return (ctx) => async (doc) => {
    const key = keyFn(doc);
    if (ctx.cache.has(key)) {
      return ctx.cache.get(key) as T;
    }
    const result = await step(ctx)(doc);
    if (!isPipelineOutcome(result)) {
      ctx.cache.set(key, result);
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
 * Compose multiple sub‑steps into a single step.  Each sub‑step runs in
 * sequence with the same context.  If a sub‑step returns a pause
 * (`PipelineOutcome<T>` with `done: false`), the pause is propagated
 * immediately and no further sub‑steps are executed.  If `stopCondition`
 * returns true after a sub‑step completes normally, the remaining sub‑steps
 * are skipped.
 *
 * @param subs Array of steps to attempt in order.
 * @param stop Optional predicate to short‑circuit on a successful doc.
 */
export function withMultiStrategy<C, T>(
  subs: PipelineStep<C, T>[],
  stopCondition?: (doc: T) => boolean
): PipelineStep<C, T> {
  return (ctx) => async (doc) => {
    let current: T = doc;
    for (const sub of subs) {
      const result = await sub(ctx)(current);
      if (isPipelineOutcome<T>(result)) {
        // propagate pause or completion
        return result;
      }
      current = result;
      if (stopCondition && stopCondition(current)) {
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
 * Convert a pipeline into an EventEmitter.  Emits `progress` when a step
 * completes normally, `pause` when a step returns a pause outcome, `done`
 * when the pipeline finishes, and `error` if an exception is thrown.
 */
export function eventsFromPipeline<C, T>(
  p: {
    stream(
      doc: T,
      start?: StreamState<T>
    ): AsyncGenerator<StreamYield<T>, T, void>;
  },
  initial: T
): EventEmitter {
  const emitter = new EventEmitter();
  (async () => {
    for await (const { value, stepIndex, state } of p.stream(initial)) {
      if (isPipelineOutcome<T>(value) && !value.done) {
        // Narrow the union to the pause variant
        const outcome = value as Extract<PipelineOutcome<T>, { done: false }>;
        emitter.emit("pause", {
          reason: outcome.reason,
          payload: outcome.payload,
          stepIndex,
          state,
        });
      } else {
        emitter.emit("progress", { value: value as T, stepIndex, state });
      }
    }
    emitter.emit("done");
  })().catch((err) => emitter.emit("error", err));
  return emitter;
}

/* --------------------------------------------------------------------------
 *  Node stream integration
 */

export type PauseHandler<T> = (pause: PipelineOutcome<T>) => Promise<void>;

/**
 * Create a Transform stream from a pipeline.  Each chunk is processed
 * through the pipeline; pauses trigger the optional handler; normal results
 * are pushed downstream as JSON strings.  Context state is preserved
 * across chunks.
 */
export function pipelineToTransform<C, T>(
  p: {
    next(
      doc: T,
      state?: StreamState<T>
    ): Promise<StreamYield<T> | { done: true; value: T }>;
  },
  onPause?: PauseHandler<T>
): Transform {
  let state: StreamState<T> | undefined;
  return new Transform({
    objectMode: true,
    async transform(chunk: T, _encoding, callback) {
      let doc: T | PipelineOutcome<T> = chunk;
      try {
        while (true) {
          const res = await p.next(doc as T, state);
          if ("done" in res) {
            this.push(JSON.stringify(res.value) + "\n");
            break;
          } else {
            const { value, state: nextState } = res;
            state = nextState;
            if (isPipelineOutcome(value) && !value.done) {
              if (onPause) await onPause(value);
            } else {
              doc = value as T;
            }
          }
        }
        callback();
      } catch (err) {
        callback(err as Error);
      }
    },
  });
}
