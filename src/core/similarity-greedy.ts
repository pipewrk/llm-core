// similarity-greedy.ts
import { pipeline, type Pipeline, type PipelineStep } from "./pipeline";
import type { Logger } from "src/core/logger";
import { cosineSimilarity } from "./cosine-similarity"

/* ────────────────────────────────────────────────────────────────────────── */
/* Context & stage types                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

export interface SimilarityCtx {
  logger?: Logger;
  embed: (texts: string[]) => Promise<number[][]>;
}

export interface InitDoc {
  texts: string[];
  threshold: number;     // absolute cosine τ
}
export interface EmbeddedDoc extends InitDoc {
  embs: number[][];
}
export interface SimDoc extends InitDoc {
  sim: number[][];
}
export interface ClusterResult {
  clusters: string[][];
}

type Step<I, O> = PipelineStep<I, O, SimilarityCtx>;

/* ────────────────────────────────────────────────────────────────────────── */
/* Steps                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

// 0) Initialise from raw string[] into a typed doc with threshold
export function sInit(threshold = 0.7): Step<string[], InitDoc> {
  return () => (texts) => ({ texts, threshold });
}

// 1) Embed all texts
export const sEmbed: Step<InitDoc, EmbeddedDoc> = (ctx) => async (doc) => {
  ctx.logger?.info?.(`Generating embeddings for ${doc.texts.length} item(s)...`);
  const embs = await ctx.embed(doc.texts);
  return { ...doc, embs };
};

// 2) Build full symmetric cosine matrix
export const sSimMatrix: Step<EmbeddedDoc, SimDoc> = (ctx) => (doc) => {
  const n = doc.embs.length;
  const sim: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const s = cosineSimilarity(doc.embs[i], doc.embs[j]);
      sim[i][j] = s;
      sim[j][i] = s;
    }
  }
  ctx.logger?.info?.(`Built ${n}×${n} similarity matrix`);
  return { texts: doc.texts, threshold: doc.threshold, sim };
};

// 3) Greedy row-threshold clustering (order-sensitive, same as original)
export const sGreedyCluster: Step<SimDoc, ClusterResult> = (ctx) => (doc) => {
  const { texts, sim, threshold } = doc;
  const n = texts.length;

  ctx.logger?.info?.(
    `Clustering ${n} item(s) via greedy row-threshold (τ=${threshold})...`,
  );

  const added = new Set<number>();
  const clusters: string[][] = [];

  for (let i = 0; i < n; i++) {
    if (added.has(i)) continue;

    const cluster: string[] = [texts[i]];
    added.add(i);

    for (let j = 0; j < n; j++) {
      if (j === i || added.has(j)) continue;
      if (sim[i][j] >= threshold) {
        cluster.push(texts[j]);
        added.add(j);
      }
    }
    clusters.push(cluster);
  }

  ctx.logger?.impt?.(`Clustering complete. Total clusters: ${clusters.length}`);
  return { clusters };
};

/* ────────────────────────────────────────────────────────────────────────── */
/* Builder & public API                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

export function buildGreedySimilarityPipeline(
  ctx: SimilarityCtx,
  threshold = 0.7,
): Pipeline<SimilarityCtx, string[], ClusterResult> {
  return pipeline<SimilarityCtx, string[]>(ctx)
    .addStep(sInit(threshold))
    .addStep(sEmbed)
    .addStep(sSimMatrix)
    .addStep(sGreedyCluster);
}

export async function groupSimilarGreedy(
  ctx: SimilarityCtx,
  texts: string[],
  threshold = 0.7,
): Promise<string[][]> {
  const p = buildGreedySimilarityPipeline(ctx, threshold);
  const out = await p.run(texts);
  return out.clusters;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Convenience: if you still have items → strings                            */
/* ────────────────────────────────────────────────────────────────────────── */

export function projectAndGroup<T>(
  ctx: SimilarityCtx,
  items: T[],
  toString: (x: T) => string,
  threshold = 0.7,
) {
  return groupSimilarGreedy(ctx, items.map(toString), threshold);
}
