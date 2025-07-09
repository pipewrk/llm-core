import { withLogger } from "./decorators.ts";
import { ensureDirectory, prepareFormData, saveJsonl } from "./file-utils.ts";
import type {
  BatchLLMService,
  BatchRequest,
  BatchResponse,
  ILogger,
} from "../types/dataset.ts";
import { getEnv } from "./env.ts";
import { setTimeout } from "node:timers";
import console from "node:console";
import { uFetch } from "./ufetch.ts";

export interface OpenAIBatchServiceArgs {
  model: string;
  logger: ILogger;
  endpoint: string;
  apiKey: string;
  tempDir: string;
}

@withLogger
export class OpenAIBatchService implements BatchLLMService {
  private logger!: ILogger;
  private endpoint: string;
  private model: string;
  private apiKey: string;
  private tempDir: string;

  constructor({
    model,
    endpoint = getEnv("OPENAI_ENDPOINT"),
    apiKey = getEnv("OPENAI_API_KEY"),
    tempDir = getEnv("BATCH_TMP_DIR"),
  }: OpenAIBatchServiceArgs) {
    this.endpoint = endpoint;
    this.model = model;
    this.apiKey = apiKey;
    this.tempDir = tempDir;
    ensureDirectory(this.tempDir, this.logger);
  }

  async initiateBatch<T>(requests: BatchRequest<T>[]): Promise<string> {
    const fileName = `batch_${Date.now()}.jsonl`;
    const filePath = `${this.tempDir}/${fileName}`;

    // Map each request to the expected JSONL structure.
    const jsonlItems = requests.map((req) => {
      const { schema, schema_name, model, ...rest } = req.options;
      const body = {
        ...rest,
        response_format: {
          type: "json_schema",
          json_schema: {
            name:
              typeof schema_name === "string" ? schema_name : "response_schema",
            strict: true,
            schema,
          },
        },
        model: model || this.model || getEnv("OPENAI_MODEL"),
        messages: [
          { role: "system", content: req.systemPrompt },
          { role: "user", content: req.userPrompt },
        ],
        max_tokens: req.options.max_tokens || 1000,
      };

      return {
        custom_id: req.custom_id,
        method: "POST",
        url: "/v1/chat/completions",
        body,
      };
    });

    // Save the JSONL file for batch submission.
    saveJsonl("", filePath, jsonlItems, this.logger);
    console.info(`Saved batch file: ${filePath}`);

    // Upload the file using the Files API.
    const fileId = await this.uploadFile(filePath);
    const batchId = await this.createBatch(fileId);

    // Cleanup the temporary file (uncomment if desired).
    // removeFile(filePath, this.logger);
    return batchId;
  }

  async pollBatch<T>(
    batchId: string,
    customIds: string[]
  ): Promise<Record<string, T>> {
    const pollingInterval = 10000; // 10 seconds
    const maxAttempts = 144; // roughly 24 hours if needed
    let attempts = 0;
    let batchStatus = "";

    while (attempts < maxAttempts) {
      const response = await fetch(`${this.endpoint}/v1/batches/${batchId}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Polling failed with status ${response.status}`);
      }

      const data = (await response.json()) as unknown as BatchResponse;
      batchStatus = data.status;

      if (batchStatus === "completed") {
        const outputFileId = data.output_file_id;
        if (!outputFileId) {
          throw new Error("Batch completed but output_file_id not present");
        }
        return await this.fetchBatchResults<T>(outputFileId, customIds);
      }
      if (["failed", "expired", "cancelled"].includes(batchStatus)) {
        throw new Error(`Batch terminated with status: ${batchStatus}`);
      }

      console.info(
        `Batch ${batchId} status: ${batchStatus} (Attempt ${attempts + 1})`
      );
      attempts++;
      await this.sleep(pollingInterval);
    }
    throw new Error("Polling exceeded maximum attempts");
  }

  private async uploadFile(filePath: string): Promise<string> {
    let formData = prepareFormData(filePath);
    const response = await uFetch(`${this.endpoint}/v1/files`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`File upload failed with status ${response.status}`);
    }

    const data = (await response.json()) as unknown as BatchResponse;
    return data.id;
  }

  private async createBatch(inputFileId: string): Promise<string> {
    const payload = {
      input_file_id: inputFileId,
      endpoint: "/v1/chat/completions",
      completion_window: "24h",
    };

    const response = await fetch(`${this.endpoint}/v1/batches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Batch creation failed with status ${response.status}`);
    }

    const data = (await response.json()) as unknown as BatchResponse;
    return data.id;
  }

  private async fetchBatchResults<T>(
    outputFileId: string,
    customIds: string[]
  ): Promise<Record<string, T>> {
    const response = await fetch(
      `${this.endpoint}/v1/files/${outputFileId}/content`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(
        `Failed to fetch batch results with status ${response.status}`
      );
    }

    const content = await response.text();
    const results: Record<string, T> = {};

    content.split("\n").forEach((line: string) => {
      if (!line.trim()) return;

      try {
        const entry = JSON.parse(line);
        const { custom_id, response: batchResponse, error } = entry;

        if (error) {
          console.error(`Error in batch response for ${custom_id}:`, error);
          return;
        }

        if (customIds.includes(custom_id)) {
          results[custom_id] = batchResponse?.body;
        }
      } catch (err) {
        console.error("Failed to parse batch response line:", line, err);
      }
    });
    return results;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
