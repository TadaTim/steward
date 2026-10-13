/**
 * Deterministic hashing embedder: tokenizes text and projects tokens into a
 * fixed-dimension vector. This is NOT a semantic model — it gives the vault a
 * real, testable vector index whose similarity is lexical. A production
 * deployment would swap in a learned embedding model behind this interface.
 */
export interface Embedder {
  readonly dim: number;
  embed(text: string): number[];
}

export class HashEmbedder implements Embedder {
  readonly dim = 64;
  embed(text: string): number[] {
    const v = new Array<number>(this.dim).fill(0);
    const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    for (const tok of tokens) {
      let h = 2166136261;
      for (let i = 0; i < tok.length; i++) {
        h ^= tok.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      const idx = Math.abs(h) % this.dim;
      v[idx] += 1;
    }
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    return v.map((x) => x / norm);
  }
}

export function cosine(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] ?? 0) * (b[i] ?? 0);
  return s;
}
