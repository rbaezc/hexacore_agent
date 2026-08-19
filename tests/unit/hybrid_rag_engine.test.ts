import { describe, it, expect } from 'vitest';
import { HybridRagScorer } from '../../src/features/rag_engine/services/hybrid_rag_engine.js';

describe('HybridRagScorer (BM25 with corpus-wide IDF)', () => {
  const corpusSections = [
    { heading: 'Vertical Slicing', content: 'Each slice must be isolated.' },
    { heading: 'General Info', content: 'Mentions about vertical slicing.' },
    { heading: 'Database Rules', content: 'Foreign keys are mandatory for relational tables.' },
  ];
  const stats = HybridRagScorer.buildCorpusStats(corpusSections);

  it('should score heading matches higher than generic body content', () => {
    const headingScore = HybridRagScorer.calculateScore(['slicing', 'vertical'], 'Vertical Slicing', 'Design rules', stats);
    const bodyScore = HybridRagScorer.calculateScore(['slicing', 'vertical'], 'General Info', 'Mentions about vertical slicing', stats);

    expect(headingScore).toBeGreaterThan(bodyScore);
  });

  it('should return 0 score for unmatched query terms', () => {
    const score = HybridRagScorer.calculateScore(['unrelated', 'keyword'], 'Vertical Slicing', 'Each slice must be isolated', stats);
    expect(score).toBe(0);
  });

  it('should give a rarer corpus-wide term a higher IDF-driven score than a common one', () => {
    // "database" only appears in 1 of 3 sections; a term appearing in all 3 would score lower per-occurrence.
    const commonStats = HybridRagScorer.buildCorpusStats([
      { heading: 'A', content: 'shared shared shared' },
      { heading: 'B', content: 'shared shared shared' },
      { heading: 'C', content: 'shared shared shared' },
    ]);
    const rareStats = HybridRagScorer.buildCorpusStats([
      { heading: 'A', content: 'rare rare rare' },
      { heading: 'B', content: 'other other other' },
      { heading: 'C', content: 'other other other' },
    ]);

    const commonScore = HybridRagScorer.calculateScore(['shared'], 'A', 'shared shared shared', commonStats);
    const rareScore = HybridRagScorer.calculateScore(['rare'], 'A', 'rare rare rare', rareStats);

    expect(rareScore).toBeGreaterThan(commonScore);
  });
});
