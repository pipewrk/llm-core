/**
 * Context-owned, stream-capable pipeline.
 *
 * - Steps are `(ctx) => (doc) => out`, no `C` generic.
 * - The parent `pipeline<C, T>(ctx)` injects the SAME `ctx` into EVERY step.
 * - Type evolution: `addStep<N>() => Pipeline<C, N>`, and `run()` returns final `N`.
 * - Streaming/pause via `PipelineOutcome`.
 */

export type MaybePromise<T> = T | Promise<T>;

export type PipelineOutcome<O> =
  | { done: true; value: O }
  | { done: false; reason: string; payload?: unknown };

export function isPipelineOutcome<T>(v: unknown): v is PipelineOutcome<T> {
  return typeof v === "object" && v !== null && "done" in (v as any);
}

/**
 * A pipeline step is a function returning another function:
 *   (context) => (doc: I) => O | Outcome<O> | Promise<...>
 *
 * The pipeline *owns* the `context` instance and passes it in;
 * the step type remains agnostic of the context’s compile-time shape.
 */
export type PipelineStep<I, O> =
  (context: unknown) => (doc: I) => MaybePromise<O | PipelineOutcome<O>>;

export type ResumeState<T> = { nextStep: number; doc: T };

export type StreamEvent<T> =
  | { type: "pause";    step: number; doc: T; info: PipelineOutcome<T>; resume: ResumeState<T> }
  | { type: "progress"; step: number; doc: T;                                         resume: ResumeState<T> }
  | { type: "done" };

export interface PipelineOpts {
  logger?: { info?: (s: string) => void; warn?: (s: string) => void; error?: (e: unknown) => void };
}

/**
 * Public surface.
 * C = the context *shape* (at the factory only); T = current doc type.
 */
export interface Pipeline<C, T> {
  addStep<N>(step: PipelineStep<T, N>): Pipeline<C, N>;
  addMultiStrategyStep<N>(
    subSteps: PipelineStep<T, N>[],
    stopCondition?: (doc: N) => boolean
  ): Pipeline<C, N>;
  run(doc: T): Promise<T>;
  stream(doc: T, resume?: ResumeState<T>): AsyncGenerator<StreamEvent<T>, T, void>;
  next(doc: T, resume?: ResumeState<T>): Promise<StreamEvent<T> | { done: true; value: T }>;
}

/**
 * Factory — REQUIRES a context up front.
 * Every step in this pipeline will receive exactly this `ctx` instance.
 */
export function pipeline<C, T>(ctx: C, opts?: PipelineOpts): Pipeline<C, T> {
  const steps: PipelineStep<any, any>[] = [];
  const log = opts?.logger ?? {};
  const boundCtx: unknown = ctx; // single, predictable context for the whole chain

  const api: Pipeline<C, any> = {
    addStep<N>(step: PipelineStep<T, N>): Pipeline<C, N> {
      steps.push(step as PipelineStep<any, any>);
      return api as unknown as Pipeline<C, N>;
    },

    addMultiStrategyStep<N>(
      subs: PipelineStep<T, N>[],
      stopCondition?: (doc: N) => boolean
    ): Pipeline<C, N> {
      const multi: PipelineStep<T, N> = (c) => async (doc0: T) => {
        let current: any = doc0;
        for (const [i, s] of subs.entries()) {
          log.info?.(`--- multi sub-step #${i + 1} ---`);
          const r = await s(c)(current);
          if (isPipelineOutcome<N>(r)) {
            if (!r.done) return r;   // propagate pause upward
            current = r.value;
          } else {
            current = r;
          }
          if (stopCondition?.(current)) {
            log.info?.(`Short-circuited after sub-step #${i + 1}`);
            break;
          }
        }
        return current as N;
      };

      steps.push(multi as PipelineStep<any, any>);
      return api as unknown as Pipeline<C, N>;
    },

    async run(doc: T): Promise<T> {
      let current = doc;
      for await (const e of api.stream(current)) {
        if (e.type === "pause") return current; // early resolve on pause
        if (e.type === "progress") current = e.doc;
      }
      return current;
    },

    async *stream(
      doc: T,
      resume?: ResumeState<T>
    ): AsyncGenerator<StreamEvent<T>, T, void> {
      let current = resume?.doc ?? doc;
      let index   = resume?.nextStep ?? 0;

      for (; index < steps.length; index++) {
        let res: unknown;
        try {
          // ⬇️ every step gets the SAME pipeline-owned context
          res = await steps[index](boundCtx)(current);
        } catch (err) {
          log.error?.(err);
          res = current; // continue with prior doc
        }

        if (isPipelineOutcome<T>(res)) {
          if (!res.done) {
            const token = { nextStep: index, doc: current };
            yield { type: "pause", step: index, doc: current, info: res, resume: token };
            continue;
          }
          current = res.value;
        } else {
          current = res as T;
        }

        const token = { nextStep: index + 1, doc: current };
        yield { type: "progress", step: index, doc: current, resume: token };
      }

      yield { type: "done" };
      return current;
    },

    async next(doc: T, resume?: ResumeState<T>) {
      const it = api.stream(doc, resume);
      const n = await it.next();
      if (n.done) return { done: true, value: n.value as T };
      return n.value;
    },
  };

  return api as Pipeline<C, T>;
}