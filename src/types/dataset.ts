export interface Document<T = Record<string | number | symbol, never>> {
  content: string; // The file’s textual content
  filePath: string; // The path of the original file
  transformations: T; // Generic transformations property
  errors?: string[];
}

export interface ILogger {
  attn(...args: unknown[]): void;
  impt(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface BatchLLMService {
  /**
   * Initiates a batch job by submitting a JSONL file of requests.
   * @param requests The list of batch requests.
   * @returns A Promise that resolves to the batch job identifier.
   */
  initiateBatch<T>(requests: BatchRequest<T>[]): Promise<string>;

  /**
   * Polls the batch job until completion and returns responses mapped by their custom IDs.
   * @param batchId The identifier of the batch job.
   * @param customIds The list of custom IDs to retrieve.
   * @returns A Promise that resolves with a map from custom ID to the response.
   */
  pollBatch<T>(
    batchId: string,
    customIds: string[],
  ): Promise<Record<string, T>>;
}

export interface BatchRequest<T> {
  custom_id: string;
  systemPrompt: string;
  userPrompt: string;
  options: {
    schema: Record<string | number | symbol, never>;
    schema_name: string;
    model?: string;
    max_tokens?: number;
    [key: string]: unknown;
  };
}

export interface PipelineOptions {
  /**
   * The selected LLM service.
   * Can be either "openai" or "ollama".
   */
  llm: "openai" | "ollama";

  /**
   * The model identifier to use.
   * This value will default to OPENAI_MODEL for "openai" or OLLAMA_MODEL for "ollama".
   */
  model: string;

  /**
   * A flag indicating whether debug mode is enabled.
   */
  debug: boolean;

  /**
   * Output path
   */
  outputDir: string;
}

/**
 * Represents the response for a batch operation in OpenAI's API.
 */
export interface BatchResponse {
  /** Unique identifier for the batch job. */
  id: string;

  /** The type of object, always "batch". */
  object: string;

  /** The API endpoint the batch is processing requests for. */
  endpoint: string;

  /** Any errors encountered during batch processing, or null if none. */
  errors: unknown | null;

  /** The ID of the input file used for this batch job. */
  input_file_id: string;

  /** The time window (e.g., "24h") allowed for the batch to complete. */
  completion_window: string;

  /**
   * The current status of the batch job.
   * - "validating": The input file is being validated.
   * - "failed": The input file failed validation.
   * - "in_progress": The batch is currently running.
   * - "finalizing": Results are being prepared.
   * - "completed": The batch is complete, and results are ready.
   * - "expired": The batch did not complete in time.
   * - "cancelling": The batch is being cancelled.
   * - "cancelled": The batch was successfully cancelled.
   */
  status:
    | "validating"
    | "failed"
    | "in_progress"
    | "finalizing"
    | "completed"
    | "expired"
    | "cancelling"
    | "cancelled"
    | string;

  /** The ID of the file containing batch results, or null if not yet available. */
  output_file_id?: string | null;

  /** The ID of the file containing batch errors, or null if not yet available. */
  error_file_id?: string | null;

  /** The timestamp (in seconds since epoch) when the batch was created. */
  created_at: number;

  /** The timestamp when the batch started processing, or null if not started. */
  in_progress_at?: number | null;

  /** The timestamp when the batch expires. */
  expires_at: number;

  /** The timestamp when the batch results started finalizing, or null if not applicable. */
  finalizing_at?: number | null;

  /** The timestamp when the batch completed, or null if not completed. */
  completed_at?: number | null;

  /** The timestamp when the batch failed, or null if it has not failed. */
  failed_at?: number | null;

  /** The timestamp when the batch expired, or null if it has not expired. */
  expired_at?: number | null;

  /** The timestamp when the batch started being cancelled, or null if not applicable. */
  cancelling_at?: number | null;

  /** The timestamp when the batch was successfully cancelled, or null if not cancelled. */
  cancelled_at?: number | null;

  /**
   * Counts of the batch requests.
   * - `total`: Total number of requests in the batch.
   * - `completed`: Number of successfully processed requests.
   * - `failed`: Number of requests that failed.
   */
  request_counts: {
    /** Total number of requests in the batch. */
    total: number;

    /** Number of requests successfully processed. */
    completed: number;

    /** Number of requests that failed. */
    failed: number;
  };

  /**
   * Additional metadata provided for the batch job.
   * Example:
   * ```
   * {
   *   "customer_id": "user_123456789",
   *   "batch_description": "Nightly eval job"
   * }
   * ```
   */
  metadata?: Record<string, unknown> | null;
}
