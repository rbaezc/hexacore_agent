import * as path from 'node:path';
import { IFileSystem } from '../../../shared/infrastructure/file_system.js';
import { WorkspaceContext } from '../../../shared/infrastructure/workspace.js';
import { getBundledRulesDir } from '../../../shared/infrastructure/package_info.js';
import { Result, ok, fail } from '../../../shared/domain/result.js';
import { KnowledgeDoc, KnowledgeSource, RuleSnippet, SearchResult } from '../domain/rag_types.js';
import { HybridRagScorer } from './hybrid_rag_engine.js';

export interface KnowledgeRoot {
  dir: string;
  source: KnowledgeSource;
}

/** Project rules take precedence over bundled defaults when scores are close; decisions record why. */
const SOURCE_BOOST: Record<KnowledgeSource, number> = { project: 1.25, decision: 1.15, lesson: 1.1, bundled: 1.0 };

/** Per-document score multiplier (e.g. lesson effectiveness); 0 hides the document. */
export type DocumentBoost = (filePath: string) => number;

export interface RagSearchOptions {
  /** Resolved once per search, so boosts reflect the latest usage evidence. */
  boostProvider?: () => Promise<DocumentBoost>;
}

export class RagSearchEngine {
  private readonly roots: () => KnowledgeRoot[];

  /**
   * Default knowledge roots: HexaCore's bundled rules, plus the workspace's `.hexagen/rules/`
   * and `docs/adr/`. A string argument pins a single directory (kept for tests and tooling).
   */
  constructor(
    private readonly fileSystem: IFileSystem,
    rootsOrWorkspace: string | KnowledgeRoot[] | (() => KnowledgeRoot[]) | WorkspaceContext = new WorkspaceContext(),
    private readonly options: RagSearchOptions = {}
  ) {
    if (typeof rootsOrWorkspace === 'string') {
      this.roots = () => [{ dir: rootsOrWorkspace, source: 'bundled' }];
    } else if (typeof rootsOrWorkspace === 'function') {
      this.roots = rootsOrWorkspace;
    } else if (Array.isArray(rootsOrWorkspace)) {
      this.roots = () => rootsOrWorkspace;
    } else {
      const ws = rootsOrWorkspace;
      this.roots = () => [
        { dir: getBundledRulesDir(), source: 'bundled' },
        { dir: ws.hexagenPath('rules'), source: 'project' },
        { dir: path.join(ws.root, 'docs', 'adr'), source: 'decision' },
        { dir: ws.hexagenPath('skills'), source: 'lesson' },
      ];
    }
  }

  async searchRules(query: string, topK: number = 3): Promise<Result<SearchResult, Error>> {
    try {
      const docs = await this.loadKnowledgeBase();
      const indexed = docs.flatMap((doc) => doc.sections.map((section) => ({ doc, section })));
      const stats = HybridRagScorer.buildCorpusStats(indexed.map((i) => i.section));
      const queryTokens = HybridRagScorer.tokenize(query);
      const boost = (await this.options.boostProvider?.()) ?? (() => 1);

      const snippets: RuleSnippet[] = [];
      for (const { doc, section } of indexed) {
        const score = HybridRagScorer.calculateScore(queryTokens, section.heading, section.content, stats) * boost(doc.filePath);
        if (score > 0) {
          snippets.push({
            sourceDoc: doc.filePath,
            source: doc.source,
            heading: section.heading,
            content: section.content,
            score: parseFloat((score * SOURCE_BOOST[doc.source]).toFixed(3)),
          });
        }
      }

      snippets.sort((a, b) => b.score - a.score);
      const topSnippets = snippets.slice(0, topK);

      const injectedContext = topSnippets
        .map((s) => `### Rule extracted from [${path.basename(s.sourceDoc)} > ${s.heading}] (${s.source}):\n${s.content}`)
        .join('\n\n');

      return ok({ query, snippets: topSnippets, injectedContext });
    } catch (error: any) {
      return fail(new Error(`RAG search failed: ${error.message}`));
    }
  }

  /** Every markdown document across all roots (also served as MCP resources). */
  async loadKnowledgeBase(): Promise<KnowledgeDoc[]> {
    const docs: KnowledgeDoc[] = [];
    for (const root of this.roots()) {
      const files = await this.fileSystem.listDirectory(root.dir);
      for (const filePath of files.filter((f) => f.endsWith('.md'))) {
        const content = await this.fileSystem.readFile(filePath);
        const sections = this.parseSections(content);
        const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim() || path.basename(filePath, '.md');
        docs.push({ filePath, title, source: root.source, content, sections });
      }
    }
    return docs;
  }

  /** Splits on headings, carrying the parent heading so "## Rules" under "# Go" stays findable by "go". */
  private parseSections(markdown: string): { heading: string; content: string }[] {
    const lines = markdown.split(/\r?\n/);
    const sections: { heading: string; content: string }[] = [];
    let title = '';
    let currentHeading = 'General';
    let currentContent: string[] = [];
    let inFence = false;

    const flush = () => {
      const body = currentContent.join('\n').trim();
      if (body) sections.push({ heading: title && title !== currentHeading ? `${title} › ${currentHeading}` : currentHeading, content: body });
      currentContent = [];
    };

    for (const line of lines) {
      if (/^\s*```/.test(line)) inFence = !inFence;
      const heading = !inFence ? line.match(/^(#{1,6})\s+(.*)$/) : null;
      if (heading) {
        flush();
        currentHeading = heading[2].trim();
        if (heading[1].length === 1) title = currentHeading;
      } else {
        currentContent.push(line);
      }
    }
    flush();
    return sections;
  }
}
