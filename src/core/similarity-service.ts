import { pipeline } from "@huggingface/transformers";
import type { ILogger } from "src/types/dataset.ts";
import type { FeatureExtractionPipeline } from "@huggingface/transformers";

export class SimilarityService<T> {
  private static _instances: Map<string, SimilarityService<unknown>> =
    new Map(); // Cache for instances

  private logger: ILogger;
  private extractor: FeatureExtractionPipeline; // The Hugging Face feature extraction pipeline
  private similarityThreshold: number;
  private toStringFn: (item: T) => string;

  /**
   * Private constructor to enforce usage of `SimilarityService.instance(...)`.
   *
   * @param logger - The logger instance used for logging information during the pipeline execution.
   * @param extractor - The Hugging Face feature extraction pipeline.
   * @param similarityThreshold - The row-based threshold used for clustering.
   * @param toStringFn - A transformation function to map `T` into strings for similarity analysis.
   */
  private constructor(
    logger: ILogger | undefined,
    extractor: FeatureExtractionPipeline,
    similarityThreshold: number,
    toStringFn: (item: T) => string,
  ) {
    this.logger = logger ?? SimilarityService.noopLogger();
    this.extractor = extractor;
    this.similarityThreshold = similarityThreshold;
    this.toStringFn = toStringFn;
  }

  private static noopLogger(): ILogger {
    return {
      attn: () => {},
      impt: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    };
  }

  /**
   * Static async factory method to retrieve or create an instance.
   * Instances are cached by `modelName` and `similarityThreshold`.
   *
   * @param modelName - The name of the Hugging Face model used for feature extraction.
   * @param logger - The logger instance used for logging information during the pipeline execution.
   * @param similarityThreshold - The row-based threshold used for clustering.
   * @param toStringFn - A transformation function to map `T` into strings for similarity analysis.
   * @returns A promise that resolves to a `SimilarityService<T>` instance.
   */
  public static async instance<T>(
    modelName: string,
    logger: ILogger | undefined,
    similarityThreshold: number = 0.7,
    toStringFn: (item: T) => string,
  ): Promise<SimilarityService<T>> {
    const cacheKey = `${modelName}-${similarityThreshold}`;
    if (SimilarityService._instances.has(cacheKey)) {
      return SimilarityService._instances.get(cacheKey)! as SimilarityService<
        T
      >;
    }

    const extractor = await pipeline("feature-extraction", modelName);
    const service = new SimilarityService(
      logger,
      extractor,
      similarityThreshold,
      toStringFn,
    );
    SimilarityService._instances.set(
      cacheKey,
      service as SimilarityService<unknown>,
    );

    return service;
  }

  /**
   * Groups similar items based on a threshold.
   * Uses a "row-based threshold" approach for clustering.
   * @param items - The items to cluster.
   * @returns A promise that resolves to an array of clusters, where each cluster is an array of strings.
   */
  public async groupSimilar(items: T[]): Promise<string[][]> {
    this.logger.info(
      `Clustering ${items.length} item(s) via threshold-based approach...`,
    );

    try {
      // 1) Transform items to strings
      const stringItems = items.map(this.toStringFn);

      // 2) Generate embeddings
      const embeddings = await this.generateEmbeddings(stringItems);

      // 3) Build NxN similarity matrix
      const simMatrix = this.buildSimilarityMatrix(embeddings);

      // 4) Cluster items based on strings
      const clusters: string[][] = [];
      const addedIndices = new Set<number>();

      for (let i = 0; i < items.length; i++) {
        if (addedIndices.has(i)) continue;

        const cluster: string[] = [stringItems[i]]; // Use stringItems for clustering
        addedIndices.add(i);

        for (let j = 0; j < items.length; j++) {
          if (j !== i && !addedIndices.has(j)) {
            if (simMatrix[i][j] >= this.similarityThreshold) {
              cluster.push(stringItems[j]); // Use stringItems for clustering
              addedIndices.add(j);
            }
          }
        }

        clusters.push(cluster);
      }

      this.logger.impt(
        `Clustering complete. Total clusters: ${clusters.length}`,
      );
      return clusters;
    } catch (err) {
      this.logger.error(`groupSimilar error: ${(err as Error).message}`);
      throw err;
    }
  }

  /**
   * Generates embeddings for an array of strings.
   *
   * @param strings - A list of strings for which to generate embeddings.
   * @returns A 2D array of embeddings, where each sub-array is a vector of numbers.
   */
  private async generateEmbeddings(strings: string[]): Promise<number[][]> {
    this.logger.info(`Generating embeddings for ${strings.length} item(s)...`);
    const embeddings = await Promise.all(
      strings.map(async (text) => {
        const output = await this.extractor(text, {
          pooling: "mean",
          normalize: true,
        });
        return Array.from(output.data) as number[];
      }),
    );
    return embeddings;
  }

  /**
   * Constructs a symmetric NxN matrix of cosine similarities from the given embeddings.
   *
   * @param embeddings - A 2D array where each sub-array is an embedding vector.
   * @returns A 2D array representing the similarity matrix, where each element (i, j)
   *          is the cosine similarity between the embeddings at index i and j.
   */

  private buildSimilarityMatrix(embeddings: number[][]): number[][] {
    const n = embeddings.length;
    const simMatrix: number[][] = Array.from(
      { length: n },
      () => new Array(n).fill(0),
    );

    for (let i = 0; i < n; i++) {
      for (let j = i; j < n; j++) {
        const sim = this.cosineSimilarity(embeddings[i], embeddings[j]);
        simMatrix[i][j] = sim;
        simMatrix[j][i] = sim;
      }
    }

    return simMatrix;
  }

  /**
   * Computes cosine similarity between two embeddings.
   * @param a - The first embedding
   * @param b - The second embedding
   * @returns The cosine similarity between the two embeddings (0 <= sim <= 1)
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    const dotProduct = a.reduce((sum, val, idx) => sum + val * b[idx], 0);
    const normA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    const normB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
    return normA * normB === 0 ? 0 : dotProduct / (normA * normB);
  }
}
