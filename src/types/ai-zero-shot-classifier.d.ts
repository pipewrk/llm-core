// src/types/ai-zero-shot-classifier.d.ts

declare module "ai-zero-shot-classifier" {
  export interface ClassificationResult {
    label: string;
    score: number;
  }

  export interface ClassifyOptions {
    similarity?: "cosine" | "dot" | string;
  }

  export interface ZeroShotClassifierConfig {
    provider: string;
    model: string;
    apiKey?: string;
    labels: string[];
  }

  export class ZeroShotClassifier {
    constructor(config: ZeroShotClassifierConfig);
    classify(
      inputs: string[],
      options?: ClassifyOptions
    ): Promise<ClassificationResult[]>;
  }

  export function classify(
    inputs: string[],
    labels: string[],
    model?: string
  ): Promise<ClassificationResult[]>;
}
