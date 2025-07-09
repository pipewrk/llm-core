import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { Logger } from "../core/logger";
import fs from "fs/promises";

const TEMP_LOG_PATH = new URL("./temp_logs_io/test-log-io.md", import.meta.url).pathname;

describe("Logger File I/O", () => {
  test("writes correctly formatted entries to disk", async () => {
    const logger = new Logger(TEMP_LOG_PATH);

    logger.info("real file logging test");
    logger.warn("another entry", { details: "some details" });

    const contents = await fs.readFile(TEMP_LOG_PATH, "utf8");
    expect(contents).toMatch(/\[INFO\].*real file logging test/);
    expect(contents).toMatch(/\[WARN\].*another entry/);
    expect(contents).toContain(`"details": "some details"`);
  });
});