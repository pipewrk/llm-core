import { beforeEach, describe, expect, mock, test } from "bun:test";
import { OpenAIService } from "../core/openai-service";
import { MockLogger } from "./logger.mock";
import { getEnv, setEnv } from "../core/env";

describe("OpenAIService", () => {
  const logger = new MockLogger();
  const endpoint = "http://openai.test";
  const model = "test-model";

  beforeEach(() => {
    logger.clear();
  });

  test("should initialize correctly with environment variables", () => {
    setEnv("OPENAI_ENDPOINT", "http://env-endpoint.test");
    setEnv("OPENAI_API_KEY", "test-api");

    const service = new OpenAIService(model);

    expect(service).toBeInstanceOf(OpenAIService);
    expect(service["endpoint"]).toBe(getEnv("OPENAI_ENDPOINT"));
    expect(service["apiKey"]).toBe(getEnv("OPENAI_API_KEY"));
  });

  test("should sanitize JSON properly", () => {
    const sanitized = OpenAIService["sanitizeJson"](
      '```json\n{"key": "value",}\n```'
    );
    expect(sanitized).toBe('{"key": "value"}');
  });

  test("should validate response with a custom check", async () => {
    global.fetch = Object.assign(
      mock().mockResolvedValue({
        ok: true,
        json: mock().mockResolvedValue({
          choices: [{ message: { content: '{"key": "valid"}' } }],
        }),
      }),
      {
        preconnect: () => {},
      }
    ) as typeof fetch;

    const service = new OpenAIService(model, endpoint);

    const customCheck = (response: { key: string }) =>
      response.key === "valid" ? response : false;

    const result = await service.generatePromptAndSend(
      "system-prompt",
      "user-prompt",
      {},
      customCheck
    );

    expect(result).toEqual({ key: "valid" });
  });

  test("should throw error if custom check fails", async () => {
    global.fetch = Object.assign(
      mock().mockResolvedValue({
        ok: true,
        json: mock().mockResolvedValue({
          choices: [{ message: { content: '{"key": "invalid"}' } }],
        }),
      }),
      {
        preconnect: () => {},
      }
    ) as typeof fetch;

    const service = new OpenAIService(model, endpoint);

    const customCheck = (response: { key: string }) =>
      response.key === "valid" ? response : false;

    await expect(
      service.generatePromptAndSend(
        "system-prompt",
        "user-prompt",
        {},
        customCheck
      )
    ).rejects.toThrowError(
      "Failed after 3 attempts to communicate with OpenAI."
    );
  });
});
