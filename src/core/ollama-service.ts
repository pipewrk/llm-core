// src/core/ollama-service.ts
import { pipeline, type PipelineStep } from "./pipeline";
import type { ILogger } from "../types/dataset";
import { getEnv } from "./env";
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

const stepBuildPayload: PipelineStep<
  RequestDoc<any>,
  (RequestInit & { __url: string }),
  OllamaContext
> = (ctx) => async (doc) => {
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
    __url: `${endpoint.replace(/\/$/, "")}/api/chat`,
  };
};

const stepCallAPI: PipelineStep<
  (RequestInit & { __url: string }),
  RawResponse,
  OllamaContext
> = (ctx) => async (req) => {
  const { __url, ...init } = req as any;
  const res = await fetch(__url, init as RequestInit);

  // Read text first, so we can log on error before JSON parse
  const text = await res.text();
  if (!res.ok) {
    ctx.logger?.error?.(`Ollama HTTP ${res.status}: ${text}`);
    throw new Error(`HTTP ${res.status}`);
  }

  try {
    return JSON.parse(text) as RawResponse;
  } catch (e) {
    ctx.logger?.error?.(`Ollama: JSON parse failed — ${(e as Error).message}`);
    throw e;
  }
};

const stepExtractContent: PipelineStep<RawResponse, string, OllamaContext> =
  (ctx) => async (raw) => {
    const content = raw?.message?.content;
    if (!content) throw new Error("Ollama: no content in response");

    // same sanitiser logic you used before
    let s = content.trim();
    if (s.startsWith("```json")) {
      s = s.slice(7);
      if (s.endsWith("```")) s = s.slice(0, -3).trim();
    }
    s = s.replace(/,(\s*[\]}])/g, "$1").replace(/\s*\n\s*/g, " ");
    if (!s.trimEnd().endsWith("}")) s += "}";

    return s;
  };

const stepParseJSON = <T>(): PipelineStep<string, T, OllamaContext> =>
  () => async (jsonStr) => JSON.parse(jsonStr) as T;

/** Wrapper step that applies retry + timeout around the API call. */
const stepCallWithPolicies: PipelineStep<
  RequestInit & { __url: string },
  RawResponse,
  OllamaContext
> = (c) => (payload) => withRetry(withTimeout(stepCallAPI))(c)(payload);

/* ────────────────────────────────────────────────────────────────────────── */
/* Facade functions                                                           */
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
    .addStep(tap<RequestDoc<T>, OllamaContext>((c) =>
      c.logger?.info?.(`Ollama: request start (model=${c.ollama.model})`)))
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
    let i = 0;
    for (; i < max; i++) {
      try {
        ctx.logger?.info?.(
          `Ollama embed "${input.slice(0, 48)}..." (attempt ${i + 1}/${max})`
        );

        const controller = new AbortController();
        const t = ctx.pipeline?.timeout ?? 0;
        const to = t > 0 ? setTimeout(() => controller.abort(), t) : null;

        const res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({ model: ctx.ollama.model, prompt: input }),
          signal: controller.signal,
        }).finally(() => to && clearTimeout(to!));

        const text = await res.text();
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);

        const json = JSON.parse(text) as { embedding?: number[] };
        if (!Array.isArray(json.embedding)) {
          throw new Error(`Invalid embed response: ${text.slice(0, 200)}`);
        }

        out.push(json.embedding);
        break; // success
      } catch (e) {
        lastErr = e as Error;
        ctx.logger?.warn?.(`Embed failed: ${lastErr.message}`);
        if (i + 1 < max) await new Promise((r) => setTimeout(r, 1000));
      }
    }
    if (i === max) {
      throw new Error(
        `Embedding failed for "${input.slice(0, 48)}..." — ${lastErr?.message}`
      );
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

// Test hooks (not re-exported from barrel index)
export const __test = {
  stepBuildPayload,
  stepCallAPI,
  stepExtractContent,
  stepParseJSON,
  stepCallWithPolicies,
};
