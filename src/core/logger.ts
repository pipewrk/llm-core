// File: src/logger.ts
import winston from "winston";
import { uFetch } from "./ufetch.ts";
import chalk, { type ChalkInstance } from "chalk";
import { dirname } from "path";
import { ensureDirectory } from "./file-utils.ts";
import type { ILogger } from "../types/dataset.ts";

/**
 * Acceptable color strings for your custom log levels.
 */
type ChalkColor = "red" | "blue" | "green" | "cyan" | "yellow" | "white";

/**
 * Create a typed map of chalk color functions.
 */
const chalkMethods: Record<ChalkColor, ChalkInstance> = {
  red: chalk.red,
  blue: chalk.blue,
  green: chalk.green,
  cyan: chalk.cyan,
  yellow: chalk.yellow,
  white: chalk.white,
};

/**
 * Logger class with multiple transports: console, Markdown file, and Ntfy server.
 * Implements batching for Ntfy messages to prevent rate limiting.
 */
export class Logger implements ILogger {
  private logger: winston.Logger;
  private ntfyServerUrl?: string;

  // Batching related properties
  private messageQueue: string[] = [];
  private readonly batchSize: number = 10; // Maximum messages per batch
  private readonly batchInterval: number = 5000; // Time in ms to wait before sending batch
  private batchTimer?: ReturnType<typeof setInterval>;

  /**
   * Constructs a Logger instance with multiple transports and custom log levels.
   *
   * @param logFilePath - The path to the Markdown file for logging output.
   * @param ntfyServerUrl - Optional URL for the Ntfy server to send batched notifications.
   *
   * Initializes the logger with both a file transport and a console transport,
   * each supporting custom log levels and colors. If a Ntfy server URL is provided,
   * enables batching for log messages to the server and sets up handlers for
   * flushing any remaining messages on process exit.
   */

  constructor(logFilePath: string, ntfyServerUrl?: string) {
    this.ntfyServerUrl = ntfyServerUrl;
    const logDir = dirname(logFilePath);
    // Reuse shared directory creation logic
    ensureDirectory(logDir, {
      impt: () => {},
      attn: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    });

    // Define custom log levels and colors
    const logLevels = {
      levels: {
        error: 0,
        warn: 1,
        info: 2,
        impt: 3,
        attn: 4,
      },
      colors: {
        error: "red",
        warn: "yellow",
        info: "green",
        impt: "blue",
        attn: "cyan",
      } as Record<string, ChalkColor>,
    };

    // Add custom colors to winston
    winston.addColors(logLevels.colors);

    // Markdown file transport
    const markdownTransport = new winston.transports.File({
      filename: logFilePath,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(
          ({
            level,
            message,
            timestamp,
          }: winston.Logform.TransformableInfo) => {
            const formattedMessage = this.formatForPlainTransport(message);
            return `${timestamp} **[${level.toUpperCase()}]** ${formattedMessage}`;
          }
        )
      ),
    });

    // Console transport with chalk coloration
    const consoleTransport = new winston.transports.Console({
      format: winston.format.printf(
        ({ level, message }: winston.Logform.TransformableInfo) => {
          // Retrieve the chalk color function
          const colorKey = logLevels.colors[level] || "white";
          const colourFn = chalkMethods[colorKey] || chalk.white;

          // Strip out any ANSI codes
          const plainMessage = this.stripConsoleFormatting(
            typeof message === "string"
              ? message
              : JSON.stringify(message, null, 2)
          );
          return `${colourFn(`[${level.toUpperCase()}]`)} ${plainMessage}`;
        }
      ),
    });

