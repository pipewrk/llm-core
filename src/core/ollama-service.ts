// src/core/ollama-service.ts
import { pipeline, type PipelineStep } from "./pipeline";
import type { ILogger } from "../types/dataset";
import { getEnv } from "./env";
import { uFetch } from "./ufetch.ts";
import { tap } from "./helpers";

/* ────────────────────────────────────────────────────────────────────────── */
/* Context & I/O types                                                        */
/* ────────────────────────────────────────────────────────────────────────── */

export interface OllamaContext {
  logger?: ILogger;
  model: string;
  endpoint?: string;
  apiKey?: string;
  pipeline?: {
    retries?: number;
    timeout?: number;
  };
}

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type GenOptions = {
  // Ollama ignores schema_name; we pass schema as `format`
  schema?: unknown;
  // pass-throughs if you need them later (temperature, top_p, etc.)
  [k: string]: unknown;
};

export type RequestDoc<T> = {
  messages: ChatMessage[];
  options?: GenOptions;
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
  const {
    endpoint = getEnv("OLLAMA_ENDPOINT"),
    apiKey = getEnv("OLLAMA_API_KEY", ""),
    model = getEnv("OLLAMA_MODEL"),
  } = ctx;
  const { options = {} } = doc;

  const body: Record<string, unknown> = {
    model,
    messages: doc.messages,
    stream: false,
    // Ollama expects structured output schema under `format`
    ...(options.schema ? { format: options.schema } : {}),
    // any other passthrough options (temperature, top_p, etc.)
    ...Object.fromEntries(
      Object.entries(options).filter(([k]) => k !== "schema")
    ),
  };

  // ctx.logger?.info?.(`Ollama payload`, body);

  const headers: HeadersInit = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  return {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    endpoint: `${endpoint}/api/chat`,
  };
};

const stepCallAPI: Step<Req, string> = (ctx) => async (req) => {
  const { endpoint, ...init } = req;
  let text = "";
  try {
    const res = await fetch(endpoint, {...init}) as Response;
    const text = await res.text();
    console.log({text})
    return text as string;
  } catch (e) {
    throw e; // handled by withErrorHandling upstream
  }
};

const stepExtractContent: Step<string, string> = ({logger}) => (raw) => {
  const {content} = JSON.parse(raw).message ?? {};
  logger?.info?.(`Ollama: extracted`, content);
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

const stepParseJSON =
  <T>(): Step<string, T> =>
  ({logger}) =>
  (jsonStr) => {
    try {
      return JSON.parse(jsonStr) as T;
    } catch (e) {
      logger?.error?.(`Ollama JSON parse failed: ${(e as Error).message}. Raw: ${jsonStr}`);
      throw e;
    }
  }

/* ────────────────────────────────────────────────────────────────────────── */
/* Service functions                                                           */
/* ────────────────────────────────────────────────────────────────────────── */

export async function generatePromptAndSend<T>(
  ctx: OllamaContext,
  systemPrompt: string,
  userPrompt: string,
  options: GenOptions = {},
  customCheck?: (r: T) => T | boolean,
  numTries: number = 0
): Promise<T> {
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  const runOnce = async (): Promise<T> => {
    const p = pipeline<OllamaContext, RequestDoc<T>>(ctx)
      .addStep(
        tap<RequestDoc<T>, OllamaContext>((c) =>
          c.logger?.info?.(`Ollama: request start (model=${c.model})`)
        )
      )
      .addStep(stepBuildPayload)
      .addStep(stepCallAPI)
      .addStep(stepExtractContent)
      .addStep(stepParseJSON<T>())
      .addStep(
        tap<T, OllamaContext>((c) => c.logger?.info?.("Ollama: parsed OK"))
      );

    return p.run({ messages, options });
  };

  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= numTries; attempt++) {
    try {
      const parsed = await runOnce();
      if (customCheck) {
        const checked = customCheck(parsed);
        if (checked && checked !== true) return checked as T;
        if (checked === true) return parsed;
        ctx.logger?.warn?.(
          `Custom check failed (attempt ${attempt + 1}/${numTries + 1})`
        );
        lastError = new Error("Response failed custom check");
        continue;
      }
      return parsed;
    } catch (e) {
      // Transport/parse errors are not retried here; surface immediately
      lastError = e as Error;
      break;
    }
  }
  throw lastError ?? new Error("Response failed custom check");
}

