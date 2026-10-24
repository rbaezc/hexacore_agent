import { analyze } from './text_analyzer.js';

export interface CorpusStats {
  totalDocuments: number;
  averageDocumentLength: number;
  /** Number of corpus documents (sections) each term appears in at least once. */
  documentFrequency: Map<string, number>;
}

export class HybridRagScorer {
  private static readonly K1 = 1.2;
  private static readonly B = 0.75;
  private static readonly HEADING_MATCH_MULTIPLIER = 3.0;

  /** Accent-folded, stop-word-filtered, stemmed tokens (English + Spanish). */
  static tokenize(text: string): string[] {
    return analyze(text);
  }

  /** Computes real corpus-wide document frequency + average length, the inputs real BM25 IDF needs. */
  static buildCorpusStats(sections: { heading: string; content: string }[]): CorpusStats {
    const documentFrequency = new Map<string, number>();
    let totalLength = 0;

    for (const section of sections) {
      const tokens = this.tokenize(`${section.heading} ${section.content}`);
      totalLength += tokens.length;
      for (const token of new Set(tokens)) {
        documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1);
      }
    }

    return {
      totalDocuments: sections.length,
      averageDocumentLength: sections.length > 0 ? totalLength / sections.length : 0,
      documentFrequency,
    };
  }

  /** `queryTokens` may be raw words or already-tokenized terms; both are normalized the same way. */
  static calculateScore(queryTokens: string[], heading: string, content: string, stats: CorpusStats): number {
    const terms = [...new Set(queryTokens.flatMap((t) => this.tokenize(t)))];
    if (terms.length === 0 || stats.totalDocuments === 0) return 0;

    const docTokens = this.tokenize(`${heading} ${content}`);
    const headingTokens = new Set(this.tokenize(heading));
    const docLen = docTokens.length;
    const termFrequency = new Map<string, number>();
    for (const token of docTokens) {
      termFrequency.set(token, (termFrequency.get(token) || 0) + 1);
    }

    let totalScore = 0;
    for (const token of terms) {
      const tf = termFrequency.get(token) || 0;
      if (tf === 0) continue;

      // Robertson-Walker IDF over real corpus document frequency (never negative for df <= N).
      const df = stats.documentFrequency.get(token) || 0;
      const idf = Math.log(1 + (stats.totalDocuments - df + 0.5) / (df + 0.5));

      const numerator = tf * (this.K1 + 1);
      const denominator = tf + this.K1 * (1 - this.B + this.B * (docLen / (stats.averageDocumentLength || 1)));
      const bm25TermScore = idf * (numerator / denominator);

      totalScore += bm25TermScore * (headingTokens.has(token) ? this.HEADING_MATCH_MULTIPLIER : 1.0);
    }

    return parseFloat(totalScore.toFixed(3));
  }
}
