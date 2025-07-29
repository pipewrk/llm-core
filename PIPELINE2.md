# Pipeline Module Developer Guide

The Pipeline module is a lightweight orchestration utility for composing and running data‑processing workflows. A **pipeline** is just a sequence of small functions (called **steps**) that each take some document and return either a new document or a signal to pause. The module provides helpers to create pipelines, add steps, run them end‑to‑end or stream them one step at a time, and pause/resume execution when needed.

This guide describes the `pipeline(context)` API. Instead of forcing every step to accept a logger, you pass in a _context object_ whose shape you define. Your context might include a logger, counters, caches, an `EventEmitter` – whatever shared state your steps need. Each step receives the same context instance, so you can coordinate state across the entire workflow.

## Why pipelines?

Imagine you need to parse incoming messages, enrich them via external services, and then write them somewhere else. You could string together a bunch of `await` calls, but that quickly becomes tangled. A pipeline lets you break the work into discrete steps — like a conveyor belt for your data — reuse those steps in different contexts, and keep the control flow clear. Because steps are just functions, they are easy to test and compose. Think of it as functional programming with a sense of humour.

Pipelines also support _pausing_: a step can return a `PipelineOutcome` with `done: false` to signal that it needs help (for example, waiting on rate limits or human approval). When pausing, the pipeline yields its current state so you can resume from exactly that point later. It’s like politely asking the user to hold your place in line.

## Defining steps

A step is a curried function that takes your context `C` and returns a transformation function on the document type `T`. It may return a new document, a `PipelineOutcome<T>` to pause, or a promise of either. In TypeScript:

```ts
type PipelineStep<C, T> =
  (ctx: C) => (doc: T) => T | PipelineOutcome<T> | Promise<T | PipelineOutcome<T>>;

```

If that signature looks intimidating, don’t worry – writing steps is straightforward. Here are some patterns:

> If you can return a document or a reason to pause, you’re a step. The rest is really just ceremony. Steps are minimal, composable, and a bit anarchic — just the way we like them.

### Basic synchronous step

```ts
// Trim whitespace from a message
const trimMessage: PipelineStep<{ logger?: ILogger }, { text: string }> =
  (ctx) => (doc) => {
    ctx.logger?.info("Trimming message");
    return { ...doc, text: doc.text.trim() };
  };

```
### Asynchronous step

```ts
// Trim whitespace from a message
const trimMessage: PipelineStep<{ logger?: ILogger }, { text: string }> =
  (ctx) => (doc) => {
    ctx.logger?.info("Trimming message");
    return { ...doc, text: doc.text.trim() };
  };
```
### Pause for human intervention

```ts
// Require approval before proceeding
const needsApproval: PipelineStep<{}, MyDoc> = () => (doc) => {
  if (!doc.approved) {
    return {
      done: false,
      reason: "Awaiting approval",
      payload: doc,
    } as PipelineOutcome<MyDoc>;
  }
  return doc;
};

```
### Tap (side effect) step

```ts
// Require approval before proceeding
const needsApproval: PipelineStep<{}, MyDoc> = () => (doc) => {
  if (!doc.approved) {
    return {
      done: false,
      reason: "Awaiting approval",
      payload: doc,
    } as PipelineOutcome<MyDoc>;
  }
  return doc;
};

```
### Multi‑strategy step

Sometimes you want to try several strategies in sequence until one succeeds. Use `addMultiStrategyStep` for this. Provide an array of steps and an optional stop condition. Each sub‑step runs in order; if the stop condition returns `true`, the pipeline skips the remaining strategies.

```ts
// Try three classification strategies until one sets doc.category
const classify1: PipelineStep<Ctx, MyDoc> = ...;
const classify2: PipelineStep<Ctx, MyDoc> = ...;
const classify3: PipelineStep<Ctx, MyDoc> = ...;

pipeline<Ctx, MyDoc>(ctx)
  .addMultiStrategyStep([
    classify1,
    classify2,
    classify3,
  ],
  (doc) => doc.category !== undefined);

```
Put another way: _interrogate your LLMs until they conform_.

## Creating and running pipelines

The factory function `pipeline(context)` creates a new pipeline instance. You specify two type parameters: the context type `C` and the document type `T`. You then chain calls to `addStep` and/or `addMultiStrategyStep` to build the execution plan.

### Example: build and run a simple pipeline

