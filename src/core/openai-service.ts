import { LLMService } from "./llm-service.ts";
import { getEnv } from "./env.ts";
import type { ILogger } from "src/types/dataset.ts";

export class OpenAIService extends LLMService {
  private endpoint: string;
  private model: string;
  private apiKey: string;

  /**
   * Constructor for the OpenAIService class.
   *
   * @param model The model identifier for OpenAI.
   * @param endpoint The endpoint URL for OpenAI requests.
   *                 Defaults to the value of the OPENAI_ENDPOINT environment variable.
   * @param apiKey The OpenAI API key. Defaults to the value of the OPENAI_API_KEY environment variable.
   */
  constructor(
    model: string,
    endpoint = getEnv("OPENAI_ENDPOINT"),
    apiKey = getEnv("OPENAI_API_KEY"),
    ctx?: { logger?: ILogger } | ILogger,
  ) {
    super(ctx);
    this.endpoint = endpoint;
    this.model = model;
    this.apiKey = apiKey;
  }

  /**
   * Sends a request to OpenAI with the given messages and options.
   *
   * If the options object includes a `schema` property, it is wrapped in the required
   * OpenAI `response_format` structure. The optional `schema_name` is used if provided;
   * otherwise a generic name is used.
   *
   * @param messages An array of messages, each containing a role and content.
   * @param options A Record with additional options for the request formatting.
   *                Optionally includes:
   *                - schema: a JSON schema defining the expected response.
   *                - schema_name: (optional) a name for the schema.
   *                Other options are merged into the payload as-is.
   * @param customCheck An optional function to validate/process the parsed response.
   * @returns A Promise that resolves to the JSON response from OpenAI, cast to the given type parameter.
   * @throws An Error if the request fails after the maximum number of retries.
   */
  private async sendRequest<T>(
    messages: { role: string; content: string }[],
    options: Record<string, unknown>,
    customCheck?: (response: T) => T | boolean,
  ): Promise<T> {
    let payloadOptions: Record<string, unknown> = {};
    if (options.schema) {
      payloadOptions.response_format = {
        type: "json_schema",
        json_schema: {
          name: typeof options.schema_name === "string"
            ? options.schema_name
            : "response_schema",
          strict: true,
          schema: options.schema,
        },
      };
      // Merge any additional options (excluding the schema properties).
      const { _schema, _schema_name, ...rest } = options;
      payloadOptions = { ...payloadOptions, ...rest };
    } else {
      payloadOptions = { ...options };
    }

    const payload = {
      model: this.model,
      messages,
      stream: false,
      ...payloadOptions,
    };

    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        this.logger.info(
          `Sending request to OpenAI (attempt ${
            attempt + 1
          }/${MAX_RETRIES})...`,
        );

        const response = await fetch(`${this.endpoint}/v1/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errorText = await response.text();
          this.logger.error(`OpenAI API error: ${errorText}`);
          throw new Error(`HTTP error: ${response.status}`);
        }

        const responseJson = (await response.json()) as {
          choices?: { message?: { content: string } }[];
        };

        // OpenAI API returns choices, so take the first one.
        const rawContent = responseJson?.choices?.[0]?.message?.content;
        if (!rawContent) {
          throw new Error(
            "OpenAI API returned an unexpected structure (no content).",
          );
        }

        const sanitized = OpenAIService.sanitizeJson(rawContent);
        const parsedResponse = JSON.parse(sanitized) as T;

        // Apply the custom check, if provided.
        if (customCheck) {
          const check = customCheck(parsedResponse);
          if (!check) {
            throw new Error("Response failed custom check");
          }
          return check as T;
        }

        return parsedResponse;
      } catch (err) {
        this.logger.error(
          `Attempt ${attempt + 1} failed: ${(err as Error).message}`,
        );
        if (attempt === MAX_RETRIES - 1) {
          throw new Error(
            `Failed after ${MAX_RETRIES} attempts to communicate with OpenAI.`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    throw new Error("Unexpected error in OpenAIService.sendRequest");
  }

  /**
   * Generates a prompt from a system prompt and a user prompt,
   * sends the message to OpenAI, and returns the parsed JSON response.
   *
   * @param systemPrompt The system prompt to send.
   * @param userPrompt The user prompt to send.
   * @param options Additional options for the request formatting.
   *                Optionally includes the `schema` and `schema_name` properties.
   * @param customCheck Optional function to validate/process the response.
   * @returns A Promise that resolves with the parsed JSON response.
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
   * Sanitizes a JSON string by performing cleanup operations:
   * - Removes Markdown-style code block delimiters if present.
   * - Eliminates trailing commas and excess whitespace.
   *
   * @param jsonStr The JSON string to sanitize.
   * @returns A sanitized JSON string.
   */
  private static sanitizeJson(jsonStr: string): string {
    let json = jsonStr;

    // Remove Markdown code blocks if present.
    if (json.startsWith("```json")) {
      json = json.slice(7);
      if (json.endsWith("```")) {
        json = json.slice(0, -3).trim();
      }
    }

    // Append a closing brace if one is missing.
    if (!json.trimEnd().endsWith("}")) {
      json += "}";
    }

    // Remove trailing commas and extra whitespace/newlines.
    json = json.replace(/,(\s*[\]}])/g, "$1").replace(/\s*\n\s*/g, " ");

    return json;
  }
}
