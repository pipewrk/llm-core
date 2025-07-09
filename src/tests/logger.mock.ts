// File: ./tests/logger.mock.ts

import type { ILogger } from "../types/dataset";

/**
 * MockLogger is a mock implementation of the Logger class.
 * It captures log messages for each log level, allowing assertions in tests.
 */
export class MockLogger implements ILogger {
  // Captured log messages categorized by log level
  logs: Record<string, string[]> = {
    attn: [],
    impt: [],
    info: [],
    warn: [],
    error: [],
  };

  constructor() {
    this.logs = {
      attn: [],
      impt: [],
      info: [],
      warn: [],
      error: [],
    };
  }

  /**
   * Clears all captured log messages.
   */
  clear(): void {
    for (const level in this.logs) {
      this.logs[level] = [];
    }
  }

  /**
   * Logs a message at the 'attn' level.
   * @param args - The messages or objects to log.
   */
  attn(...args: unknown[]): void {
    this.logs.attn.push(this.formatArgs(args));
  }

  /**
   * Logs a message at the 'impt' level.
   * @param args - The messages or objects to log.
   */
  impt(...args: unknown[]): void {
    this.logs.impt.push(this.formatArgs(args));
  }

  /**
   * Logs a message at the 'info' level.
   * @param args - The messages or objects to log.
   */
  info(...args: unknown[]): void {
    this.logs.info.push(this.formatArgs(args));
  }

  /**
   * Logs a message at the 'warn' level.
   * @param args - The messages or objects to log.
   */
  warn(...args: unknown[]): void {
    this.logs.warn.push(this.formatArgs(args));
  }

  /**
   * Logs a message at the 'error' level.
   * @param args - The messages or objects to log.
   */
  error(...args: unknown[]): void {
    this.logs.error.push(this.formatArgs(args));
  }

  /**
   * Formats the log arguments into a single string.
   * Non-string arguments are stringified using JSON.stringify.
   * @param args - The log arguments.
   * @returns The formatted log message.
   */
  private formatArgs(args: unknown[]): string {
    return args
      .map((arg) =>
        typeof arg === "string" ? arg : JSON.stringify(arg, null, 2)
      )
      .join(" ");
  }
}
