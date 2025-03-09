import { LLMService } from "./llm-service.ts";
import { withLogger } from "./decorators.ts";
import { getEnv } from "./env.ts";

@withLogger
export class OllamaService extends LLMService {
  private endpoint: string;
  private model: string;
  private apiKey?: string;

  /**
   * Constructor for the OllamOaService class.
   * @param model The model identifier to use for requests to Ollama.
   * @param endpoint The endpoint URL to use for requests to Ollama.
   *                 Defaults to the value of the OLLAMA_ENDPOINT environment variable.
   * @param apiKey Optional API key for Ollama. Defaults to the value of the OLLAMA_API_KEY environment variable.
   */
  constructor(
    model: string,
    endpoint = getEnv("OLLAMA_ENDPOINT"),
    apiKey = "",
  ) {
    super();
    this.endpoint = endpoint;
    this.model = model;
    this.apiKey = apiKey;
  }

  /**
   * Sends a request to Ollama with the given messages and options.
   *
   * Any structured output settings (such as a schema) passed in the options are sent as-is,
   * and Ollama will ignore the `schema_name` property.
   *
   * @param messages A list of messages to send to Ollama, each with a role and content.
   * @param options A Record with additional options for the request.
   *                Optionally includes a `schema` property.
   * @param customCheck An optional function to validate/process the parsed response.
   * @returns A Promise that resolves to the JSON response from Ollama, cast to the given type parameter.
   * @throws An Error if the request fails after the maximum number of retries.
   */
  private async sendRequest<T>(
    messages: { role: string; content: string }[],
    options: Record<string, unknown>,
    customCheck?: (response: T) => T | boolean,
  ): Promise<T> {
    const { schema } = options;
    const payload = {
      model: this.model,
      messages,
      stream: false,
      format: schema,
    };

    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        this.logger.info(
          `Sending request to Ollama (attempt ${
            attempt + 1
          }/${MAX_RETRIES})...`,
        );

        const response = await fetch(`${this.endpoint}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        // this.logger.info(`HTTP ${response.status} received from Ollama`);
        // Read the response as text so we can log it and then parse it manually.
        const responseText = await response.text();
        // this.logger.info(`Raw response text: ${responseText}`);

        // If the response status is not OK, log and throw.
        if (!response.ok) {
          this.logger.error(`Ollama API error: ${responseText}`);
          throw new Error(`HTTP error: ${response.status}`);
        }

        // Parse the response JSON from the raw text.
        let responseJson: { message?: { content: string } };
        try {
          responseJson = JSON.parse(responseText);
        } catch (jsonErr) {
          this.logger.error(
            `Error parsing responseText: ${(jsonErr as Error).message}`,
          );
          throw jsonErr;
        }

        const rawContent = responseJson?.message?.content;
        if (!rawContent) {
          this.logger.error(
            "Ollama API returned an unexpected structure (no content).",
          );
          throw new Error(
            "Ollama API returned an unexpected structure (no content).",
          );
        }

        // Sanitize and parse the JSON content.
        let parsedResponse: T;
        try {
          const sanitized = OllamaService.sanitizeJson(rawContent);
          parsedResponse = JSON.parse(sanitized) as T;
        } catch (parseErr) {
          this.logger.error(
            `Error parsing sanitized JSON: ${(parseErr as Error).message}`,
          );
          // Fallback: try a double-parse if the content is double-encoded.
          try {
            const sanitized = OllamaService.sanitizeJson(rawContent);
            this.logger.info(
              `Attempting double JSON.parse on sanitized response: ${sanitized}`,
            );
            parsedResponse = JSON.parse(JSON.parse(sanitized)) as T;
          } catch (doubleParseErr) {
            this.logger.error(
              `Double JSON.parse error: ${(doubleParseErr as Error).message}`,
            );
            throw doubleParseErr;
          }
        }

        // Apply the custom check, if provided.
        if (customCheck) {
          const checkResult = customCheck(parsedResponse);
          this.logger.info(
            `Custom check result: ${JSON.stringify(checkResult)}`,
          );
          if (checkResult === false) {
            this.logger.error("Response failed custom check");
            throw new Error("Response failed custom check");
          }
          this.logger.info("Custom check passed, returning");
          return checkResult as T;
        }

        this.logger.info("Returning parsed response");
        return parsedResponse;
      } catch (err) {
        this.logger.error(
          `Attempt ${attempt + 1} failed: ${(err as Error).message}`,
        );
        if (attempt === MAX_RETRIES - 1) {
          throw new Error(
            `Failed after ${MAX_RETRIES} attempts to communicate with Ollama.`,
          );
        }
        // Wait 1 second before retrying.
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    throw new Error("Unexpected error in OllamaService.sendRequest");
  }

  /**
   * Sends a single request to Ollama with the given system prompt and user prompt.
   *
   * @param systemPrompt The system prompt to send to Ollama.
   * @param userPrompt The user prompt to send to Ollama.
   * @param options Additional options for formatting the request.
   *                Optionally includes a `schema` (which Ollama will ignore).
   * @param customCheck Optional function to validate/process the response.
   * @returns A Promise that resolves to the JSON response from Ollama, cast to the given type parameter.
   */
  public generatePromptAndSend<T>(
    systemPrompt: string,
    userPrompt: string,
    options: Record<string, unknown>,
    customCheck?: (response: T) => T | boolean,
  ): Promise<T> {
    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];
    return this.sendRequest<T>(messages, options, customCheck);
  }

  /**
   * Sanitizes a JSON string by performing several clean-up operations:
   * - Removes Markdown-style code block delimiters if present.
   * - Eliminates trailing commas and excess whitespace.
   *
   * @param jsonStr The JSON string to sanitize.
   * @returns A sanitized JSON string.
   */
  private static sanitizeJson(jsonStr: string): string {
    let json = jsonStr;

    // Strip Markdown code blocks.
    if (json.startsWith("```json")) {
      json = json.slice(7);
      if (json.endsWith("```")) {
        json = json.slice(0, -3).trim();
      }
    }

    // Append a closing brace if missing.
    if (!json.trimEnd().endsWith("}")) {
      json += "}";
    }

    // Remove trailing commas and extra whitespace/newlines.
    json = json.replace(/,(\s*[\]}])/g, "$1").replace(/\s*\n\s*/g, " ");

    return json;
  }
}
