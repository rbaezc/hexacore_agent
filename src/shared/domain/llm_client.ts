/**
 * Minimal port to a language model. HexaCore never embeds an API key: in MCP mode the
 * implementation delegates to the connected client via sampling (`sampling/createMessage`).
 */
export interface LlmClient {
  complete(request: { system: string; prompt: string; maxTokens: number }): Promise<string>;
}
