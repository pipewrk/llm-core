import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";

// Mock winston BEFORE importing Logger
type Captured = { level: string; message: string };
const captured: Captured[] = [];
const printfFns: Array<(info: any) => string> = [];
const formattedOutputs: string[] = [];

const fakeWinston = {
  captured,
  formattedOutputs,
  addColors: mock((_colors: Record<string, string>) => {}),
  transports: {
    File: function File(this: any, _opts: any) {},
    Console: function Console(this: any, _opts: any) {},
  },
  format: {
    combine: (..._args: any[]) => ({}),
    timestamp: () => ({}),
    printf: (fn: any) => {
      printfFns.push(fn);
      return {};
    },
  },
  createLogger: mock((_opts: any) => ({
    log: ({ level, message }: { level: string; message: string }) => {
      captured.push({ level, message });
      const info = {
        level,
        message,
        timestamp: new Date().toISOString(),
      };
      for (const f of printfFns) {
        try {
          const out = f(info);
          if (typeof out === "string") formattedOutputs.push(out);
        } catch {}
      }
    },
    error: (msg: unknown) => {
      const message = typeof msg === "string" ? msg : (msg as any)?.message ?? String(msg);
      captured.push({ level: "error", message });
    },
  })),
};

mock.module("winston", () => ({ default: fakeWinston }));

const { Logger } = await import("../core/logger");

describe("Logger", () => {
  const logs = captured as Array<{ level: string; message: string }>;

  let originalFetch: any;

  beforeEach(() => {
    logs.length = 0;
    // @ts-ignore
    originalFetch = global.fetch;
  });

  afterEach(() => {
    // reset fetch between tests
    // @ts-ignore
    global.fetch = originalFetch;
  });

  it("logs messages at all levels and stringifies objects", () => {
    const logger = new Logger("./tmp/test-log.md");
    logger.attn("a", { x: 1 });
    logger.impt("b", { y: 2 });
    logger.info("c", { z: 3 });
    logger.warn("d", { w: 4 });
    logger.error("e", { v: 5 });

    expect(logs.length).toBe(5);
    expect(logs[0]).toEqual({ level: "attn", message: "a {\n  \"x\": 1\n}" });
    expect(logs[4]).toEqual({ level: "error", message: "e {\n  \"v\": 5\n}" });
    // Ensure formatters were executed for both transports
    expect((fakeWinston as any).formattedOutputs.length).toBeGreaterThan(0);
    expect((fakeWinston as any).formattedOutputs.some((s: string) => s.includes("[ATTN]"))).toBe(true);
  });

  it("batches to Ntfy after batchSize messages", async () => {
    const fetchCalls: any[] = [];
    // @ts-ignore
    global.fetch = mock((url: string, init?: any) => {
      fetchCalls.push({ url, init });
      return Promise.resolve({ ok: true, statusText: "OK" });
    });

    const logger = new Logger("./tmp/test-log.md", "https://ntfy.test/topic");

    // 10 messages to hit batchSize
    for (let i = 0; i < 10; i++) {
      logger.info(`m${i}`);
    }

    // flushQueue is async; give microtasks a tick
    await Promise.resolve();

    expect(fetchCalls.length).toBe(1);
    const body: string = fetchCalls[0].init.body;
    expect(body.split("\n").length).toBe(10);
    expect(body.includes("m0")).toBe(true);
    expect(body.includes("m9")).toBe(true);
  });

  it("logs error when Ntfy responds non-OK", async () => {
    // @ts-ignore
    global.fetch = mock((_url: string, _init?: any) =>
      Promise.resolve({ ok: false, statusText: "Bad" })
    );

    const logger = new Logger("./tmp/test-log.md", "https://ntfy.bad/topic");

    for (let i = 0; i < 10; i++) logger.info("x");
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));

    // An error should be logged by the internal winston logger
    expect(logs.some((l) => l.level === "error")).toBe(true);
  });

  it("flushQueueSync sends remaining messages immediately", async () => {
    const calls: any[] = [];
    // @ts-ignore
    global.fetch = mock((url: string, init?: any) => {
      calls.push({ url, init });
      return Promise.resolve({ ok: true, statusText: "OK" });
    });

    const logger = new Logger("./tmp/test-log.md", "https://ntfy.sync/topic");
    // enqueue fewer than batchSize
    logger.info("one");
    logger.info("two");

    // @ts-ignore access private for coverage
    await (logger as any).flushQueueSync();

    expect(calls.length).toBe(1);
    expect(calls[0].init.body).toContain("one");
    expect(calls[0].init.body).toContain("two");
  });

  it("stripConsoleFormatting and formatForPlainTransport work as expected", () => {
    const logger = new Logger("./tmp/test-log.md");
    const colored = "\x1b[31mRED\x1b[0m plain";
    // @ts-ignore private access
    const stripped = (logger as any).stripConsoleFormatting(colored);
    expect(stripped).toContain("RED plain");

    // @ts-ignore private access
    const fmt = (logger as any).formatForPlainTransport({ a: 1 });
    expect(fmt).toBe("{\n  \"a\": 1\n}");
  });

  it("console formatter falls back to white for unknown level", () => {
    const logger = new Logger("./tmp/test-log.md");
    // call the internal log with an unknown level to hit fallback color path
    // @ts-ignore private access
    (logger as any).log("unknown", "\x1b[31mX\x1b[0m");
    expect((fakeWinston as any).formattedOutputs.some((s: string) => s.includes("[UNKNOWN]"))).toBe(true);
  });

  it("startBatchTimer flushes periodically", async () => {
    const calls: any[] = [];
    // @ts-ignore
    global.fetch = mock((url: string, init?: any) => {
      calls.push({ url, init });
      return Promise.resolve({ ok: true, statusText: "OK" });
    });

    const logger = new Logger("./tmp/test-log.md", "https://ntfy.timer/topic");
    // @ts-ignore private access
    (logger as any).startBatchTimer(1);
    logger.info("tick1");
    logger.info("tick2");
    await new Promise((r) => setTimeout(r, 5));
    // @ts-ignore
    clearInterval((logger as any).batchTimer);
    expect(calls.length).toBeGreaterThan(0);
  });

  it("flushQueue and flushQueueSync early-return when not configured", async () => {
    const logger = new Logger("./tmp/test-log.md");
    const origFetch = global.fetch;
    // @ts-ignore ensure fetch would throw if called
    global.fetch = mock(() => { throw new Error("should not be called"); });
    // @ts-ignore private access
    await (logger as any).flushQueue();
    // @ts-ignore private access
    await (logger as any).flushQueueSync();
    // restore
    // @ts-ignore
    global.fetch = origFetch;
    // No assertions; absence of thrown errors indicates early return taken
  });

  it("sendToNtfy throws on network errors", async () => {
    // @ts-ignore
    global.fetch = mock(() => Promise.reject(new Error("boom")));
    const logger = new Logger("./tmp/test-log.md", "https://ntfy.throw/topic");
    await expect(
      // @ts-ignore private access
      (logger as any).sendToNtfy("msg")
    ).rejects.toThrow("Failed to send batched log to Ntfy");
  });
});
