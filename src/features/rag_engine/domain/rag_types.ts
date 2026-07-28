export interface KnowledgeDoc {
  filePath: string;
  title: string;
  content: string;
  sections: { heading: string; content: string }[];
}

export interface RuleSnippet {
  sourceDoc: string;
  heading: string;
  content: string;
  score: number;
}

export interface SearchResult {
  query: string;
  snippets: RuleSnippet[];
  injectedContext: string;
}
