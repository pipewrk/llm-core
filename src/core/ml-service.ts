import { withLogger } from "./decorators.ts";
import type { ILogger } from "../types/dataset.ts";

/**
 * Abstract base class for AI-powered services.
 * Ensures logging and standard structure across AI-based implementations.
 */
@withLogger
export abstract class MLService<T> {
  protected readonly logger!: ILogger;
  private static _instances: Map<string, MLService<unknown>> = new Map();

  /**
   * Processes a single item and returns a structured response.
   * Implemented by subclasses with their own processing logic.
   *
   * @param item - The input data to process.
   * @returns A Promise resolving to the processed output.
   */
  abstract process(item: T): Promise<unknown>;

  /**
   * Processes multiple items in parallel.
   *
   * @param items - Array of input data.
   * @returns A Promise resolving to an array of processed outputs.
   */
  async processBatch(items: T[]): Promise<unknown[]> {
    this.logger.info(`Processing batch of ${items.length} items...`);
    return Promise.all(items.map((item) => this.process(item)));
  }

  /**
   * Retrieves or creates a cached instance of a subclass.
   * @param key - Unique identifier for the instance.
   * @param createInstance - Async function that returns a new instance.
   * @returns The cached or newly created instance.
   */
  protected static async getInstance<T, U extends MLService<T>>(
    key: string,
    createInstance: () => Promise<U>
  ): Promise<U> {
    if (MLService._instances.has(key)) {
      return MLService._instances.get(key)! as U;
    }

    const instance = await createInstance();
    MLService._instances.set(key, instance);
    return instance;
  }
}
