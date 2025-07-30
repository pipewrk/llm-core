## Pipeline Module: Context‑Based Design

The Pipeline module provides a lightweight way to orchestrate data‑processing workflows. A pipeline is simply a series of functions (**steps**) that each take a document and a shared **context**, transform the document, and optionally signal that execution should pause. This context‑based design lets you carry loggers, counters, caches or other shared state through every step without hard‑coding dependencies.

## Visual Flow

The diagram below illustrates the pipeline model. A document enters the pipeline with its context and flows through each step in order. At any step the pipeline may _yield_ a pause outcome (for example, waiting for human input or a rate‑limit timeout). The caller can inspect the pause, act on it and then resume processing from the same point.

```mermaid
flowchart TD
  Start([Context + Document]) --> Step1[Step 1]
  Step1 -->|Doc| Step2[Step 2]
  Step2 -->|Doc| Step3[Step 3]
  Step3 -->|Doc| End[Final Document]
  Step1 -.->|Pause (PipelineOutcome)| Pause1(( ))
  Step2 -.->|Pause (PipelineOutcome)| Pause2(( ))
  Step3 -.->|Pause (PipelineOutcome)| Pause3(( ))
  Pause1 -- Resume --> Step1
  Pause2 -- Resume --> Step2
  Pause3 -- Resume --> Step3
```

Each dashed arrow represents a `PipelineOutcome<T>` returned by a step with `done: false`. The pipeline suspends execution at that point. When you resume (via `next()`), the pipeline picks up exactly where it left off.

## Defining Steps

A step is a curried function taking your context `C` and returning a transformation function on the document type `T`:

```ts
type PipelineStep<C, T> = (
  ctx: C
) => (doc: T) => T | PipelineOutcome<T> | Promise<T | PipelineOutcome<T>>;
```

Steps may synchronously or asynchronously transform the document. To pause execution, return `{ done: false, reason: string, payload: any }`. When the pipeline encounters such a result it yields control to the caller.

### Example Steps

```ts
interface MsgCtx {
  logger: Console;
}
interface Message {
  text: string;
  approved?: boolean;
}

// Trim whitespace
const trim: PipelineStep<MsgCtx, Message> = (ctx) => (doc) => {
  ctx.logger.info("Trimming text...");
  return { ...doc, text: doc.text.trim() };
};

// Require approval
const requireApproval: PipelineStep<MsgCtx, Message> = () => (doc) => {
  if (!doc.approved) {
    return {
      done: false,
      reason: "approval",
      payload: doc,
    } as PipelineOutcome<Message>;
  }
  return doc;
};
```

## Creating Pipelines

Use `pipeline<C, T>(context)` to create a new pipeline. Chain `.addStep()` to add steps. Then either `.run(doc)` to process the entire pipeline, `.stream(doc)` to iterate through each yield, or `.next(doc, state)` for fine‑grained control.

```ts
const ctx: MsgCtx = { logger: console };
const p = pipeline<MsgCtx, Message>(ctx).addStep(trim).addStep(requireApproval);

// Run end‑to‑end
p.run({ text: " hello " }).then((final) => console.log(final));

// Stream and handle pauses
for await (const { value, stepIndex, state } of p.stream({ text: " hello " })) {
  if (isPipelineOutcome<Message>(value) && !value.done) {
    // handle pause (e.g. ask user), then resume via p.next()
    value.payload.approved = true;
    const resumed = await p.next(value.payload, state);
    // ... handle resumed
  } else {
    // normal progress
  }
}
```

## API Reference & Usage

### Core Types

#### `PipelineContext<U = {}, T = any>`

A single context object that carries both your own fields **and** the pipeline’s built‑in controls and state:

```ts
export type PipelineContext<U = {}, T = any> = U & {
  /** Pipeline helpers’ options */
  pipeline: {
    retries?: number;                        // ⏲ number of retry attempts
    timeout?: number;                        // ⏲ race step vs timer
    cache?: Map<any, unknown>;               // ⚡ memoisation store
    stopCondition?: (doc: T) => boolean;     // 🛑 short‑circuit multi‑strategy
  };
  /** Internal state for streaming & resume */
  state: {
    history: Array<{ step: number; doc: T }>;
    resume?: StreamState<T>;
  };
};
```