/** Batch embeddings with built-in retry/timeout, keeping behaviour from your class version. */
export async function embedTexts(
  ctx: OllamaContext,
  inputs: string[]
): Promise<number[][]> {
  const endpoint = (ctx.endpoint ?? getEnv("OLLAMA_ENDPOINT")).replace(
    /\/$/,
    ""
  );
  const url = `${endpoint}/api/embeddings`;
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(ctx.apiKey ? { Authorization: `Bearer ${ctx.apiKey}` } : {}),
  };

  const max = Math.max(1, ctx.pipeline?.retries ?? 2) + 1;
  const out: number[][] = [];

  for (const input of inputs) {
    let lastErr: Error | null = null;
    let attempt = 0;
    for (; attempt < max; attempt++) {
      try {
        ctx.logger?.info?.(
          `Ollama embed "${input.slice(0, 48)}..." (attempt ${
            attempt + 1
          }/${max})`
        );
        const controller = new AbortController();
        const timeoutMs = ctx.pipeline?.timeout ?? 12000;
        const to =
          timeoutMs > 0
            ? setTimeout(() => controller.abort(), timeoutMs)
            : null;
        const res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({ model: ctx.model, prompt: input }),
          signal: controller.signal,
        }).finally(() => to && clearTimeout(to!));
        const text = await res.text();
        if (!res.ok) {
          ctx.logger?.error?.(
            `Ollama HTTP ${res.status}: ${text.slice(0, 160)}`
          );
          throw new Error(`HTTP ${res.status}`);
        }
        try {
          const parsed = JSON.parse(text) as { embedding?: number[] };
          if (!Array.isArray(parsed.embedding))
            throw new Error("missing embedding");
          out.push(parsed.embedding);
          break; // success
        } catch (e) {
          ctx.logger?.error?.(
            `Ollama embed JSON parse failed: ${
              (e as Error).message
            }. Raw: ${text.slice(0, 120)}`
          );
          throw e;
        }
      } catch (e) {
        lastErr = e as Error;
        ctx.logger?.warn?.(`Embed failed: ${lastErr.message}`);
        if (attempt + 1 < max) await new Promise((r) => setTimeout(r, 1000));
      }
    }
    if (attempt === max) {
      throw new Error(
        `Embedding failed for "${input.slice(0, 48)}..."  ${lastErr?.message}`
      );
    }
  }

  return out;
}

/* Convenience to build ctx from env */
export function createOllamaContext(
  overrides?: Partial<OllamaContext>
): OllamaContext {
  return {
    logger: overrides?.logger,
    model: overrides?.model ?? getEnv("OLLAMA_MODEL"),
    endpoint: overrides?.endpoint ?? getEnv("OLLAMA_ENDPOINT"),
    apiKey: overrides?.apiKey ?? getEnv("OLLAMA_API_KEY", ""),
    pipeline: {
      retries: overrides?.pipeline?.retries ?? 2,
      timeout: overrides?.pipeline?.timeout ?? 12_000,
    },
  };
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
    customCheck?: (r: T) => T | boolean,
    numTries?: number
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
      customCheck?: (r: T) => T | boolean,
      numTries: number = 0
    ) =>
      generatePromptAndSend<T>(
        ctx,
        systemPrompt,
        userPrompt,
        options,
        customCheck,
        numTries
      ),
  };
}

// Test hooks (not re-exported from barrel index)
export const __test = {
  stepBuildPayload,
  stepCallAPI,
  stepExtractContent,
  stepParseJSON,
  // stepCallWithPolicies,
};
