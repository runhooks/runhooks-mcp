#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

// Runhooks MCP server (stdio transport). Launched locally by an MCP client
// (Claude Desktop, Cursor, …) which spawns this process and speaks MCP over
// stdin/stdout — so nothing here may write to stdout except the transport.
async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  // stderr is safe; stdout is reserved for the protocol.
  console.error('[runhooks-mcp] fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
