import {
  describe,
  expect,
  test,
  beforeAll,
  afterAll,
} from "bun:test";
import { Logger } from "../core/logger";
import fs from "fs/promises";
import { existsSync, rmSync, mkdirSync } from "fs";
import winston from "winston";

const TEMP_LOG_DIR = ".src/tests/temp_logs_io";
const TEMP_LOG_PATH = `${TEMP_LOG_DIR}/test-log-io.md`;

// Helper to gracefully close the logger and its transports
const closeLogger = (logger: Logger): Promise<void> => {
  const winstonLogger = logger["logger"] as winston.Logger;
  return new Promise((resolve) => {
    winstonLogger.on("finish", () => {
      setTimeout(resolve, 10);
    });
    winstonLogger.end();
  });
};

describe("Logger File I/O", () => {
  beforeAll(() => {
    if (!existsSync(TEMP_LOG_DIR)) {
      mkdirSync(TEMP_LOG_DIR, { recursive: true });
    }
  });

  afterAll(() => {
    if (existsSync(TEMP_LOG_DIR)) {
      rmSync(TEMP_LOG_DIR, { recursive: true, force: true });
    }
  });

  test("should write a correctly formatted log entry to a real file", async () => {
    const logger = new Logger(TEMP_LOG_PATH);
    logger.info("real file logging test");
    logger.warn("another entry", { details: "some details" });

    await closeLogger(logger);

    const contents = await fs.readFile(TEMP_LOG_PATH, "utf8");
    expect(contents).toMatch(/\[INFO\].*real file logging test/);
    expect(contents).toMatch(/\[WARN\].*another entry/);
    expect(contents).toContain(`"details": "some details"`);
  });
});
