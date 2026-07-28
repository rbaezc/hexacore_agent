import { KnowledgeDoc } from '../domain/rag_types.js';

export class HybridRagScorer {
  private static readonly K1 = 1.2;
  private static readonly B = 0.75;
  private static readonly AVG_DOC_LEN = 150;

  static calculateScore(queryTokens: string[], doc: KnowledgeDoc, heading: string, content: string): number {
    if (queryTokens.length === 0) return 0;

    let totalBm25Score = 0;
    const combined = `${heading} ${content}`.toLowerCase();
    const words = combined.split(/\s+/).filter(Boolean);
    const docLen = words.length;

    for (const token of queryTokens) {
      const occurrences = combined.split(token).length - 1;
      if (occurrences === 0) continue;

      // Inverse Document Frequency (IDF) approximation
      const idf = Math.log(1 + 10 / Math.max(1, occurrences));

      // BM25 Term Frequency Saturation
      const numerator = occurrences * (this.K1 + 1);
      const denominator = occurrences + this.K1 * (1 - this.B + this.B * (docLen / this.AVG_DOC_LEN));
      const bm25TermScore = idf * (numerator / denominator);

      // Heading Relevance Multiplier (3.0x for title matches)
      const isHeadingMatch = heading.toLowerCase().includes(token);
      const multiplier = isHeadingMatch ? 3.0 : 1.0;

      totalBm25Score += bm25TermScore * multiplier;
    }

    return parseFloat(totalBm25Score.toFixed(3));
  }
}
