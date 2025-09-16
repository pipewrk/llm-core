import { pipeline, type PipelineStep } from "./pipeline";
import type { ILogger } from "../types/dataset";
import { getEnv } from "./env";
import { uFetch } from "./ufetch.ts";
import { withErrorHandling, withRetry, withTimeout, tap } from "./helpers";

/* --------------------------------------------------------------------------
 * Context & I/O types
 * -------------------------------------------------------------------------- */

export type OpenAIContext = {
  logger?: ILogger;
  pipeline?: {
    retries?: number;           // withRetry
    timeout?: number;           // withTimeout (ms)
  };
  openai: {
    endpoint: string;           // e.g. https://api.openai.com
    apiKey: string;
    model: string;              // e.g. gpt-4o-mini
  };
};

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type GenOptions = {
  schema?: unknown;
  schema_name?: string;
  // Optional OpenAI passthroughs:
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  // ...add more when needed
};

export type RequestDoc<T> = {
  messages: ChatMessage[];
  options?: GenOptions;
  customCheck?: (response: T) => T | boolean;
};

export type RawResponse = {
  choices?: { message?: { content?: string } }[];
};

/* --------------------------------------------------------------------------
 * Steps
 * -------------------------------------------------------------------------- */

export type Step<I, O> = PipelineStep<I, O, OpenAIContext>;
export type Req = RequestInit & { endpoint: string };

/** Build a fetch payload (RequestInit) from high-level doc. */
const stepBuildPayload: Step<RequestDoc<any>, Req> = (ctx) => (doc) => {
  const { endpoint, apiKey, model } = ctx.openai;

  // Base body
  const body: Record<string, unknown> = {
    model,
    messages: doc.messages,
    stream: false,
  };

  const opts = doc.options ?? {};
  if (opts.schema) {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: typeof opts.schema_name === "string" ? opts.schema_name : "response_schema",
        strict: true,
        schema: opts.schema,
      },
    };
    const { schema, schema_name, ...rest } = opts as Record<string, unknown>;
    Object.assign(body, rest);
  } else {
    Object.assign(body, opts);
  }

  const req: RequestInit & { endpoint: string } = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    endpoint: `${endpoint}/v1/chat/completions`,
  };

  ctx.logger?.info?.("OpenAI: payload prepared");
  return req;
};

/** Call OpenAI; logs HTTP / parse errors; returns RawResponse on success. */
const stepCallAPI: Step<Req, RawResponse> = (ctx) => async (req) => {
  const { endpoint, ...payload } = req as any;
  try {
    const res = (await uFetch(endpoint, { ...(payload as RequestInit), returnRaw: true })) as Response & { json?: () => Promise<any> };
    let raw: string | undefined;
    let data: any;
    if (!res.ok) {
      raw = typeof res.text === 'function' ? await res.text() : '';
      ctx.logger?.error?.(`OpenAI HTTP ${res.status}: ${raw.slice(0,200)}`);
      throw new Error(`HTTP ${res.status}`);
    }
    if (typeof res.json === 'function') {
      try {
        data = await res.json();
      } catch (e) {
        raw = raw ?? (typeof res.text === 'function' ? await res.text() : '');
        ctx.logger?.error?.(`OpenAI JSON parse failed: ${(e as Error).message}. Raw: ${raw.slice(0,120)}`);
        throw e;
      }
    } else {
      raw = await res.text();
      try {
        data = JSON.parse(raw);
      } catch (e) {
        ctx.logger?.error?.(`OpenAI JSON parse failed: ${(e as Error).message}. Raw: ${raw.slice(0,120)}`);
        throw e;
      }
    }
    return data as RawResponse;
  } catch (e) {
    throw e;
  }
};

/** Wrapper step that applies retry + timeout around the API call. */
const stepCallWithPolicies: Step<Req, RawResponse> = (ctx) => (req) => withRetry(withTimeout(stepCallAPI))(ctx)(req);

/** Extract + sanitise JSON text. */
const stepExtractContent: Step<RawResponse, string> = () => async (raw) => {
  const content = raw?.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI: no content in response");

  let s = content.trim();
  if (s.startsWith("```json")) {
    s = s.slice(7);
    if (s.endsWith("```")) s = s.slice(0, -3).trim();
  }
  // Remove trailing commas and compress whitespace
  s = s.replace(/,(\s*[\]}])/g, "$1").replace(/\s*\n\s*/g, " ");
  if (!s.trimEnd().endsWith("}")) s += "}";

  return s;
};

/** Parse to T; customCheck applied by service after pipeline if provided. */
const stepParseJSON = <T>(): Step<string, T> => (_ctx) => async (jsonStr) => {
  return JSON.parse(jsonStr) as T;
};

/* --------------------------------------------------------------------------
 * Service: generatePromptAndSend<T>
 * -------------------------------------------------------------------------- */

export async function generatePromptAndSend<T>(
  ctx: OpenAIContext,
  systemPrompt: string,
  userPrompt: string,
  options: GenOptions = {},
  customCheck?: (response: T) => T | boolean,
): Promise<T> {
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  const p = pipeline<OpenAIContext, RequestDoc<T>>(ctx)
    .addStep(tap<RequestDoc<T>, OpenAIContext>((c) => c.logger?.info?.(`OpenAI: request start (model=${c.openai.model})`)))
    .addStep(withErrorHandling(stepBuildPayload))
    .addStep(stepCallWithPolicies)
    .addStep(withErrorHandling(stepExtractContent))
    .addStep(stepParseJSON<T>())
    .addStep(tap<T, OpenAIContext>((c) => c.logger?.info?.("OpenAI: parsed OK")));

  const parsed = await p.run({ messages, options, customCheck });

  if (customCheck) {
    const checked = customCheck(parsed);
    if (!checked) throw new Error("Response failed custom check");
    return checked as T;
  }
  return parsed;
}

/* --------------------------------------------------------------------------
 * Convenience: create context from environment
 * -------------------------------------------------------------------------- */

export function createOpenAIContext(overrides?: Partial<OpenAIContext>): OpenAIContext {
  const endpoint = overrides?.openai?.endpoint ?? getEnv("OPENAI_ENDPOINT");
  const apiKey = overrides?.openai?.apiKey ?? getEnv("OPENAI_API_KEY");
  const model = overrides?.openai?.model ?? getEnv("OPENAI_MODEL");

  return {
    logger: overrides?.logger,
    pipeline: overrides?.pipeline,
    openai: { endpoint, apiKey, model },
  };
}

/* --------------------------------------------------------------------------
 * Bound service helper
 * -------------------------------------------------------------------------- */

export interface OpenAIService {
  generatePromptAndSend<T>(
    systemPrompt: string,
    userPrompt: string,
    options?: GenOptions,
    customCheck?: (response: T) => T | boolean
  ): Promise<T>;
}

/** Create a bound OpenAI service where ctx is captured once. */
export function createOpenAIService(ctx: OpenAIContext): OpenAIService {
  return {
    generatePromptAndSend: <T>(
      systemPrompt: string,
      userPrompt: string,
      options: GenOptions = {},
      customCheck?: (r: T) => T | boolean
    ) => generatePromptAndSend<T>(ctx, systemPrompt, userPrompt, options, customCheck),
  };
}

// Test hooks (not re-exported from barrel index)
export const __test = {
  stepBuildPayload,
  stepCallAPI,
  stepExtractContent,
  stepParseJSON,
  stepCallWithPolicies,
};
