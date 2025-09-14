## Pipeline Helpers Reference

The pipeline core is intentionally minimal: it orchestrates the flow of a document and its context through a series of steps. Cross‑cutting concerns (retries, timeouts, caching, logging, compositional strategies, event emission and stream integration) are implemented as **helpers**. This document summarises each helper exported from `src/core/helpers.ts` and demonstrates how to use them.

> All helpers operate on the same `(ctx, doc) → [ctx, doc]` shape. They return either the updated document or a pause outcome alongside the context, and may do so synchronously or asynchronously. This uniform signature makes them fully composable with one another.

## Table of contents

1. [pipe](#pipe)
2. [withErrorHandling](#witherrorhandling)
3. [withRetry](#withretry)
4. [withTimeout](#withtimeout)
5. [withCache](#withcache)
6. [tap](#tap)
7. [withMultiStrategy](#withmultistrategy)
8. [eventsFromPipeline](#eventsfrompipeline)
9. [pipelineToTransform](#pipelinetotransform)

---

## pipe(...transforms)

Combine multiple transformers into one. Each transformer has the signature `(ctx, T) → [ctx, T | PipelineOutcome<T>]` or a promise of that tuple. When composed, the transformers run in sequence until either all complete or one returns a pause outcome. Synchronous and asynchronous transformers can be mixed freely. Comes in `pipe` and `compose` variants.

```ts
import { pipe, compose, Transformer } from '@jasonnathan/llm-core';

const a: Transformer<Ctx, Doc> = async (ctx, doc) => { /* ... */ };
const b: Transformer<Ctx, Doc> = async (ctx, doc) => { /* ... */ };

// you can use compose(a, b) here as well, which runs b → a
const ab = pipe(a, b);
const [newCtx, result] = await ab(ctx, doc);
```

Use this when writing custom transformers or combining helper wrappers outside of a pipeline context.

## withErrorHandling(step)

Wrap a step so that any thrown exception becomes a pause. The returned step catches exceptions from the original step and returns `{ done: false, reason: 'error', payload: doc }` without mutating the context.

```ts
import { withErrorHandling } from "@jasonnathan/llm-core";

// A step that may throw
const flaky: PipelineStep<Ctx & { error?: unknown }, Doc> =
  (ctx) => async (doc) => {
    if (Math.random() < 0.5) throw new Error("Boom");
    return doc;
  };

const safe = withErrorHandling(flaky);
```

When the pipeline encounters a pause with reason `'error'`, you can decide whether to retry, log and continue, or abort.

## withRetry(step, retries = 3)

Attempt to run a step multiple times when it pauses due to an error. The number of retries is taken from `ctx.pipeline.retries` (default `0`). Only pauses with `reason === 'error'` are retried; other pauses are propagated immediately.

```ts
import { withRetry } from '@jasonnathan/llm-core';

interface RetryCtx { pipeline: { retries?: number } }

const ctx: RetryCtx = { pipeline: { retries: 5 } };

const flakyStep = withRetry(flaky);
pipeline(ctx).addStep(flakyStep);
```

If the retry limit is exceeded, the wrapper returns a pause with reason `'retryExceeded'`.

## withTimeout(step, ms)

Add a timeout to a step. The timeout duration (in milliseconds) is read from `ctx.pipeline.timeout`. If the step does not complete within this time, the helper returns a pause `{ done: false, reason: 'timeout', payload: doc }`. It does not cancel the underlying work.

```ts
import { withTimeout } from '@jasonnathan/llm-core';

interface TimeoutCtx { pipeline: { timeout: number } }

const slow: PipelineStep<TimeoutCtx, Doc> = () => async (doc) => {
  await new Promise((res) => setTimeout(res, 10_000));
  return doc;
};

const guarded = withTimeout(slow);

// Example context with a 2‑second timeout
const ctx: TimeoutCtx = { pipeline: { timeout: 2000 } };

pipeline(ctx).addStep(guarded);

```

## withCache(step, keyFn)

Memoise a step’s result based on a key derived from the document. Results are stored in `ctx.pipeline.cache` if provided. Only successful results (non‑pauses) are cached; if no cache is configured, the step runs normally.

```ts
import { withCache } from '@jasonnathan/llm-core';

// Context must include a `cache` property for caching to work
interface MyCtx { pipeline: { cache?: Map<any, unknown> } }

const expensive: PipelineStep<MyCtx, Doc> = (ctx) => async (doc) => {
  // simulate expensive call
  return { ...doc, data: await fetchSomething(doc.id) };
};

// Wrap with caching; derive keys from the document
const cachedExpensive = withCache(expensive, (doc) => doc.id);

// Create context with a cache Map and other fields
const ctx: MyCtx = { pipeline: { cache: new Map() } };

pipeline(ctx).addStep(cachedExpensive);
```

Initialize `ctx.cache = new Map()` before using this helper.

## tap(sideEffect)

Create a step that executes a side effect and returns the document unchanged. Ideal for logging, tracing or metrics.

```ts
import { tap } from "@jasonnathan/llm-core";

const logStep = tap<Ctx, Doc>((ctx, doc) => {
  ctx.logger.info("Doc ID", doc.id);
});

pipeline(ctx).addStep(logStep);
```

## withMultiStrategy(subSteps, stopCondition?)
Compose multiple steps into one. Runs each sub‑step in order until one pauses or the optional `ctx.pipeline.stopCondition(doc)` returns `true`.

```ts
import { withMultiStrategy } from '@jasonnathan/llm-core';

interface MultiCtx { pipeline: { stopCondition?: (doc: Doc) => boolean } }

const strategy1: PipelineStep<MultiCtx, Doc> = …;
const strategy2: PipelineStep<MultiCtx, Doc> = …;
const strategy3: PipelineStep<MultiCtx, Doc> = …;

const multi = withMultiStrategy([strategy1, strategy2, strategy3]);

// Provide a stop condition via context
const ctx: MultiCtx = { pipeline: { stopCondition: (doc) => !!doc.result } };

pipeline(ctx).addStep(multi);

```

If none of the strategies pause and the stop condition never triggers, the result of the last strategy is returned.

## eventsFromPipeline(p, initial)

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

## pipelineToTransform(p, onPause?)

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

