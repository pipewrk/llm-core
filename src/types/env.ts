// ./types/env.ts
export interface Env {
  NTFY_ENDPOINT: string;
  OPENAI_ENDPOINT: string;
  OPENAI_API_KEY: string;
  OPENAI_MODEL: string;
  OLLAMA_ENDPOINT: string;
  OLLAMA_MODEL: string;
  OLLAMA_API_KEY: string;
  HF_MODEL: string;
  LOG_PATH: string;
  CONVO_IGNORE_PATH: string;
  CONVO_DIR: string;
  BATCH_TMP_DIR: string;
  SIMILARITY_SCORE: string;
  GITHUB_API_TOKEN: string;
  IMAP_HOST: string;
  IMAP_USER: string;
  IMAP_PASSWORD: string;
  JINA_API_KEY: string;
}
