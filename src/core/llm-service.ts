import type { ILogger } from "src/types/dataset.ts";

/**
 * LLMService is a common interface for language model services.
 */

export abstract class LLMService {
  protected readonly logger: ILogger;

  constructor(ctx?: { logger?: ILogger } | ILogger) {
    this.logger = LLMService.resolveLogger(ctx);
  }

  private static resolveLogger(ctx?: { logger?: ILogger } | ILogger): ILogger {
    const noop: ILogger = {
      attn: () => {},
      impt: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    };

    if (!ctx) return noop;
    const maybe = (ctx as any).logger ? (ctx as any).logger : ctx;
    const has = (k: keyof ILogger) => typeof (maybe as any)?.[k] === "function";
    return has("info") && has("warn") && has("error") && has("attn") && has("impt")
      ? (maybe as ILogger)
      : noop;
  }
  /**
   * Generates a prompt by combining a system prompt and a user prompt,
   * sends the request to the underlying API, and returns the parsed JSON response.
   *
   * @param systemPrompt The system prompt.
   * @param userPrompt The user prompt.
   * @param format Additional formatting options.
   * @param customCheck An optional custom function to validate/process the response.
   * @returns A Promise that resolves with the parsed JSON response.
   */
  abstract generatePromptAndSend<T>(
    systemPrompt: string,
    userPrompt: string,
    format: Record<string, unknown>,
    customCheck?: (response: T) => T | boolean,
  ): Promise<T>;
}
