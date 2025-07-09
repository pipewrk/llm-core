import { beforeEach, afterEach, describe, expect, mock, test } from "bun:test";
import { getEnv, setEnv } from "../core/env.ts";
import { OllamaService } from "../core/ollama-service.ts";
import { MockLogger } from "./logger.mock.ts";

describe("OllamaService", () => {
  const logger = new MockLogger();
  const endpoint = "http://ollama.test";
  const model = "test-model";
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  beforeEach(() => {
    global.fetch = originalFetch;
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
    global.fetch = Object.assign(
      mock().mockResolvedValue({
        ok: true,
        text: mock().mockResolvedValue(
          JSON.stringify({
            message: { content: '{"key": "invalid"}' },
          })
        ),
      }),
      {
        preconnect: () => {}, // or mock() if you want to assert it
      }
    );

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
    global.fetch = Object.assign(
      mock().mockResolvedValue({
        ok: true,
        json: mock().mockResolvedValue({
          message: { content: '{"key": "valid"}' },
        }),
        text: mock().mockResolvedValue(
          JSON.stringify({
            message: { content: '{"key": "valid"}' },
          })
        ),
      }),
      {
        preconnect: () => {}, // stub to satisfy Bun's fetch shape
      }
    ) as typeof fetch;

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
    global.fetch = Object.assign(
      mock().mockResolvedValue({
        ok: true,
        json: mock().mockResolvedValue({
          message: { content: '{"key": "invalid"}' },
        }),
        text: mock().mockResolvedValue(
          JSON.stringify({
            message: { content: '{"key": "invalid"}' },
          })
        ),
      }),
      {
        preconnect: () => {}, // stub to satisfy Bun's fetch shape
      }
    ) as typeof fetch;

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

  test("embedTexts returns embeddings on success", async () => {
    const fakeEmbeddings = [
      [0.1, 0.2, 0.3],
      [0.1, 0.2, 0.3],
    ];

    // Define mock responses as raw JSON strings
    const mockJson = JSON.stringify({ embedding: [0.1, 0.2, 0.3] });

    // Create two mock Response objects
    const mockResponse1 = {
      ok: true,
      text: mock().mockResolvedValue(mockJson),
    };

    const mockResponse2 = {
      ok: true,
      text: mock().mockResolvedValue(mockJson),
    };

    // Global fetch mock to return these two responses in order
    global.fetch = Object.assign(
      mock()
        .mockResolvedValueOnce(mockResponse1)
        .mockResolvedValueOnce(mockResponse2),
      { preconnect: () => {} }
    ) as typeof fetch;

    const service = new OllamaService(model, endpoint);
    const result = await service.embedTexts(["hello", "world"]);

    expect(result).toEqual(fakeEmbeddings);
  });

  test("embedTexts retries on failure then succeeds", async () => {
    let callCount = 0;

    global.fetch = mock().mockImplementation(() => {
      callCount++;

      const payload = {
        ok: callCount >= 2,
        text: () =>
          Promise.resolve(
            callCount < 2 ? "error" : JSON.stringify({ embedding: [0.5] }) // Explicit correct structure
          ),
      };

      return Promise.resolve(payload);
    }) as unknown as typeof fetch;

    const service = new OllamaService(model, endpoint);
    const result = await service.embedTexts(["foo"]);
    expect(result).toEqual([[0.5]]);
    expect(callCount).toBe(2);
  });

  test("embedTexts retries up to max attempts before failing", async () => {
    const fetchMock = mock().mockResolvedValue({
      ok: false,
      text: mock().mockResolvedValue("err"),
    });

    global.fetch = Object.assign(fetchMock, {
      preconnect: () => {},
    }) as typeof fetch;

    const service = new OllamaService(model, endpoint);

    await expect(service.embedTexts(["test"])).rejects.toThrow(
      /Embedding failed/
    );

    // Expect 3 attempts
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
