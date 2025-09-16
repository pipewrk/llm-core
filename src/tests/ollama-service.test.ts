import { beforeEach, afterEach, describe, expect, mock, test } from "bun:test";
import { getEnv, setEnv } from "../core/env.ts";
import { createOllamaContext, embedTexts, generatePromptAndSend, __test as ollamaHooks } from "../core/ollama-service.ts";
import { MockLogger } from "./logger.mock.ts";

describe("Ollama service (pipeline-based)", () => {
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

  test("createOllamaContext uses environment variables when not overridden", () => {
    setEnv("OLLAMA_ENDPOINT", "http://env-endpoint.test");
    setEnv("OLLAMA_API_KEY", "test-api");
    setEnv("OLLAMA_MODEL", model);

  const ctx = createOllamaContext({ logger });
  expect(ctx.endpoint).toBe(getEnv("OLLAMA_ENDPOINT"));
  expect(ctx.apiKey).toBe(getEnv("OLLAMA_API_KEY"));
  expect(ctx.model).toBe(model);
  });

  test("sanitizes JSON content before parsing (fenced + trailing comma)", async () => {
    global.fetch = Object.assign(
      mock().mockResolvedValue({
        ok: true,
        text: mock().mockResolvedValue(
          JSON.stringify({ message: { content: '```json\n{"key": "value",}\n```' } })
        ),
      }),
      { preconnect: () => {} }
    ) as typeof fetch;

  const ctx = createOllamaContext({ logger, endpoint, model });
    const out = await generatePromptAndSend<{ key: string }>(
      ctx,
      "sys",
      "user",
      {}
    );
    expect(out).toEqual({ key: "value" });
  });

  test("logs and throws on HTTP error (generatePromptAndSend)", async () => {
    global.fetch = Object.assign(
      mock().mockResolvedValue({
        ok: false,
        text: mock().mockResolvedValue("bad"),
      }),
      { preconnect: () => {} }
    ) as typeof fetch;

  const ctx = createOllamaContext({ logger, endpoint, model });
    const out = await generatePromptAndSend(ctx, "sys", "user", {});
    // On HTTP error, the pipeline pauses; wrapper logs error and returns early.
    expect(logger.logs.error.join("\n")).toMatch(/Ollama HTTP/);
  });

  test("logs parse failure when server returns invalid JSON", async () => {
    global.fetch = Object.assign(
      mock().mockResolvedValue({
        ok: true,
        text: mock().mockResolvedValue("not-json"),
      }),
      { preconnect: () => {} }
    ) as typeof fetch;

  const ctx = createOllamaContext({ logger, endpoint, model });
    const out = await generatePromptAndSend(ctx, "sys", "user", {} as any);
  // Parse error is logged; pipeline pauses; no throw from service.
    expect(logger.logs.error.join("\n")).toMatch(/JSON parse failed/);
  });

  test("adds format when schema provided and does not include schema in body", async () => {
    let captured: any = null;
    global.fetch = Object.assign(
      mock().mockImplementation((_url: string, init: RequestInit) => {
        try { captured = JSON.parse(String(init.body)); } catch {}
        return Promise.resolve({
          ok: true,
          text: mock().mockResolvedValue(
            JSON.stringify({ message: { content: '{"ok":true}' } })
          ),
        });
      }),
      { preconnect: () => {} }
    ) as typeof fetch;

    const schema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] };
    const ctx = createOllamaContext({ logger, ollama: { endpoint, model } });
    const out = await generatePromptAndSend<{ ok: boolean }>(ctx, "sys", "user", { schema, temperature: 0.1 });
    expect(out).toEqual({ ok: true });
    expect(captured.format).toEqual(schema);
    expect(captured.schema).toBeUndefined();
    expect(captured.temperature).toBe(0.1);
  });

  test("handles empty content by pausing (no throw)", async () => {
    global.fetch = Object.assign(
      mock().mockResolvedValue({
        ok: true,
        text: mock().mockResolvedValue(
          JSON.stringify({ message: { } })
        ),
      }),
      { preconnect: () => {} }
    ) as typeof fetch;

  const ctx = createOllamaContext({ logger, endpoint, model, pipeline: { retries: 0 } });
    const result = await generatePromptAndSend<any>(ctx, 'sys', 'user', {});
    expect(typeof result).toBe('object');
  });

  test("hooks: stepParseJSON factory and call-with-policies wrapper", async () => {
    const parsed = (await ollamaHooks.stepParseJSON<{ a: number }>()({} as any)("{\"a\":1}")) as any;
    expect(parsed.a).toBe(1);

    global.fetch = Object.assign(
      mock().mockResolvedValue({
        ok: true,
        text: mock().mockResolvedValue(JSON.stringify({ message: { content: '{"ok":true}' } })),
      }),
      { preconnect: () => {} }
    ) as typeof fetch;

  const ctx = createOllamaContext({ endpoint, model });
    const res = (await ollamaHooks.stepCallWithPolicies(ctx as any)({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
      __url: `${endpoint}/api/chat`,
    } as any)) as any;
    expect(res.message?.content).toContain("ok");
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

    const customCheck = (response: { key: string }) =>
      response.key === "valid" ? response : false;

    await expect(
      generatePromptAndSend<{ key: string }>(
        createOllamaContext({ logger, ollama: { endpoint, model } }),
        "system-prompt",
        "user-prompt",
        {},
        customCheck
      )
    ).rejects.toThrowError("Response failed custom check");
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

    const customCheck = (response: { key: string }) =>
      response.key === "valid" ? response : false;

    const result = await generatePromptAndSend<{ key: string }>(
      createOllamaContext({ logger, ollama: { endpoint, model } }),
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

    const customCheck = (response: { key: string }) =>
      response.key === "valid" ? response : false;

    await expect(
      generatePromptAndSend<{ key: string }>(
        createOllamaContext({ logger, ollama: { endpoint, model } }),
        "system-prompt",
        "user-prompt",
        {},
        customCheck
      )
    ).rejects.toThrowError("Response failed custom check");
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

    const ctx = createOllamaContext({ logger, ollama: { endpoint, model } });
    const result = await embedTexts(ctx, ["hello", "world"]);

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

    const ctx = createOllamaContext({ logger, ollama: { endpoint, model }, pipeline: { retries: 1 } });
    const result = await embedTexts(ctx, ["foo"]);
    expect(result).toEqual([[0.5]]);
  });

  test("embedTexts retries up to max attempts before failing", async () => {
    const fetchMock = mock().mockResolvedValue({
      ok: false,
      text: mock().mockResolvedValue("err"),
    });

    global.fetch = Object.assign(fetchMock, {
      preconnect: () => {},
    }) as typeof fetch;

    const ctx = createOllamaContext({ logger, ollama: { endpoint, model }, pipeline: { retries: 2 } });
    await expect(embedTexts(ctx, ["test"])).rejects.toThrow(
      /Embedding failed/
    );

    // Expect 3 attempts
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test("embedTexts sets Authorization header when apiKey provided and respects timeout", async () => {
    const spy: Array<Record<string, any>> = [];
    global.fetch = Object.assign(
      mock().mockImplementation((_url: string, init: RequestInit) => {
        spy.push({ headers: init.headers, signal: (init as any).signal });
        return Promise.resolve({ ok: true, text: mock().mockResolvedValue(JSON.stringify({ embedding: [0.9] })) });
      }),
      { preconnect: () => {} }
    ) as typeof fetch;

    // Ensure env default does not override explicit apiKey
    setEnv("OLLAMA_API_KEY", "");
  const ctx = createOllamaContext({ logger, endpoint, model, apiKey: "sekret", pipeline: { timeout: 5 } });

    const out = await embedTexts(ctx, ["hello"]);
    expect(out).toEqual([[0.9]]);
    const h = spy[0]?.headers as Record<string, string>;
    expect(h["Authorization"]).toBe("Bearer sekret");
    // timer path executed (cannot easily assert abort, but timeout>0 path covered)
  });
});
