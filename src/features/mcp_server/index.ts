/** Public API of the mcp_server slice: other slices import from here, never from its internals. */
export * from './domain/mcp_types.js';
export * from './infrastructure/mcp_server_factory.js';
export * from './infrastructure/mcp_stdio_server.js';
export * from './infrastructure/prompt_catalog.js';
export * from './infrastructure/stack_detector.js';
export * from './services/tool_registry.js';