```ts
interface Ctx {
  logger: ILogger;
  apiKey: string;
}

const ctx: Ctx = { logger: new Logger(), apiKey: "ABC123" };

const p = pipeline<Ctx, MyDoc>(ctx)
  .addStep(trimMessage)
  .addStep(enrichFromApi)
  .addStep(needsApproval);

// Fire‑and‑forget execution
const finalDoc = await p.run(initialDoc);
```

`run(doc)` awaits all steps and returns the final document. If any step returns a pause, `run` resolves immediately with the current document.
### Streaming and pausing

Use `stream(doc)` when you need fine‑grained control. It returns an `AsyncGenerator` that yields after each step. The yield value contains the step index, the step’s output, and a resumable state object. When a step pauses, the generator yields a `PipelineOutcome` with `done: false`. You can handle the pause (sleep, ask for input, etc.), then resume from the same point via `next()`.

```ts
const p = pipeline(ctx).addStep(needsApproval);

const generator = p.stream(doc);
for await (const { value, stepIndex, state } of generator) {
  if (isPipelineOutcome<MyDoc>(value) && !value.done) {
    console.log(`Paused at step #${stepIndex + 1}:`, value.reason);
    // do something, e.g. wait or modify the document
    await waitForApproval(value.payload);
    // resume from this state via p.next()
    const resumed = await p.next(value.payload, state);
    // handle resumed similarly
  } else {
    console.log(`Step ${stepIndex + 1} complete`);
    doc = value as MyDoc;
  }
}

```
Alternatively, call `next(doc, state)` to advance the pipeline one yield at a time without managing the generator yourself.

## API reference

### `pipeline<C, T>(context)`

Creates a new pipeline. `context` is an object whose fields are made available to every step. The two generic parameters are:

- `C`: the context type
- `T`: the document type
### `addStep(step: PipelineStep<C, T>)`

Appends a single step to the pipeline. Returns the pipeline so you can chain calls.

### `addMultiStrategyStep(subSteps: PipelineStep<C, T>[], stopCondition?: (doc: T) => boolean)`

Adds a step composed of multiple sub‑steps. Each sub‑step runs in sequence until either they are exhausted or `stopCondition(doc)` returns `true`.

### `run(doc: T): Promise<T>`

Executes all steps sequentially on `doc`. Resolves with the final document. If a step pauses (returns `{ done: false, ... }`), `run` resolves early with the document as it stands.

### `stream(doc: T, start?: StreamState<T>): AsyncGenerator<StreamYield<T>, T, void>`

Returns an async generator that yields after each step. Each yield has the shape:


```ts
interface StreamYield<T> {
  value: T | PipelineOutcome<T>;
  stepIndex: number;
  state: StreamState<T>;
}

```
If `value` is a `PipelineOutcome` with `done: false`, the pipeline paused. The accompanying `state` object contains the document and the next step index so you can resume with `next()`.

### `next(doc: T, state?: StreamState<T>): Promise<StreamYield<T> | { done: true; value: T }>`

Convenience helper to advance the pipeline one yield at a time. Pass in the current document and (optionally) the state from a previous yield. It returns the same type of object yielded by `stream()`, or `{ done: true, value: finalDoc }` when the pipeline completes.

### `PipelineOutcome<T>`

Returned by a step to signal that execution should pause. It has the form:

```ts
type PipelineOutcome<T> = {
  done: false;
  reason: string;
  payload: any;
};
```
When a step pauses, you can inspect `reason` and `payload` to decide how to proceed. When resuming, pass the (potentially modified) document back into `next()` along with the `state` from the pause yield.

### `StreamState<T>`

Internal representation of where the pipeline is paused. Contains:

- `currentDoc`: the document as of the last completed step
- `nextStep`: the index of the next step to execute when resuming

You normally don’t construct this yourself; it is returned by `stream()` and `next()` and passed back into `next()` when resuming.

## Working with streams and events

Pipelines are agnostic of how you feed documents into them. For batch jobs, call `run()` on a single object or an array. For streaming data (e.g. reading lines from a file or network socket), you can write a small helper that reads a chunk, processes it through the pipeline, handles any pauses, and outputs the result. See the examples folder in this repository for ready‑to‑run code that integrates the pipeline with Node streams and `EventEmitter`.

## Where to go next

The examples folder contains more advanced, runnable examples that showcase:

- Rate‑limiting API calls with pauses and resumption
    
- Human‑in‑the‑loop workflows requiring approval before continuing
    
- Backpressure handling when writing to queues or external systems
    
- Real‑time progress reporting via events
    

These examples build upon the API described here and demonstrate how to use the pipeline in real applications.