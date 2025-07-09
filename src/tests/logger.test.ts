import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { Logger } from "../core/logger";
import { MockLogger } from "./logger.mock.ts";

// Mock the entire winston module to prevent any file I/O and related race conditions
const mockWinstonLogger = {
  log: mock(() => {}),
  on: mock(() => {}),
  end: mock(() => {}),
  error: mock(() => {}),
};

// Correctly mock the winston module
mock.module("winston", () => ({
  __esModule: true, // Handle ES modules
  default: {
    createLogger: () => mockWinstonLogger,
    transports: {
      File: class {},
      Console: class {},
    },
    format: {
      combine: mock(() => ({})),
      timestamp: mock(() => ({})),
      printf: mock(() => ({})),
    },
    addColors: mock(() => {}),
  },
}));

describe("Logger Logic", () => {
  let logger: Logger;

  beforeEach(() => {
    mockWinstonLogger.log.mockClear();
    mockWinstonLogger.error.mockClear();
    mock.restore();
    logger = new Logger("./dummy.log");
  });

  afterEach(() => {
    if (logger["batchTimer"]) {
      clearInterval(logger["batchTimer"]);
    }
  });

  test("should forward log messages to winston", () => {
    logger.info("info message");
    expect(mockWinstonLogger.log).toHaveBeenCalledTimes(1);
    expect(mockWinstonLogger.log).toHaveBeenCalledWith({
      level: "info",
      message: "info message",
    });
  });

  test("should stringify non-string arguments", () => {
    const obj = { a: 1 };
    logger.warn("Warning:", obj);
    expect(mockWinstonLogger.log).toHaveBeenCalledWith({
      level: "warn",
      message: `Warning: ${JSON.stringify(obj, null, 2)}`,
    });
  });

  describe("Ntfy Integration", () => {
    test("should send a batch when size limit is reached", () => {
      global.fetch = (() => {
        const fn = mock().mockImplementation(() =>
          Promise.resolve({ ok: true })
        );
        (fn as any).preconnect = () => {}; // Add preconnect if TS complains
        return fn;
      })() as unknown as typeof fetch;

      const ntfyLogger = new Logger("./dummy.log", "https://ntfy.sh/test");
      (ntfyLogger as any).batchSize = 2;

      ntfyLogger.info("message 1");
      ntfyLogger.info("message 2");

      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test("should log an internal error if fetch fails", async () => {
      let callCount = 0;

      global.fetch = (() => {
        const fn = mock().mockImplementation(() =>
          Promise.reject(new Error("Network Failure"))
        );
        // Add missing properties if needed
        (fn as any).preconnect = () => {}; // Optional: stub for compatibility
        return fn;
      })() as unknown as typeof fetch;

      const ntfyLogger = new Logger("./dummy.log", "https://ntfy.sh/test");

      ntfyLogger.error("This will fail");
      await (ntfyLogger as any).flushQueue();

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(mockWinstonLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to send batched logs to Ntfy")
      );
    });
    test("flushQueueSync logs error if fetch throws", async () => {
      global.fetch = (() => {
        const fn = mock().mockImplementation(() =>
          Promise.reject(new Error("Mock sync fetch error"))
        );
        (fn as any).preconnect = () => {};
        return fn;
      })() as unknown as typeof fetch;

      const ntfyLogger = new Logger("./dummy.log", "https://ntfy.sh/test");
      (ntfyLogger as any).messageQueue = ["msg 1", "msg 2"];

      await (ntfyLogger as any).flushQueueSync();

      expect(mockWinstonLogger.error).toHaveBeenCalledWith(
        expect.stringContaining(
          "Failed to send batched logs to Ntfy: Mock sync fetch error"
        )
      );
    });

    test("flushQueueSync logs error if response.ok is false", async () => {
      global.fetch = (() => {
        const fn = mock().mockImplementation(() =>
          Promise.resolve({
            ok: false,
            statusText: "418 I'm a teapot",
          })
        );
        (fn as any).preconnect = () => {};
        return fn;
      })() as unknown as typeof fetch;

      const ntfyLogger = new Logger("./dummy.log", "https://ntfy.sh/test");
      (ntfyLogger as any).messageQueue = ["msg 1", "msg 2"];

      await (ntfyLogger as any).flushQueueSync();

      expect(mockWinstonLogger.error).toHaveBeenCalledWith(
        expect.stringContaining(
          "HTTP Error when sending batched logs to Ntfy: 418 I'm a teapot"
        )
      );
    });
    test("should log attn level messages", () => {
      logger.attn("urgent note");
      expect(mockWinstonLogger.log).toHaveBeenCalledWith({
        level: "attn",
        message: "urgent note",
      });
    });

    test("should log impt level messages", () => {
      logger.impt("important update");
      expect(mockWinstonLogger.log).toHaveBeenCalledWith({
        level: "impt",
        message: "important update",
      });
    });
  });
  test("startBatchTimer triggers flushQueue periodically", async () => {
    const ntfyLogger = new Logger("./dummy.log", "https://ntfy.sh/test");

    ntfyLogger["messageQueue"] = ["queued"];
    ntfyLogger["flushQueue"] = mock(() => Promise.resolve());

    (ntfyLogger as any).startBatchTimer(10); // use short interval for test

    await new Promise((r) => setTimeout(r, 30)); // give timer time to tick

    expect(ntfyLogger["flushQueue"]).toHaveBeenCalled();

    clearInterval(ntfyLogger["batchTimer"]); // clean up timer
  });
});

describe("MockLogger", () => {
  let logger: MockLogger;

  beforeEach(() => {
    logger = new MockLogger();
  });

  test("captures all log levels", () => {
    logger.attn("attention");
    logger.impt("important");
    logger.info("some info");
    logger.warn("a warning");
    logger.error("an error");

    expect(logger.logs.attn[0]).toBe("attention");
    expect(logger.logs.impt[0]).toBe("important");
    expect(logger.logs.info[0]).toBe("some info");
    expect(logger.logs.warn[0]).toBe("a warning");
    expect(logger.logs.error[0]).toBe("an error");
  });

  test("stringifies non-string log arguments", () => {
    logger.info("hello", { x: 1 }, [2, 3]);

    expect(logger.logs.info[0]).toBe(
      `hello ${JSON.stringify({ x: 1 }, null, 2)} ${JSON.stringify(
        [2, 3],
        null,
        2
      )}`
    );
  });

  test("clear() resets all log buffers", () => {
    logger.warn("to be cleared");
    logger.clear();
    expect(logger.logs.warn).toEqual([]);
  });
  test("formatArgs stringifies non-string values", () => {
    const logger = new MockLogger();
    logger.clear();

    const obj = { foo: "bar" };
    const arr = [1, 2];
    const mix = "message";

    logger.info(mix, obj, arr);

    expect(logger.logs.info[0]).toContain(JSON.stringify(obj, null, 2));
    expect(logger.logs.info[0]).toContain(JSON.stringify(arr, null, 2));
  });
});
