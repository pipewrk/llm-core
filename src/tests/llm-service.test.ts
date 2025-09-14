import { describe, it, expect } from "bun:test";
import { LLMService } from "../core/llm-service";
import type { ILogger } from "../types/dataset";

class DummyService extends LLMService {
  public last: string[] = [];
  constructor(ctx?: { logger?: ILogger } | ILogger) {
    super(ctx);
  }
  async generatePromptAndSend<T>(): Promise<T> {
    this.logger.info("dummy");
    this.logger.warn("dummy");
    this.logger.error("dummy");
    this.logger.attn("dummy");
    this.logger.impt("dummy");
    return {} as T;
  }
}

describe("LLMService optional logger", () => {
  it("uses no-op logger when none provided", async () => {
    const s = new DummyService();
    // Should not throw when calling methods
    await s.generatePromptAndSend();
  });

  it("uses logger from context object", async () => {
    const logs: string[] = [];
    const logger: ILogger = {
      info: (...a) => logs.push("info:" + a.join(" ")),
      warn: (...a) => logs.push("warn:" + a.join(" ")),
      error: (...a) => logs.push("error:" + a.join(" ")),
      attn: (...a) => logs.push("attn:" + a.join(" ")),
      impt: (...a) => logs.push("impt:" + a.join(" ")),
    };
    const s = new DummyService({ logger });
    await s.generatePromptAndSend();
    expect(logs.some((l) => l.startsWith("info:"))).toBe(true);
  });

  it("accepts logger directly", async () => {
    let infoCalled = 0;
    const logger: ILogger = {
      info: () => infoCalled++,
      warn: () => {},
      error: () => {},
      attn: () => {},
      impt: () => {},
    };
    const s = new DummyService(logger);
    await s.generatePromptAndSend();
    expect(infoCalled).toBe(1);
  });
});

