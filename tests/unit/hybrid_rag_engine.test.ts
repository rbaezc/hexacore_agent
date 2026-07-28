import { describe, it, expect } from 'vitest';
import { HybridRagScorer } from '../../src/features/rag_engine/services/hybrid_rag_engine.js';
import { KnowledgeDoc } from '../../src/features/rag_engine/domain/rag_types.js';

describe('HybridRagScorer (BM25 Algorithm)', () => {
  const mockDoc: KnowledgeDoc = {
    filePath: '/docs/vertical_slice.md',
    title: 'Vertical Slice Architecture',
    content: 'Each slice must be isolated.',
    sections: [{ heading: 'Vertical Slicing', content: 'Each slice must be isolated.' }],
  };

  it('should score heading matches higher than generic body content', () => {
    const headingScore = HybridRagScorer.calculateScore(
      ['slicing', 'vertical'],
      mockDoc,
      'Vertical Slicing',
      'Design rules'
    );
    const bodyScore = HybridRagScorer.calculateScore(
      ['slicing', 'vertical'],
      mockDoc,
      'General Info',
      'Mentions about vertical slicing'
    );

    expect(headingScore).toBeGreaterThan(bodyScore);
  });

  it('should return 0 score for unmatched query terms', () => {
    const score = HybridRagScorer.calculateScore(
      ['unrelated', 'keyword'],
      mockDoc,
      'Vertical Slicing',
      'Each slice must be isolated'
    );
    expect(score).toBe(0);
  });
});
