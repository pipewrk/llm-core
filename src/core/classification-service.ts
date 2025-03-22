import {ZeroShotClassifier} from 'ai-zero-shot-classifier';
import { MLService } from "./ml-service.ts";

/**
 * AI-powered text classification service using `ai-zero-shot-classifier`.
 */
export class ClassificationService<T> extends MLService<T> {
  private classifier: ZeroShotClassifier;
  private categories: string[];
  private toStringFn: (item: T) => string;

  /**
   * Private constructor to enforce usage of `ClassificationService.instance(...)`.
   *
   * @param classifier - The ZeroShotClassifier instance.
   * @param categories - List of categories to classify against.
   * @param toStringFn - Function to convert `T` into a string for classification.
   */
  protected constructor(
    classifier: ZeroShotClassifier,
    categories: string[],
    toStringFn: (item: T) => string
  ) {
    super();
    this.classifier = classifier;
    this.categories = categories;
    this.toStringFn = toStringFn;
  }

  /**
   * Creates or retrieves a cached instance of `ClassificationService`.
   * Uses the shared caching mechanism from `MLService`.
   *
   * @param provider - AI provider (e.g., "openai" or "groq").
   * @param model - Model name (e.g., "text-embedding-3-small").
   * @param apiKey - API key for authentication.
   * @param categories - Categories to classify against.
   * @param toStringFn - Function to convert `T` into a string for classification.
   */
  public static async instance<T>(
    provider: string,
    model: string,
    apiKey: string,
    categories: string[],
    toStringFn: (item: T) => string
  ): Promise<ClassificationService<T>> {
    return MLService.getInstance(
      `${provider}-${model}-${categories.join(",")}`,
      async () => {
        const classifier = new ZeroShotClassifier({
          provider,
          model,
          apiKey,
          labels: categories, // Set labels for classification
        });

        return new ClassificationService<T>(classifier, categories, toStringFn);
      }
    );
  }

  /**
   * Processes a single item and returns the top predicted category.
   * @param item - The input data to classify.
   * @returns A Promise resolving to `{ category: string; score: number }`.
   */
  public async process(item: T): Promise<{ category: string; score: number }> {
    const text = this.toStringFn(item);

    try {
      const result = await this.classifier.classify([text], { similarity: "cosine" });

      return { category: result[0].label, score: result[0].score };
    } catch (err) {
      throw new Error(`Classification error: ${(err as Error).message}`);
    }
  }

  /**
   * Processes multiple items and returns their classifications.
   * @param items - Array of input data to classify.
   * @returns A Promise resolving to an array of `{ item, category, score }` objects.
   */
  public async processBatch(items: T[]): Promise<{ item: T; category: string; score: number }[]> {
    this.logger.info(`Classifying batch of ${items.length} items...`);
    const texts = items.map(this.toStringFn);

    try {
      const results = await this.classifier.classify(texts, { similarity: "cosine" });

      return results.map((result, index) => ({
        item: items[index],
        category: result.label,
        score: result.score,
      }));
    } catch (err) {
      throw new Error(`Batch classification error: ${(err as Error).message}`);
    }
  }

  /**
   * Groups items by their classified category.
   * @param items - Array of input data to classify.
   * @returns A Promise resolving to a `{ [category]: T[] }` mapping.
   */
  public async groupByCategory(items: T[]): Promise<{ [category: string]: T[] }> {
    this.logger.info(`Grouping ${items.length} items by category...`);

    const results = await this.processBatch(items);
    const grouped: { [category: string]: T[] } = {};

    results.forEach(({ item, category }) => {
      if (!grouped[category]) {
        grouped[category] = [];
      }
      grouped[category].push(item);
    });

    return grouped;
  }
}
