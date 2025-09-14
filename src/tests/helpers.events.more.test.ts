import { describe, it, expect } from "bun:test";
import { eventsFromPipeline } from "../core/helpers";

describe("eventsFromPipeline error handling", () => {
  it("emits error when pipeline.stream throws", async () => {
    const p = {
      async *stream(_doc: { data: string }) {
        throw new Error("kaboom");
      },
    };

    const emitter = eventsFromPipeline(p as any, { data: "x" });
    await new Promise<void>((resolve) => {
      emitter.on("error", (err) => {
        expect((err as Error).message).toBe("kaboom");
        resolve();
      });
    });
  });
});

