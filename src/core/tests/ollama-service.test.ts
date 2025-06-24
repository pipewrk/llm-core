import { beforeEach, describe, expect, mock, test } from "bun:test";
import { getEnv, setEnv } from "../env.ts";
import { OllamaService } from "../ollama-service.ts";
import { MockLogger } from "./logger.mock.ts";

describe("OllamaService", () => {
  const logger = new MockLogger();
  const endpoint = "http://ollama.test";
  const model = "test-model";
  
  beforeEach(() => {
    logger.clear();
  });
  
  test("should initialize correctly with environment variables", () => {
    setEnv("OLLAMA_ENDPOINT", "http://env-endpoint.test");
    setEnv("OLLAMA_API_KEY", "test-api");

    const service = new OllamaService(model);

    expect(service).toBeInstanceOf(OllamaService);
    expect(service["endpoint"]).toBe(getEnv("OLLAMA_ENDPOINT"));
    expect(service["apiKey"]).toBe(getEnv("OLLAMA_API_KEY"));
  });

  test("should sanitize JSON properly", () => {
    const sanitized = OllamaService["sanitizeJson"](
      '```json\n{"key": "value",}\n```'
    );
    expect(sanitized).toBe('{"key": "value"}');
  });

  test("should throw error if custom check fails", async () => {
    global.fetch = mock().mockResolvedValue({
      ok: true,
      text: mock().mockResolvedValue(
        JSON.stringify({
          message: { content: '{"key": "invalid"}' },
        })
      ),
    } as unknown as Response);

    const service = new OllamaService(model, endpoint);

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
      "Failed after 3 attempts to communicate with Ollama."
    );
  });

  test("should validate response with a custom check", async () => {
    global.fetch = mock().mockResolvedValue({
      ok: true,
      json: mock().mockResolvedValue({
        message: { content: '{"key": "valid"}' },
      }),
      text: mock().mockResolvedValue(
        JSON.stringify({
          message: { content: '{"key": "valid"}' },
        })
      ),      
    } as unknown as Response);

    const service = new OllamaService(model, endpoint);

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
    global.fetch = mock().mockResolvedValue({
      ok: true,
      json: mock().mockResolvedValue({
        message: { content: '{"key": "invalid"}' },
      }),
      text: mock().mockResolvedValue(
        JSON.stringify({
          message: { content: '{"key": "invalid"}' },
        })
      ),      
    } as unknown as Response);

    const service = new OllamaService(model, endpoint);

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
      "Failed after 3 attempts to communicate with Ollama."
    );
  });
});
