#!/usr/bin/env node
import { createHexaCore } from '../composition_root.js';
import { createToolRegistry } from '../features/mcp_server/infrastructure/mcp_server_factory.js';
import { HexaCoreMcpServer } from '../features/mcp_server/infrastructure/mcp_stdio_server.js';
import { getPackageVersion } from '../shared/infrastructure/package_info.js';

async function bootstrap() {
  const services = createHexaCore();
  const server = new HexaCoreMcpServer(createToolRegistry(services), services, getPackageVersion());
  await server.start();
}

bootstrap().catch((err) => {
  // stdout belongs to the MCP protocol; diagnostics must go to stderr.
  console.error('HexaCore MCP Server Error:', err);
  process.exit(1);
});
