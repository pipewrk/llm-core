/**
 * Computes cosine similarity between two equal-length embedding vectors.
 * Returns a value in [0, 1]. Zero-vectors yield 0 similarity.
 *
 * @param a  First embedding vector (e.g. number[])
 * @param b  Second embedding vector
 * @returns  Cosine similarity = (a·b)/(‖a‖‖b‖)
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let sumSqA = 0;
  let sumSqB = 0;

  for (let i = 0; i < n; i++) {
    const ai = a[i];
    const bi = b[i];
    dot += ai * bi;
    sumSqA += ai * ai;
    sumSqB += bi * bi;
  }

  if (sumSqA === 0 || sumSqB === 0) {
    return 0; // explicitly zero similarity on zero-vector
  }

  return dot / Math.sqrt(sumSqA * sumSqB);
}
