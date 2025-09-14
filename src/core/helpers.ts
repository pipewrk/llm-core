/**
 * Helpers for the context-based pipeline, matching the exact step shape:
 *   PipelineStep<I, O, C> = (ctx: C) => (doc: I) => Promise<O | PipelineOutcome<O>>
 *
 * Design goals:
 * - Minimum cognitive load (no tuple transformer layer, no adapters)
 * - Wrappers preserve exact <I,O,C> typing of the wrapped step
 * - Identity-only helpers (cache/tap/multiStrategy/pipeSteps) are typed T→T
 */

import { Transform } from "node:stream";
import { EventEmitter } from "node:events";
import { isPipelineOutcome } from "./pipeline";
import type { PipelineOutcome, PipelineStep, StreamEvent } from "./pipeline";

/* --------------------------------------------------------------------------
 * Step wrappers - natively typed as <I, O, C>
 * -------------------------------------------------------------------------- */

/** Catch exceptions and return a pause with reason 'error'. */
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

/** Retry when a step returns a pause with reason === 'error'. */
export function withRetry<I, O, C extends { pipeline?: { retries?: number } }>(
  step: PipelineStep<I, O, C>
): PipelineStep<I, O, C> {
  return (ctx) => async (doc) => {
    const max = ctx.pipeline?.retries ?? 0;
    let attempt = 0;

    const guarded = withErrorHandling(step)(ctx);

    while (attempt <= max) {
      const r = await guarded(doc);

      if (!isPipelineOutcome<O>(r)) return r;
      if (r.done) return r;                 // completion pause
      if (r.reason !== "error") return r;  // non-retry pause → propagate

      attempt++;
    }

    return { done: false, reason: "retryExceeded", payload: doc } as PipelineOutcome<O>;
  };
}

/** Add a timeout; returns a pause { reason: 'timeout' } if timer wins. */
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

/** Memoise results for identity transforms (T → T). */
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

/** Side-effect without changing the document (identity). */
export function tap<T, C>(sideEffect: (ctx: C, doc: T) => void): PipelineStep<T, T, C> {
  return (ctx) => (doc) => {
    sideEffect(ctx, doc);
    return doc;
  };
}

/** Run multiple T→T strategies; stop on pause or ctx.pipeline.stopCondition. */
export function withMultiStrategy<T, C extends { pipeline?: { stopCondition?: (doc: T) => boolean } }>(
  subs: PipelineStep<T, T, C>[]
): PipelineStep<T, T, C> {
  return (ctx) => async (doc) => {
    let current = doc;

    for (const sub of subs) {
      const r = await sub(ctx)(current);

      if (isPipelineOutcome<T>(r)) {
        if (!r.done) return r;      // propagate pause
        current = r.value;
      } else {
        current = r;
      }

      if (ctx.pipeline?.stopCondition?.(current)) break;
    }

    return current;
  };
}

/** Compose identity steps (T→T) left-to-right; short-circuits on pause. */
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

export function eventsFromPipeline<TInit, O>(
  p: { stream(doc: TInit, resume?: any): AsyncGenerator<StreamEvent<O>, O, void> },
  initial: TInit,
): PipelineEmitter<O> {
  const emitter = new EventEmitter() as PipelineEmitter<O>;
  queueMicrotask(async () => {
    try {
      for await (const evt of p.stream(initial)) {
        if (evt.type === 'pause')    emitter.emit('pause', evt);
        else if (evt.type === 'progress') emitter.emit('progress', evt);
        else emitter.emit('done');
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
              return callback();

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
