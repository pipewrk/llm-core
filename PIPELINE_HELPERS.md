## Pipeline Helpers Reference

The pipeline core is intentionally minimal: it orchestrates a document through a sequence of steps that all share a bound context object. Cross‑cutting concerns (retries, timeouts, caching, logging, composition, and integrations) live in `src/core/helpers.ts`.

Shape recap

```
type PipelineStep<I, O, C> = (ctx: C) => (doc: I) => Promise<O | PipelineOutcome<O>>
```

All helpers preserve generics exactly: `<I, O, C>` stays the same after wrapping.

Table of contents

1. withErrorHandling
2. withRetry
3. withTimeout
4. withCache
5. tap
6. withMultiStrategy
7. pipeSteps
8. eventsFromPipeline
9. pipelineToTransform

---

## withErrorHandling

Wraps a step; catches throws and returns a pause `{ done: false, reason: 'error' }`.

```ts
const sFetch: PipelineStep<Input, Output, Logger> = (ctx) => async (doc) => {
  // may throw
  return fetchAndParse(doc);
};

const sSafe = withErrorHandling(sFetch);
// type: PipelineStep<Input, Output, Logger>
```

## withRetry

Retries only on `{ done:false, reason:'error' }` up to `ctx.pipeline?.retries`.

```ts
type Ctx = Logger & { pipeline?: { retries?: number } };

const sFlaky: PipelineStep<T, T, Ctx> = (ctx) => async (doc) => {
  // may pause with reason:'error'
  return maybeFlaky(doc);
};

const sRetried = withRetry(sFlaky);
// set per-run:
const ctx: Ctx = Object.assign(new Logger('./log.md'), { pipeline: { retries: 2 } });
```

## withTimeout

Races a step against `ctx.pipeline?.timeout` (ms). On timeout → `{ done:false, reason:'timeout' }`.

```ts
type Ctx = Logger & { pipeline?: { timeout?: number } };

const sSlow: PipelineStep<T, T, Ctx> = (ctx) => async (doc) => {
  await sleep(5000);
  return doc;
};

const sTimed = withTimeout(sSlow);
// ctx.pipeline.timeout = 1000 → pause('timeout')
```

## withCache (T → T)

Caches successful (non‑pause) results in `ctx.pipeline?.cache` by key.

```ts
type Ctx = Logger & { pipeline?: { cache?: Map<unknown, unknown> } };

const sExpensive: PipelineStep<T, T, Ctx> = (ctx) => async (doc) => {
  return await heavyCompute(doc);
};

const sCached = withCache(sExpensive, d => d.id);
// ctx.pipeline.cache = new Map()
```

## tap (T → T)

Side‑effect; forwards doc unchanged.

```ts
const sTap = tap<T, Logger>((ctx, doc) => ctx.info?.(`seen ${doc.id}`));
// type: PipelineStep<T, T, Logger>
```

## withMultiStrategy (T → T)

Runs multiple identity steps; short‑circuits on pause; optional `ctx.pipeline.stopCondition(doc)`.

```ts
type Ctx = Logger & { pipeline?: { stopCondition?: (doc: T) => boolean } };

const s1: PipelineStep<T, T, Ctx> = /* … */;
const s2: PipelineStep<T, T, Ctx> = /* … */;

const sMulti = withMultiStrategy<T, Ctx>([s1, s2]);

// Optionally:
ctx.pipeline = { stopCondition: d => d.ready === true };
```

If none pause and no stop condition triggers, returns the final doc.

## pipeSteps (T → T)

Functional compose for identity steps (left→right). Short‑circuits on pause.

```ts
const s = pipeSteps<T, Logger>(
  tap((ctx, d) => ctx.info?.('start')),
  withErrorHandling(someIdentityStep),
  withTimeout(anotherIdentityStep as PipelineStep<T, T, Logger>),
);
```

## eventsFromPipeline

Wrap a pipeline so you can listen to progress and pause events. Returns an `EventEmitter` that emits strongly‑typed events:

- `'progress'`: `{ type: 'progress'; step: number; doc: T; resume: { nextStep: number; doc: T } }`
- `'pause'`:    `{ type: 'pause';    step: number; doc: T; info: { done: false; reason: string; payload?: unknown }; resume: { nextStep: number; doc: T } }`
- `'done'`:     `{ type: 'done' }`
- `'error'`:    `(err: unknown)`

```ts
import { eventsFromPipeline } from "@jasonnathan/llm-core";

const emitter = eventsFromPipeline(p, initialDoc);
emitter.on("progress", ({ step, doc }) =>
  console.log("step", step, doc)
);
emitter.on("pause", ({ info }) => console.log("paused because", info.reason));
emitter.on("done", () => console.log("finished"));
```

This is useful for UI integration or monitoring long‑running pipelines.

## pipelineToTransform

Convert a pipeline into a Node.js `Transform` stream. Each object written to the transform is processed through the pipeline using `p.next(doc, resume)`. Normal results are pushed downstream as newline‑delimited JSON; pauses trigger the optional `onPause` handler and stop processing of the current chunk. The transform carries a resume token internally so subsequent progress starts from the correct step.

```ts
import { pipelineToTransform } from "@jasonnathan/llm-core";
import { createReadStream, createWriteStream } from "fs";

const transform = pipelineToTransform(p, async (pause) => {
  if (pause.reason === "rateLimit") {
    await wait(pause.payload.wait);
  }
});

createReadStream("in.ndjson", { encoding: "utf8", objectMode: true })
  .pipe(transform)
  .pipe(createWriteStream("out.ndjson"));
```

If you don’t provide `onPause`, the transform still stops processing the current chunk on a pause; it’s up to the caller to decide when to resume or re‑enqueue.

## Real‑world snippet

Tying it together with retries, timeout, cache and tap:

```ts
type Ctx = Logger & { pipeline?: { retries?: number; timeout?: number; cache?: Map<unknown,unknown> } };

const stepFetch: PipelineStep<Input, Mid, Ctx> = /* … */;
const stepProcess: PipelineStep<Mid, Mid, Ctx> = /* … */;
const stepFinal: PipelineStep<Mid, Final, Ctx> = /* … */;

const ctx: Ctx = Object.assign(new Logger('./run.md'), {
  pipeline: { retries: 2, timeout: 1500, cache: new Map() }
});

const p = pipeline<Ctx, Input>(ctx)
  .addStep(withRetry(withErrorHandling(stepFetch)))      // I: Input → O: Mid
  .addStep(withCache(withTimeout(stepProcess), m => m.key)) // Mid → Mid
  .addStep(tap<Mid, Ctx>((c, d) => c.info?.(`mid: ${d.key}`)))
  .addStep(stepFinal);                                   // Mid → Final

const result = await p.run(initialInput);
```
