import { withLogger } from "./decorators.ts";
import type { ILogger } from "../types/dataset.ts";

/**
 * LLMService is a common interface for language model services.
 */

@withLogger
export abstract class LLMService {
  protected readonly logger!: ILogger;
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
