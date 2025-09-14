/**
 * Helpers for the context-based pipeline, matching the exact step shape:
 *   PipelineStep<I, O, C> = (ctx: C) => (doc: I) => Promise<O | PipelineOutcome<O>>
 *
 * Design goals:
 * - Low cognitive load (no tuple transformer layer, no adapters).
 * - Wrappers preserve the exact <I,O,C> typing of the wrapped step.
 * - Identity helpers (cache/tap/sequence/pipeSteps) are typed T→T.
 */

import { Transform } from "node:stream";
import { EventEmitter } from "node:events";
import { isPipelineOutcome } from "./pipeline";
import type { PipelineOutcome, PipelineStep, StreamEvent } from "./pipeline";

/* --------------------------------------------------------------------------
 * Step wrappers — natively typed as <I, O, C>
 * -------------------------------------------------------------------------- */

/**
 * withErrorHandling
 * Wraps a step and converts thrown exceptions into a pause outcome:
 *   { done: false, reason: "error", payload: doc }
 *
 * Use when a step may throw synchronously or asynchronously and you want
 * the pipeline to pause (instead of crashing) so a caller can decide how to
 * resume or retry.
 */
export function withErrorHandling<I, O, C>(
  step: PipelineStep<I, O, C>
): PipelineStep<I, O, C> {
  return (ctx) => async (doc) => {
    try {
      return await step(ctx)(doc);
    } catch {
      return { done: false, reason: "error", payload: doc } as PipelineOutcome<O>;
    }
  };
}

/**
 * withRetry
 * Retries a step when it returns a pause with reason === "error".
 *
 * Retries up to `ctx.pipeline?.retries ?? 0` additional times.
 * - If the result is a normal value → return it immediately.
 * - If the result is { done: true, value } → return it.
 * - If the result is a pause with a non-"error" reason → propagate it (no retry).
 * - If retries are exhausted → return { done: false, reason: "retryExceeded" }.
 */
export function withRetry<I, O, C extends { pipeline?: { retries?: number } }>(
  step: PipelineStep<I, O, C>
): PipelineStep<I, O, C> {
  return (ctx) => async (doc) => {
    const max = ctx.pipeline?.retries ?? 0;
    let attempt = 0;

    const guarded = withErrorHandling(step)(ctx);

    while (attempt <= max) {
      const r = await guarded(doc);

      if (!isPipelineOutcome<O>(r)) return r;           // success
      if (r.done) return r;                             // completion pause
      if (r.reason !== "error") return r;               // other pause → propagate

      attempt++;                                        // retry on "error"
    }

    return { done: false, reason: "retryExceeded", payload: doc } as PipelineOutcome<O>;
  };
}

/**
 * withTimeout
 * Adds a timeout to a step. If the timer wins, returns a pause outcome:
 *   { done: false, reason: "timeout", payload: doc }
 *
 * Timeout duration is read from `ctx.pipeline?.timeout` milliseconds.
 * - If timeout <= 0, the step runs normally without racing.
 * - Note: the underlying step is NOT cancelled; this is a soft timeout.
 */
export function withTimeout<I, O, C extends { pipeline?: { timeout?: number } }>(
  step: PipelineStep<I, O, C>
): PipelineStep<I, O, C> {
  return (ctx) => async (doc) => {
    const ms = ctx.pipeline?.timeout ?? 0;
    if (ms <= 0) return step(ctx)(doc);

    return Promise.race([
      step(ctx)(doc),
      new Promise<PipelineOutcome<O>>((resolve) =>
        setTimeout(() => resolve({ done: false, reason: "timeout", payload: doc }), ms)
      ),
    ]);
  };
}

/**
 * withCache (identity)
 * Memoizes results of an identity step (T → T) using a key derived from `doc`.
 * Cache Map is read from `ctx.pipeline?.cache`:
 * - If no cache is present, runs the step normally (no memoization).
 * - Only successful (non-pause) results are cached.
 */
