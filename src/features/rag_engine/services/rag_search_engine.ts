import * as path from 'node:path';
import { IFileSystem } from '../../../shared/infrastructure/file_system.js';
import { Result, ok, fail } from '../../../shared/domain/result.js';
import { KnowledgeDoc, RuleSnippet, SearchResult } from '../domain/rag_types.js';
import { HybridRagScorer } from './hybrid_rag_engine.js';

export class RagSearchEngine {
  constructor(
    private readonly fileSystem: IFileSystem,
    private readonly docsDir: string = path.join(process.cwd(), 'docs')
  ) {}

  async searchRules(query: string, topK: number = 3): Promise<Result<SearchResult, Error>> {
    try {
      const docs = await this.loadKnowledgeBase();
      const indexed = docs.flatMap((doc) => doc.sections.map((section) => ({ doc, section })));
      const stats = HybridRagScorer.buildCorpusStats(indexed.map((i) => i.section));
      const queryTokens = HybridRagScorer.tokenize(query);

      const snippets: RuleSnippet[] = [];
      for (const { doc, section } of indexed) {
        const score = HybridRagScorer.calculateScore(queryTokens, section.heading, section.content, stats);
        if (score > 0) {
          snippets.push({
            sourceDoc: doc.filePath,
            heading: section.heading,
            content: section.content,
            score,
          });
        }
      }

      snippets.sort((a, b) => b.score - a.score);
      const topSnippets = snippets.slice(0, topK);

      const injectedContext = topSnippets
        .map((s) => `### Rule extracted from [${path.basename(s.sourceDoc)} > ${s.heading}]:\n${s.content}`)
        .join('\n\n');

      return ok({
        query,
        snippets: topSnippets,
        injectedContext,
      });
    } catch (error: any) {
      return fail(new Error(`RAG search failed: ${error.message}`));
    }
  }

  private async loadKnowledgeBase(): Promise<KnowledgeDoc[]> {
    const files = await this.fileSystem.listDirectory(this.docsDir);
    const mdFiles = files.filter((f) => f.endsWith('.md'));
    const docs: KnowledgeDoc[] = [];

    for (const filePath of mdFiles) {
      const content = await this.fileSystem.readFile(filePath);
      const sections = this.parseSections(content);
      const title = sections[0]?.heading || path.basename(filePath);
      docs.push({ filePath, title, content, sections });
    }

    return docs;
  }

  private parseSections(markdown: string): { heading: string; content: string }[] {
    const lines = markdown.split(/\r?\n/);
    const sections: { heading: string; content: string }[] = [];
    let currentHeading = 'General';
    let currentContent: string[] = [];

    for (const line of lines) {
      if (line.startsWith('#')) {
        if (currentContent.length > 0) {
          sections.push({ heading: currentHeading, content: currentContent.join('\n').trim() });
          currentContent = [];
        }
        currentHeading = line.replace(/^#+\s*/, '').trim();
      } else {
        currentContent.push(line);
      }
    }

    if (currentContent.length > 0) {
      sections.push({ heading: currentHeading, content: currentContent.join('\n').trim() });
    }

    return sections;
  }
}