    this.logger = winston.createLogger({
      levels: logLevels.levels,
      transports: [markdownTransport, consoleTransport],
    });
  }

  attn(...args: unknown[]): void {
    this.log("attn", ...args);
  }

  impt(...args: unknown[]): void {
    this.log("impt", ...args);
  }

  info(...args: unknown[]): void {
    this.log("info", ...args);
  }

  warn(...args: unknown[]): void {
    this.log("warn", ...args);
  }

  error(...args: unknown[]): void {
    this.log("error", ...args);
  }

  /**
   * Internal log method that forwards messages to both winston and Ntfy.
   * @param level - The log level of the message.
   * @param args - The log message arguments.
   *
   * Converts the message to a string, logs it to winston, and if Ntfy is enabled,
   * adds the message to the queue for sending to the Ntfy server.
   */
  private log(level: string, ...args: unknown[]): void {
    const message = this.stringifyMessage(args);
    this.logger.log({ level, message });

    if (this.ntfyServerUrl) {
      this.enqueueMessage(level, message);
    }
  }

  /**
   * Adds a log message to the queue, which is sent to Ntfy periodically or when the batch size is reached.
   *
   * If the queue length reaches the batch size, the queue is flushed immediately.
   * @param level - The log level of the message.
   * @param message - The message to enqueue.
   */
  private enqueueMessage(_: string, message: string): void {
    const formattedMessage = `${message}`;
    this.messageQueue.push(formattedMessage);

    if (this.messageQueue.length >= this.batchSize) {
      this.flushQueue();
    }
  }

  /**
   * Starts a timer that sends the current batch of messages to Ntfy periodically.
   *
   * The timer is initialized when the Ntfy server URL is provided during
   * construction. The timer is stopped when the logger is shut down.
   *
   * @see {@link flushQueueSync} for immediate sending of all messages.
   */
  private startBatchTimer(customInterval?: number): void {
    const interval = customInterval ?? this.batchInterval;
    this.batchTimer = setInterval(() => {
      if (this.messageQueue.length > 0) {
        this.flushQueue();
      }
    }, interval);
  }
  /**
   * Sends the current batch of messages to Ntfy.
   *
   * If sending fails, logs the error without causing recursion.
   *
   * @returns A Promise that resolves when the batch is sent or an error occurs.
   */
  private async flushQueue(): Promise<void> {
    if (this.messageQueue.length === 0 || !this.ntfyServerUrl) {
      return;
    }

    // Concatenate messages with line breaks
    const batchedMessage = this.messageQueue.join("\n");
    this.messageQueue = []; // Clear the queue

    try {
      await this.sendToNtfy(batchedMessage);
    } catch (err) {
      // Log the error without causing recursion
      this.logger.error(
        `Failed to send batched logs to Ntfy: ${(err as Error).message}`
      );
    }
  }

  /**
   * Synchronous version of flushQueue.
   * Intended to be called on process exit to ensure that any remaining messages
   * are sent to Ntfy. This method does not return a promise.
   */
  private async flushQueueSync(): Promise<void> {
    if (this.messageQueue.length === 0 || !this.ntfyServerUrl) {
      return;
    }

    // Concatenate messages with line breaks
    const batchedMessage = this.messageQueue.join("\n");
    this.messageQueue = []; // Clear the queue

    // Synchronous fetch using require
    try {
      const res = await uFetch<Response>(this.ntfyServerUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: batchedMessage,
        returnRaw: true,
      }) as Response;
      if (!res.ok) this.logger.error(`HTTP Error when sending batched logs to Ntfy: ${res.statusText}`);
    } catch (err) {
      this.logger.error(
        `Failed to send batched logs to Ntfy: ${(err as Error).message}`
      );
    }
  }

  /**
   * Removes ANSI escape codes used for console formatting from a given string.
   * This is useful for ensuring that log messages are stored or displayed
   * without any console-specific formatting artifacts.
   *
   * @param message - The message string potentially containing ANSI escape codes.
   * @returns The message string with all ANSI escape codes stripped.
   */

  private stripConsoleFormatting(message: string): string {
    return message.replace(
      // deno-lint-ignore no-control-regex
      /[\u001b\u009b][[()#;?]*(?:(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><])*[m]/g,
      ""
    );
  }

  /**
   * Converts a message to a plain string format suitable for the plain transport.
   * If the message is a string, any console formatting is stripped.
   * If the message is not a string, it is converted to a JSON string with indentation.
   * @param message The message to convert to a plain string.
   * @returns A plain string representing the message.
   */
  private formatForPlainTransport(message: unknown): string {
    return typeof message === "string"
      ? this.stripConsoleFormatting(message)
      : JSON.stringify(message, null, 2);
  }

  /**
   * Converts an array of arguments into a string.
   * String arguments are concatenated directly, while non-string arguments
   * are converted to JSON strings with indentation.
   *
   * @param args - An array of arguments to be stringified.
   * @returns A single string representing all the arguments concatenated together.
   */

  private stringifyMessage(args: unknown[]): string {
    return args
      .map((arg) =>
        typeof arg === "string" ? arg : JSON.stringify(arg, null, 2)
      )
      .join(" ");
  }

  /**
   * Sends a batched log message to the Ntfy server.
   * @param message The batched log message to send.
   * @throws An Error if the request to Ntfy fails or returns an HTTP error.
   */
  private async sendToNtfy(message: string): Promise<void> {
    try {
      const res = await uFetch<Response>(this.ntfyServerUrl!, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: message,
        returnRaw: true,
      }) as Response;
      if (!res.ok) throw new Error(`HTTP Error: ${res.statusText}`);
    } catch (err) {
      throw new Error(
        `Failed to send batched log to Ntfy: ${(err as Error).message}`
      );
    }
  }
}