export function withCache<T, C extends { pipeline?: { cache?: Map<unknown, unknown> } }>(
  step: PipelineStep<T, T, C>,
  keyFn: (doc: T) => unknown
): PipelineStep<T, T, C> {
  return (ctx) => async (doc) => {
    const cache = ctx.pipeline?.cache;
    if (!cache) return step(ctx)(doc);

    const key = keyFn(doc);
    if (cache.has(key)) return cache.get(key) as T;

    const result = await step(ctx)(doc);
    if (!isPipelineOutcome(result)) cache.set(key, result);
    return result;
  };
}

/**
 * tap (identity)
 * Executes a side-effect and returns the document unchanged.
 * Perfect for logging/metrics without modifying data flow.
 */
export function tap<T, C>(sideEffect: (ctx: C, doc: T) => void): PipelineStep<T, T, C> {
  return (ctx) => (doc) => {
    sideEffect(ctx, doc);
    return doc;
  };
}

/* --------------------------------------------------------------------------
 * Strategy composition
 * -------------------------------------------------------------------------- */

/**
 * withSequence (identity)
 * Runs multiple T→T steps in order, feeding the output of each into the next.
 * - Short-circuits on pause (propagates the pause).
 * - Promotes { done: true, value } to value.
 * - Stops early if `stopCondition(current)` is true (or if a
 *   `ctx.pipeline.stopCondition(current)` is provided and no explicit
 *   stopCondition is passed).
 *
 * Use when each step refines the document and you want to optionally
 * stop once a satisfactory state is reached.
 */
export function withSequence<
  T, C extends { pipeline?: { stopCondition?: (doc: T) => boolean } }
>(
  subs: PipelineStep<T, T, C>[],
  stopCondition?: (doc: T) => boolean
): PipelineStep<T, T, C> {
  return (ctx) => async (doc) => {
    let current = doc;
    const stop = stopCondition ?? ctx.pipeline?.stopCondition;

    for (const sub of subs) {
      const r = await sub(ctx)(current);

      if (isPipelineOutcome<T>(r)) {
        if (!r.done) return r as PipelineOutcome<T>;
        current = r.value as T;
      } else {
        current = r as T;
      }

      if (stop?.(current)) break;
    }

    return current;
  };
}

function getCtxStopCondition<O>(ctx: unknown): ((out: O) => boolean) | undefined {
  const sc = (ctx as any)?.pipeline?.stopCondition;
  return typeof sc === "function" ? (sc as (out: O) => boolean) : undefined;
}


/**
 * Try multiple I→O strategies in order, feeding each strategy the previous output.
 * - Propagates pauses immediately.
 * - Unwraps { done:true, value }.
 * - Stops when `stopCondition(out)` (or ctx.pipeline.stopCondition) is true.
 * - If none accepted, returns the last successful output.
 */
export function withAlternatives<I, O, C>(
  subs: PipelineStep<I, O, C>[],
  stopCondition?: (out: O) => boolean
): PipelineStep<I, O, C> {
  return (ctx) => async (initialDoc) => {
    let input: I = initialDoc;
    let lastOut: O | undefined;
    const accept = stopCondition ?? getCtxStopCondition<O>(ctx);

    for (const sub of subs) {
      const r = await sub(ctx)(input);

      if (isPipelineOutcome<O>(r)) {
        if (!r.done) return r;         // propagate pause
        lastOut = r.value;             // promote done:true → value
      } else {
        lastOut = r;
      }

      if (accept?.(lastOut)) return lastOut;
      input = lastOut as unknown as I; // feed-forward to next strategy
    }

    if (lastOut !== undefined) return lastOut;
    throw new Error("withAlternatives: no strategy produced an output");
  };
}


/**
 * pipeSteps (identity)
 * Composes multiple identity steps T→T left-to-right:
 *   pipeSteps(a, b, c) ≡ (doc) => c(b(a(doc)))
 *
 * Short-circuits on pause and promotes { done:true, value } to value.
 * This is a convenience when you want to inline a small chain without
 * constructing a nested pipeline.
 */
