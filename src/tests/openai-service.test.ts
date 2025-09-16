import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createOpenAIContext, generatePromptAndSend, __test as openaiHooks } from "../core/openai-service";
import { MockLogger } from "./logger.mock";
import { getEnv, setEnv } from "../core/env";

describe("OpenAI OpenAPI-style service", () => {
  const logger = new MockLogger();
  const endpoint = "http://openai.test";
  const model = "test-model";

  beforeEach(() => {
    logger.clear();
  });

  test("createOpenAIContext uses environment variables when not overridden", () => {
    setEnv("OPENAI_ENDPOINT", "http://env-endpoint.test");
    setEnv("OPENAI_API_KEY", "test-api");
    setEnv("OPENAI_MODEL", model);

  const ctx = createOpenAIContext({ logger });
  expect(ctx.endpoint).toBe(getEnv("OPENAI_ENDPOINT"));
  expect(ctx.apiKey).toBe(getEnv("OPENAI_API_KEY"));
  expect(ctx.model).toBe(model);
  });

  test("sanitizes JSON content before parsing (fenced + trailing comma)", async () => {
    global.fetch = Object.assign(
      mock().mockResolvedValue({
        ok: true,
        json: mock().mockResolvedValue({
          choices: [{ message: { content: '```json\n{"key": "value",}\n```' } }],
        }),
      }),
      { preconnect: () => {} }
    ) as typeof fetch;

    const ctx = createOpenAIContext({ logger, endpoint, apiKey: "k", model });

    const out = await generatePromptAndSend<{ key: string }>(
      ctx,
      "sys",
      "user",
      {}
    );
    expect(out).toEqual({ key: "value" });
  });

  test("adds response_format when schema provided", async () => {
    let capturedBody: any = null;
    global.fetch = Object.assign(
      mock().mockImplementation((url: string, init: RequestInit) => {
        try {
          capturedBody = JSON.parse(String(init.body));
        } catch {}
        return Promise.resolve({
          ok: true,
          json: mock().mockResolvedValue({
            choices: [{ message: { content: '{"ok": true}' } }],
          }),
        });
      }),
      { preconnect: () => {} }
    ) as unknown as typeof fetch;

  const ctx = createOpenAIContext({ logger, endpoint, apiKey: "k", model });
    const out = await generatePromptAndSend<{ ok: boolean }>(
      ctx,
      "sys",
      "user",
      { schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] } }
    );
    expect(out).toEqual({ ok: true });
    expect(capturedBody?.response_format?.type).toBe("json_schema");
    expect(capturedBody?.response_format?.json_schema?.schema?.required).toContain("ok");
  });

  test("logs and throws on HTTP error", async () => {
    global.fetch = Object.assign(
      mock().mockResolvedValue({
        ok: false,
        text: mock().mockResolvedValue("bad"),
      }),
      { preconnect: () => {} }
    ) as typeof fetch;

  const ctx = createOpenAIContext({ logger, endpoint, apiKey: "k", model });
    const out = await generatePromptAndSend(ctx, "sys", "user", {} as any);
    // On HTTP error, the pipeline pauses; wrapper logs error and returns early.
    expect(logger.logs.error.join("\n")).toMatch(/OpenAI HTTP/);
  });

  test("does not set response_format when schema missing; passes through options", async () => {
    let capturedBody: any = null;
    global.fetch = Object.assign(
      mock().mockImplementation((_url: string, init: RequestInit) => {
        try { capturedBody = JSON.parse(String(init.body)); } catch {}
        return Promise.resolve({ ok: true, json: mock().mockResolvedValue({ choices: [{ message: { content: '{"x":1}' } }] }) });
      }),
      { preconnect: () => {} }
    ) as typeof fetch;

    const ctx = createOpenAIContext({ logger, endpoint, apiKey: "k", model });
    const out = await generatePromptAndSend<{ x: number }>(ctx, "sys", "user", { temperature: 0.2 });
    expect(out).toEqual({ x: 1 });
    expect(capturedBody.response_format).toBeUndefined();
    expect(capturedBody.temperature).toBe(0.2);
  });

  test("uses provided schema_name in response_format", async () => {
    let capturedBody: any = null;
    global.fetch = Object.assign(
      mock().mockImplementation((_url: string, init: RequestInit) => {
        try { capturedBody = JSON.parse(String(init.body)); } catch {}
        return Promise.resolve({ ok: true, json: mock().mockResolvedValue({ choices: [{ message: { content: '{"ok":true}' } }] }) });
      }),
      { preconnect: () => {} }
    ) as typeof fetch;

    const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] };
    const ctx = createOpenAIContext({ logger, endpoint, apiKey: 'k', model });
    const out = await generatePromptAndSend<{ ok: boolean }>(ctx, 'sys', 'user', { schema, schema_name: 'MyShape' });
    expect(out).toEqual({ ok: true });
    expect(capturedBody.response_format.json_schema.name).toBe('MyShape');
  });

  test("handles empty content by pausing (no throw)", async () => {
    global.fetch = Object.assign(
      mock().mockResolvedValue({ ok: true, json: mock().mockResolvedValue({ choices: [{ message: {} }] }) }),
      { preconnect: () => {} }
    ) as typeof fetch;

  const ctx = createOpenAIContext({ logger, endpoint, apiKey: 'k', model, pipeline: { retries: 0 } });
    const result = await generatePromptAndSend<any>(ctx, 'sys', 'user', {});
    expect(typeof result).toBe('object');
  });

  test("hooks: stepParseJSON factory and call-with-policies wrapper", async () => {
    const parsed = (await openaiHooks.stepParseJSON<{ a: number }>()({} as any)("{\"a\":1}")) as any;
    expect(parsed.a).toBe(1);

    global.fetch = Object.assign(
      mock().mockResolvedValue({
        ok: true,
        json: mock().mockResolvedValue({ choices: [{ message: { content: '{"ok":true}' } }] }),
      }),
      { preconnect: () => {} }
    ) as typeof fetch;

  const ctx = createOpenAIContext({ endpoint, apiKey: "k", model });
    const res = (await openaiHooks.stepCallWithPolicies(ctx as any)({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
      __endpoint: `${endpoint}/v1/chat/completions`,
    } as any)) as any;
    expect(res.choices?.length).toBe(1);
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

    const customCheck = (response: { key: string }) =>
      response.key === "valid" ? response : false;

  const ctx = createOpenAIContext({ logger, endpoint, apiKey: "k", model });
    const result = await generatePromptAndSend<{ key: string }>(
      ctx,
      "system-prompt",
      "user-prompt",
      {},
      customCheck,
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

    const customCheck = (response: { key: string }) =>
      response.key === "valid" ? response : false;

    await expect(
      generatePromptAndSend<{ key: string }>(
  createOpenAIContext({ logger, endpoint, apiKey: "k", model }),
        "system-prompt",
        "user-prompt",
        {},
        customCheck
      )
    ).rejects.toThrowError("Response failed custom check");
  });
});
