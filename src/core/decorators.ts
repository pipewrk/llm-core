import { getEnv } from "./env.ts";
import { Logger } from "./logger.ts";

const loggerSingleton = new Logger(
  `${getEnv("LOG_PATH")}/app.md`,
  `${getEnv("NTFY_ENDPOINT")}/question-generator`,
);

// deno-lint-ignore no-explicit-any
export function withLogger<T extends abstract new (...args: any[]) => any>(
  BaseClass: T,
): T {
  abstract class Decorated extends BaseClass {
    protected readonly logger = loggerSingleton; // Inject the logger

    // deno-lint-ignore no-explicit-any
    constructor(...args: any[]) {
      super(...args); // Call the parent class constructor
    }
  }
  return Decorated;
}