export function pipeSteps<T, C>(
  ...subs: PipelineStep<T, T, C>[]
): PipelineStep<T, T, C> {
  return (ctx) => async (doc) => {
    let current = doc;
    for (const s of subs) {
      const r = await s(ctx)(current);
      if (isPipelineOutcome<T>(r)) {
        if (!r.done) return r;
        current = r.value;
      } else {
        current = r;
      }
    }
    return current;
  };
}

/* --------------------------------------------------------------------------
 * EventEmitter integration (minimal generics)
 * -------------------------------------------------------------------------- */

/**
 * PipelineEmitter
 * A typed EventEmitter for pipeline streaming events.
 * Emits:
 *  - 'progress' after each step with the current doc
 *  - 'pause' when a step returns a pause outcome (with resume token)
 *  - 'done' when the stream completes
 *  - 'error' if iteration throws
 */
export interface PipelineEmitter<O> extends EventEmitter {
  on(event: 'pause',    listener: (evt: Extract<StreamEvent<O>, { type: 'pause' }>)    => void): this;
  on(event: 'progress', listener: (evt: Extract<StreamEvent<O>, { type: 'progress' }>) => void): this;
  on(event: 'done',     listener: () => void): this;
  on(event: 'error',    listener: (err: unknown) => void): this;

  emit(event: 'pause',    evt: Extract<StreamEvent<O>, { type: 'pause' }>): boolean;
  emit(event: 'progress', evt: Extract<StreamEvent<O>, { type: 'progress' }>): boolean;
  emit(event: 'done'): boolean;
  emit(event: 'error',    err: unknown): boolean;
}

/**
 * eventsFromPipeline
 * Bridges a pipeline’s `stream()` to an EventEmitter interface so callers
 * can subscribe with `.on('progress'|'pause'|'done'|'error', ...)`.
 *
 * Starts iteration on a microtask so listeners can attach before the first emit.
 */
export function eventsFromPipeline<TInit, O>(
  p: { stream(doc: TInit, resume?: any): AsyncGenerator<StreamEvent<O>, O, void> },
  initial: TInit,
): PipelineEmitter<O> {
  const emitter = new EventEmitter() as PipelineEmitter<O>;
  queueMicrotask(async () => {
    try {
      for await (const evt of p.stream(initial)) {
        if (evt.type === 'pause')        emitter.emit('pause', evt);
        else if (evt.type === 'progress') emitter.emit('progress', evt);
        else                              emitter.emit('done');
      }
    } catch (err) {
      emitter.emit('error', err);
    }
  });
  return emitter;
}

/* --------------------------------------------------------------------------
 * Node stream integration
 * -------------------------------------------------------------------------- */

/**
 * pipelineToTransform
 * Wraps a pipeline into a Node.js Transform stream (objectMode=true).
 *
 * Behavior:
 *  - For each incoming chunk (treated as the initial doc), iteratively calls
 *    `next()` until completion.
 *  - On 'progress': pushes the current doc as a JSON line.
 *  - On 'pause': calls optional `onPause(evt)` and stops processing this chunk
 *    (caller can choose to resume later).
 *  - On completed run: pushes the final value as a JSON line.
 *
 * This is useful when you want to wire a pipeline into a streaming system
 * (e.g., CLI tools, ETL jobs) without bespoke glue code.
 */
export type PauseEvent<O> = Extract<StreamEvent<O>, { type: 'pause' }>;
export type PauseHandler<O> = (evt: PauseEvent<O>) => Promise<void>;

export function pipelineToTransform<TInit, O>(
  p: { next(doc: TInit, resume?: any): Promise<StreamEvent<O> | { done: true, value: O }> },
  onPause?: PauseHandler<O>,
): Transform {
  let current: O | TInit;

  return new Transform({
    objectMode: true,

    async transform(chunk: TInit, _enc, callback) {
      current = chunk; // initial doc
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
              return callback(); // stop this chunk on pause

            case 'progress':
              current = res.doc;
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