#### `PipelineOutcome<T>`

Signal a pause or early “done” from within a step:

```ts
export type PipelineOutcome<T> =
  | { done: false; reason: string; payload: T }  // pause, with a reason & document
  | { done: true;  value: T };                  // an early “done” that still produces a new doc
```

#### `PipelineStep<C, T>`

A curried function that, given your context type `C`, returns a transformer over `T`.  A step may return the new `T` (sync or async) or a `PipelineOutcome<T>` to pause or complete early.

```ts
export type PipelineStep<C, T> =
  (ctx: C) =>
    (doc: T) =>
      T
      | PipelineOutcome<T>
      | Promise<T | PipelineOutcome<T>>;
```

---

### Pipeline Factory

#### `pipeline<C, T>(ctx: PipelineContext<C, T>): Pipeline<C, T>`

Create a new pipeline bound to your context:

```ts
const myCtx: PipelineContext<{ logger: Console }, Doc> = {
  logger: console,
  pipeline: {},
  state: { history: [] },
};

const p = pipeline(myCtx);
```

#### `addStep(step: PipelineStep<C, T>) → this`

Append a single step to the pipeline’s sequence:

```ts
p.addStep(trimStep)
 .addStep(validateStep)
 .addStep(transformStep);
```

#### `run(doc: T) → Promise<T>`

Execute every step in order and resolve with the final document.
If any step returns a **pause** outcome (`done: false`), `run()` resolves immediately with the last document state.

```ts
const finalDoc = await p.run(initialDoc);
```

#### `stream(doc: T, start?: StreamState<T>) → AsyncGenerator<StreamEvent<C,T>, T, void>`

Iterate step‑by‑step, yielding after **every** step:

* **`type: 'progress'`** → a normal document
* **`type: 'pause'`**    → a pause outcome `{ done:false,… }`
* **`type: 'done'`**     → pipeline finished

Use this for human‑in‑the‑loop, back‑pressure or progress reporting:

```ts
for await (const evt of p.stream(initialDoc)) {
  if (evt.type === "pause") {
    // handle evt.info, then resume…
  } else if (evt.type === "progress") {
    console.log(evt.doc);
  }
}
```

#### `next(doc: T, state?: StreamState<T>) → Promise<StreamYield<T> | {done:true;value:T}>`

Advance the pipeline exactly one step (or resume from a pause) without managing the generator yourself.

---

### Streaming Types

```ts
export interface StreamState<T> {
  currentDoc: T;     // last doc before the next step
  nextStep: number;  // index of the next step to run
}

export interface StreamEvent<C, T> =
  | { type: 'progress'; step: number; doc: T }
  | { type: 'pause';    step: number; doc: T; info: Extract<PipelineOutcome<T>, {done:false}> }
  | { type: 'done' };
```

### Helpers

A suite of ready‑made wrappers lives in **`src/core/helpers.ts`** (see `PIPELINE_HELPERS.md`):

* **Error handling**: `withErrorHandling(step)`
* **Retries**:        `withRetry(step)`
* **Timeouts**:       `withTimeout(step)`
* **Caching**:        `withCache(step, keyFn)`
* **Tap**:            `tap(sideEffect)`
* **Multi‑strategy**: `withMultiStrategy([stepA, stepB, …])`
* **Composable**:     `compose(t1, t2, …)`

---

### Integrations

* **EventEmitter**:  `eventsFromPipeline(pipeline, initial)` → strongly‑typed emitter
* **Node Streams**:  `pipelineToTransform(pipeline, onPause?)` → a `Transform` in object mode

For detailed examples of rate‑limiting, human‑in‑the‑loop, backpressure, progress reporting, and more, see the companion [`PIPELINE_HELPERS.md`](./PIPELINE_HELPERS.md) and the `examples/` directory.
