import { beforeEach, describe, expect, mock, test } from "bun:test";
import { OpenAIService } from "../openai-service";
import { MockLogger } from "./logger.mock";
import { getEnv, setEnv } from "../env";

describe("OpenAIService", () => {
  const logger = new MockLogger();
  const endpoint = "http://openai.test";
  const model = "test-model";

  beforeEach(() => {
    logger.clear();
  });

  test("should initialize correctly with environment variables", () => {
    setEnv("OPENAI_ENDPOINT", "http://env-endpoint.test");
    setEnv("OPENAI_API_KEY", "test-api")

    const service = new OpenAIService(model);

    expect(service).toBeInstanceOf(OpenAIService);
    expect(service["endpoint"]).toBe(getEnv("OPENAI_ENDPOINT"));
    expect(service["apiKey"]).toBe(getEnv("OPENAI_API_KEY"));
  });

  test("should sanitize JSON properly", () => {
    const sanitized = OpenAIService["sanitizeJson"](
      '```json\n{"key": "value",}\n```',
    );
    expect(sanitized).toBe('{"key": "value"}');
  });

  // test("should send a request and return parsed response", async () => {
  //   global.fetch = mock().mockResolvedValue({
  //     ok: true,
  //     json: mock().mockResolvedValue({
  //       choices: [{ message: { content: '{"response": "test"}' } }],
  //     }),
  //   } as unknown as Response);

  //   const service = new OpenAIService(model, endpoint);
  //   const options = { schema: { example: true }, schema_name: "test-schema" };

  //   const result = await service.generatePromptAndSend(
  //     "system-prompt",
  //     "user-prompt",
  //     options,
  //   );

  //   expect(global.fetch).toHaveBeenCalledWith(
  //     `${endpoint}/v1/chat/completions`,
  //     {
  //       method: "POST",
  //       headers: {
  //         "Content-Type": "application/json",
  //         Authorization: `Bearer test-api-key`, // Use the actual `apiKey` if present
  //       },
  //       body: JSON.stringify({
  //         model,
  //         messages: [
  //           { role: "system", content: "system-prompt" },
  //           { role: "user", content: "user-prompt" },
  //         ],
  //         stream: false,
  //         response_format: {
  //           type: "json_schema",
  //           json_schema: {
  //             name: "test-schema",
  //             strict: true,
  //             schema: { example: true },
  //           },
  //         },
  //       }),
  //     },
  //   );
  //   expect(result).toEqual({ response: "test" });
  //   expect(logger.logs.info).toContain(
  //     "Sending request to OpenAI (attempt 1/3)...",
  //   );
  // });

  // test("should retry on failure and eventually throw", async () => {
  //   global.fetch = mock().mockRejectedValue(new Error("Network error"));

  //   const service = new OpenAIService(model, endpoint);
  //   const options = { schema: { example: true } };

  //   await expect(
  //     service.generatePromptAndSend("system-prompt", "user-prompt", options),
  //   ).rejects.toThrowError(
  //     "Failed after 3 attempts to communicate with OpenAI.",
  //   );

  //   expect(global.fetch).toHaveBeenCalledTimes(3);
  //   expect(logger.logs.error.length).toBe(3);
  //   expect(logger.logs.error[0]).toContain("Attempt 1 failed: Network error");
  // });

  test("should validate response with a custom check", async () => {
    global.fetch = mock().mockResolvedValue({
      ok: true,
      json: mock().mockResolvedValue({
        choices: [{ message: { content: '{"key": "valid"}' } }],
      }),
    } as unknown as Response);

    const service = new OpenAIService(model, endpoint);

    const customCheck = (response: { key: string }) =>
      response.key === "valid" ? response : false;

    const result = await service.generatePromptAndSend(
      "system-prompt",
      "user-prompt",
      {},
      customCheck,
    );

    expect(result).toEqual({ key: "valid" });
  });

  test("should throw error if custom check fails", async () => {
    global.fetch = mock().mockResolvedValue({
      ok: true,
      json: mock().mockResolvedValue({
        choices: [{ message: { content: '{"key": "invalid"}' } }],
      }),
    } as unknown as Response);

    const service = new OpenAIService(model, endpoint);

    const customCheck = (response: { key: string }) =>
      response.key === "valid" ? response : false;

    await expect(
      service.generatePromptAndSend(
        "system-prompt",
        "user-prompt",
        {},
        customCheck,
      ),
    ).rejects.toThrowError(
      "Failed after 3 attempts to communicate with OpenAI.",
    );
  });
});
