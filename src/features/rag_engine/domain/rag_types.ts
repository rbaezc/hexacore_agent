/** bundled = ships with HexaCore; project = the workspace's own rules; decision = an ADR. */
export type KnowledgeSource = 'bundled' | 'project' | 'decision';

export interface KnowledgeDoc {
  filePath: string;
  title: string;
  source: KnowledgeSource;
  content: string;
  sections: { heading: string; content: string }[];
}

export interface RuleSnippet {
  sourceDoc: string;
  source: KnowledgeSource;
  heading: string;
  content: string;
  score: number;
}

export interface SearchResult {
  query: string;
  snippets: RuleSnippet[];
  injectedContext: string;
}
