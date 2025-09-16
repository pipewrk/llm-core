// src/core/ollama-service.ts
import { pipeline, type PipelineStep } from "./pipeline";
import type { ILogger } from "../types/dataset";
import { getEnv } from "./env";
import { uFetch } from "./ufetch.ts";
import { withErrorHandling, withRetry, withTimeout, tap } from "./helpers";

/* ────────────────────────────────────────────────────────────────────────── */
/* Context & I/O types                                                        */
/* ────────────────────────────────────────────────────────────────────────── */

export type OllamaContext = {
  logger?: ILogger;
  pipeline?: {
    retries?: number;        // withRetry
    timeout?: number;        // withTimeout (ms)
  };
  ollama: {
    endpoint: string;        // e.g. http://localhost:11434
    model: string;
    apiKey?: string;         // some proxies require it (optional)
  };
};

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type GenOptions = {
  // Ollama ignores schema_name; we pass schema as `format`
  schema?: unknown;
  // pass-throughs if you need them later (temperature, top_p, etc.)
  [k: string]: unknown;
};

export type RequestDoc<T> = {
  messages: ChatMessage[];
  options?: GenOptions;
  customCheck?: (response: T) => T | boolean;
};

export type RawResponse = {
  message?: { content?: string };
};

/* ────────────────────────────────────────────────────────────────────────── */
/* Steps                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

export type Step<I, O> = PipelineStep<I, O, OllamaContext>;
export type Req = RequestInit & { endpoint: string };

const stepBuildPayload: Step<RequestDoc<any>, Req> = (ctx) => (doc) => {
  const { endpoint, model, apiKey } = ctx.ollama;

  const body: Record<string, unknown> = {
    model,
    messages: doc.messages,
    stream: false,
    // Ollama expects structured output schema under `format`
    ...(doc.options?.schema ? { format: doc.options.schema } : {}),
    // any other passthrough options (temperature, top_p, etc.)
    ...Object.fromEntries(
      Object.entries(doc.options ?? {}).filter(([k]) => k !== "schema")
    ),
  };

  const headers: HeadersInit = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  return {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    endpoint: `${endpoint.replace(/\/$/, "")}/api/chat`,
  };
};

const stepCallAPI: Step<Req, RawResponse> = (ctx) => async (req) => {
  const { endpoint, ...init } = req;
  let text = "";
  try {
    const res = (await uFetch(endpoint, { ...(init as RequestInit), returnRaw: true })) as Response;
    text = await res.text();
    if (!res.ok) {
      ctx.logger?.error?.(`Ollama HTTP ${res.status}: ${text.slice(0, 200)}`);
      throw new Error(`HTTP ${res.status}`);
    }
    try {
      const json = JSON.parse(text) as RawResponse;
      return json;
    } catch (e) {
      ctx.logger?.error?.(`Ollama JSON parse failed: ${(e as Error).message}. Raw: ${text.slice(0, 120)}`);
      throw e;
    }
  } catch (e) {
    throw e; // handled by withErrorHandling upstream
  }
};

const stepExtractContent: Step<RawResponse, string> = () => (raw) => {
  const content = raw?.message?.content;
  if (!content) throw new Error("Ollama: no content in response");

  let s = content.trim();
  if (s.startsWith("```json")) {
    s = s.slice(7);
    if (s.endsWith("```")) s = s.slice(0, -3).trim();
  }
  s = s.replace(/,(\s*[\]}])/g, "$1").replace(/\s*\n\s*/g, " ");
  if (!s.trimEnd().endsWith("}")) s += "}";

  return s;
};

const stepParseJSON = <T>(): Step<string, T> => () => (jsonStr) => JSON.parse(jsonStr) as T;

/** Wrapper step that applies retry + timeout around the API call. */
const stepCallWithPolicies: Step<Req, RawResponse> = (ctx) => (payload) => withRetry(withTimeout(stepCallAPI))(ctx)(payload);

/* ────────────────────────────────────────────────────────────────────────── */
/* Service functions                                                           */
/* ────────────────────────────────────────────────────────────────────────── */

