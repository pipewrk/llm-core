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

## API

- **Context‑based**: Steps accept a user‑defined context `C`. Use this context to carry loggers, counters, caches, event emitters or any other shared state through the entire pipeline.
- **Helpers**: A suite of helpers provides features such as error handling, retries, timeouts, caching, tapping, progress events and Node stream integration. These helpers live alongside the core pipeline and are documented in `PIPELINE_HELPERS.md`.

## Next Steps

To keep this guide focused, all helper functions are documented separately in [`PIPELINE_HELPERS.md`](https://chatgpt.com/c/PIPELINE_HELPERS.md). There you’ll find examples of how to rate‑limit a step, retry on errors, cache expensive computations, integrate with Node streams and EventEmitters, and compose multiple strategies.
For advanced examples, including rate limiting, human‑in‑the‑loop workflows, backpressure handling and progress reporting, look in the `examples/` directory.
