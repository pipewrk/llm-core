export * from "./batch-openai-service.ts"; // still public per request
export * from "./batch-openai-pipeline.ts"; // newly exposed pipeline helpers
// (internal) decorators removed from public export
// (internal) file-utils removed from public export
export * from "./env.ts";
export * from "./llm-service.ts";
export * from "./logger.ts";
// Export services with disambiguated names to avoid type conflicts
export {
  createOllamaContext,
  embedTexts,
  generatePromptAndSend as ollama_generatePromptAndSend,
  createOllamaService,
} from "./ollama-service.ts";
export type {
  OllamaContext,
  ChatMessage as OllamaChatMessage,
  GenOptions as OllamaGenOptions,
  RawResponse as OllamaRawResponse,
  RequestDoc as OllamaRequestDoc,
  OllamaService,
} from "./ollama-service.ts";

export {
  createOpenAIContext,
  generatePromptAndSend as openAI_generatePromptAndSend,
  createOpenAIService,
} from "./openai-service.ts";
export type {
  OpenAIContext,
  ChatMessage as OpenAIChatMessage,
  GenOptions as OpenAIGenOptions,
  RawResponse as OpenAIRawResponse,
  RequestDoc as OpenAIRequestDoc,
  OpenAIService,
} from "./openai-service.ts";
export * from "./pipeline.ts";
export * from "./markdown-splitter.ts";
export * from "./cosine-similarity.ts";
export * from "./chunker.ts";
export * from "./runtime.ts";
export * from "./similarity-service.ts";
// (internal) ufetch removed from public export

// Re-export selected type-only modules for public consumption
export type * from "../types/batch-openai";
export type * from "../types/chunker";
export type * from "../types/dataset";
// env types now internal; prompts deferred for future release
