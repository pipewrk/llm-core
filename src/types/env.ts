// ./types/env.ts
export interface Env {
  // OpenAI-related configuration
  OPENAI_ENDPOINT: string;
  OPENAI_API_KEY: string;
  OPENAI_MODEL: string;

  // Ollama-related configuration
  OLLAMA_ENDPOINT: string;
  OLLAMA_MODEL: string;
  OLLAMA_API_KEY: string;

  // Hugging Face-related configuration
  HF_MODEL: string;

  // Notification and GitHub integrations
  NTFY_ENDPOINT: string;
  GITHUB_API_TOKEN: string;

  // IMAP email configuration
  IMAP_HOST: string;
  IMAP_USER: string;
  IMAP_PASSWORD: string;

  // Other APIs
  JINA_API_KEY: string;

  // File paths and directories
  LOG_PATH: string;
  CONVO_IGNORE_PATH: string;
  CONVO_DIR: string;
  BATCH_TMP_DIR: string;
  INPUT_DIR: string;
  OUTPUT_DIR: string;

  // Miscellaneous
  SIMILARITY_SCORE: string;
}