export async function generatePromptAndSend<T>(
  ctx: OllamaContext,
  systemPrompt: string,
  userPrompt: string,
  options: GenOptions = {},
  customCheck?: (r: T) => T | boolean
): Promise<T> {
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  const p = pipeline<OllamaContext, RequestDoc<T>>(ctx)
    .addStep(tap<RequestDoc<T>, OllamaContext>((c) => c.logger?.info?.(`Ollama: request start (model=${c.ollama.model})`)))
    .addStep(withErrorHandling(stepBuildPayload))
    .addStep(stepCallWithPolicies)
    .addStep(withErrorHandling(stepExtractContent))
    .addStep(stepParseJSON<T>())
    .addStep(tap<T, OllamaContext>((c) => c.logger?.info?.("Ollama: parsed OK")));

  const parsed = await p.run({ messages, options, customCheck });

  if (customCheck) {
    const checked = customCheck(parsed);
    if (!checked) throw new Error("Response failed custom check");
    return checked as T;
  }
  return parsed;
}

/** Batch embeddings with built-in retry/timeout, keeping behaviour from your class version. */
export async function embedTexts(
  ctx: OllamaContext,
  inputs: string[]
): Promise<number[][]> {
  const url = `${ctx.ollama.endpoint.replace(/\/$/, "")}/api/embeddings`;
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(ctx.ollama.apiKey ? { Authorization: `Bearer ${ctx.ollama.apiKey}` } : {}),
  };

  const max = Math.max(1, ctx.pipeline?.retries ?? 0) + 1;
  const out: number[][] = [];

  for (const input of inputs) {
    let lastErr: Error | null = null;
    let attempt = 0;
    for (; attempt < max; attempt++) {
      try {
        ctx.logger?.info?.(`Ollama embed "${input.slice(0, 48)}..." (attempt ${attempt + 1}/${max})`);
        const controller = new AbortController();
        const timeoutMs = ctx.pipeline?.timeout ?? 0;
        const to = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;
        const res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({ model: ctx.ollama.model, prompt: input }),
          signal: controller.signal,
        }).finally(() => to && clearTimeout(to!));
        const text = await res.text();
        if (!res.ok) {
          ctx.logger?.error?.(`Ollama HTTP ${res.status}: ${text.slice(0, 160)}`);
          throw new Error(`HTTP ${res.status}`);
        }
        try {
          const parsed = JSON.parse(text) as { embedding?: number[] };
          if (!Array.isArray(parsed.embedding)) throw new Error("missing embedding");
          out.push(parsed.embedding);
          break; // success
        } catch (e) {
          ctx.logger?.error?.(`Ollama embed JSON parse failed: ${(e as Error).message}. Raw: ${text.slice(0,120)}`);
          throw e;
        }
      } catch (e) {
        lastErr = e as Error;
        ctx.logger?.warn?.(`Embed failed: ${lastErr.message}`);
        if (attempt + 1 < max) await new Promise((r) => setTimeout(r, 1000));
      }
    }
    if (attempt === max) {
      throw new Error(`Embedding failed for "${input.slice(0, 48)}..."  ${lastErr?.message}`);
    }
  }

  return out;
}

/* Convenience to build ctx from env */
export function createOllamaContext(overrides?: Partial<OllamaContext>): OllamaContext {
  const defaults: OllamaContext = {
    logger: overrides?.logger,
    pipeline: { retries: 2, timeout: 12_000, ...(overrides?.pipeline ?? {}) },
    ollama: {
      endpoint: overrides?.ollama?.endpoint ?? getEnv("OLLAMA_ENDPOINT"),
      model: overrides?.ollama?.model ?? getEnv("OLLAMA_MODEL"),
      apiKey: overrides?.ollama?.apiKey ?? getEnv("OLLAMA_API_KEY"),
    },
  };
  // Allow top-level overrides to win if provided
  return { ...defaults, ...(overrides ?? {}), ollama: { ...defaults.ollama, ...(overrides?.ollama ?? {}) }, pipeline: { ...defaults.pipeline, ...(overrides?.pipeline ?? {}) } };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Bound service helper                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

export interface OllamaService {
  embedTexts(inputs: string[]): Promise<number[][]>;
  generatePromptAndSend<T>(
    systemPrompt: string,
    userPrompt: string,
    options?: GenOptions,
    customCheck?: (r: T) => T | boolean
  ): Promise<T>;
}

/**
 * Create a bound Ollama service where ctx is captured once.
 */
export function createOllamaService(ctx: OllamaContext): OllamaService {
  return {
    embedTexts: (inputs) => embedTexts(ctx, inputs),
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
