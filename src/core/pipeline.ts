// core/pipeline.ts

export type MaybePromise<T> = T | Promise<T>;

export type PipelineOutcome<O> =
  | { done: true; value: O }
  | { done: false; reason: string; payload?: unknown };

export function isPipelineOutcome<T>(v: unknown): v is PipelineOutcome<T> {
  return typeof v === "object" && v !== null && "done" in (v as Record<string, unknown>);
}

/** Step: (context) => (doc: I) => O | Outcome<O> | Promise<…>  */
export type PipelineStep<I, O, C = unknown> =
  (context: C) => (doc: I) => MaybePromise<O | PipelineOutcome<O>>;

export type ResumeState<T> = { nextStep: number; doc: T };

export type StreamEvent<T> =
  | { type: "pause";    step: number; doc: T; info: PipelineOutcome<T>; resume: ResumeState<T> }
  | { type: "progress"; step: number; doc: T;                                         resume: ResumeState<T> }
  | { type: "done" };

/** Public surface: input fixed to TInit; output evolves with steps. */
export interface Pipeline<C, TInit, O = TInit> {
  addStep<N>(step: PipelineStep<O, N, C>): Pipeline<C, TInit, N>;
  run(doc: TInit): Promise<O>;
  stream(doc: TInit, resume?: ResumeState<TInit>): AsyncGenerator<StreamEvent<O>, O, void>;
  next(doc: TInit, resume?: ResumeState<TInit>): Promise<StreamEvent<O> | { done: true; value: O }>;
}

/** Factory - binds a single context; no opts. */
export function pipeline<C, TInit>(ctx: C): Pipeline<C, TInit> {
  // store hetero steps erased to a common callable; context is strongly C
  const steps: PipelineStep<any, any, C>[] = [];
  const boundCtx: C = ctx;

  // optional logger discovery from ctx (works if ctx is a Logger or has .logger)
  const log = (() => {
    const anyCtx = ctx as any;
    const logger = anyCtx?.logger ?? anyCtx;
    return {
      info : logger?.info?.bind(logger) as ((s: string) => void) | undefined,
      warn : logger?.warn?.bind(logger) as ((s: string) => void) | undefined,
      error: logger?.error?.bind(logger) as ((e: unknown) => void) | undefined,
    };
  })();

  /** Internal engine typed to the *current* doc type AND the bound context C. */
  interface Engine<TCurrent> {
    addStep<N>(step: PipelineStep<TCurrent, N, C>): Engine<N>;
    run(doc: TCurrent): Promise<TCurrent>;
    stream(
      doc: TCurrent,
      resume?: ResumeState<TCurrent>
    ): AsyncGenerator<StreamEvent<TCurrent>, TCurrent, void>;
    next(
      doc: TCurrent,
      resume?: ResumeState<TCurrent>
    ): Promise<StreamEvent<TCurrent> | { done: true; value: TCurrent }>;
  }

  function makeEngine<TCurrent>(): Engine<TCurrent> {
    return {
      addStep<N>(step: PipelineStep<TCurrent, N, C>): Engine<N> {
        steps.push(step as PipelineStep<any, any, C>);
        return makeEngine<N>();
      },

      async run(doc: TCurrent): Promise<TCurrent> {
        let current: unknown = doc;
        for await (const e of this.stream(doc)) {
          if (e.type === "pause") return current as TCurrent;
          if (e.type === "progress") current = e.doc;
        }
        return current as TCurrent;
      },

      async *stream(
        doc: TCurrent,
        resume?: ResumeState<TCurrent>
      ): AsyncGenerator<StreamEvent<TCurrent>, TCurrent, void> {
        let current: unknown = resume?.doc ?? doc;
        let index = resume?.nextStep ?? 0;

        for (; index < steps.length; index++) {
          let res: unknown;
          try {
            res = await steps[index](boundCtx)(current);
          } catch (err) {
            log.error?.(err);
            res = current; // continue on error
          }

          if (isPipelineOutcome<TCurrent>(res)) {
            if (!res.done) {
              const token = { nextStep: index, doc: current as TCurrent };
              yield { type: "pause", step: index, doc: current as TCurrent, info: res, resume: token };
              continue;
            }
            current = res.value as TCurrent;
          } else {
            current = res as TCurrent;
          }

          const token = { nextStep: index + 1, doc: current as TCurrent };
          yield { type: "progress", step: index, doc: current as TCurrent, resume: token };
        }

        yield { type: "done" };
        return current as TCurrent;
      },

      async next(doc: TCurrent, resume?: ResumeState<TCurrent>) {
        const it = this.stream(doc, resume);
        const n = await it.next();
        if (n.done) return { done: true, value: n.value as TCurrent };
        return n.value;
      },
    };
  }

  /** Public façade: fixes input at TInit; output evolves with steps. */
  function makeApi<OCurrent>(eng: Engine<OCurrent>): Pipeline<C, TInit, OCurrent> {
    return {
      addStep<N>(step: PipelineStep<OCurrent, N, C>): Pipeline<C, TInit, N> {
        const nextEng = eng.addStep(step);   // <-- now expects C, matches
        return makeApi<N>(nextEng);
      },

      run(doc: TInit): Promise<OCurrent> {
        // Safe boundary: first step accepts TInit at runtime.
        return eng.run(doc as unknown as OCurrent) as Promise<OCurrent>;
      },

      stream(doc: TInit, resume?: ResumeState<TInit>) {
        return eng.stream(
          doc as unknown as OCurrent,
          resume as unknown as ResumeState<OCurrent>
        ) as AsyncGenerator<StreamEvent<OCurrent>, OCurrent, void>;
      },

      next(doc: TInit, resume?: ResumeState<TInit>) {
        return eng.next(
          doc as unknown as OCurrent,
          resume as unknown as ResumeState<OCurrent>
        ) as Promise<StreamEvent<OCurrent> | { done: true; value: OCurrent }>;
      },
    };
  }

  return makeApi<TInit>(makeEngine<TInit>());
}