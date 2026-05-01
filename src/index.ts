#!/usr/bin/env node
// `Server` is JSDoc-deprecated in @modelcontextprotocol/sdk in favor of
// `McpServer`, but the high-level API only accepts Zod schemas — our 32
// tool definitions are hand-rolled JSON Schemas. The SDK note explicitly
// permits `Server` "for advanced use cases" like ours. Revisit if/when
// the SDK exposes a JSON-Schema path on McpServer.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { tools, handlers } from './vikunja/index.js';

const server = new Server(
  {
    name: 'vikunja-mcp',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async request => {
  if (!request.params.name) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: 'Tool name is required',
        },
      ],
    };
  }

  const handler = handlers[request.params.name];
  if (!handler) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `Tool "${request.params.name}" not found`,
        },
      ],
    };
  }

  try {
    const result = await handler(request);
    return result;
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `Error handling tool "${request.params.name}": ${error}`,
        },
      ],
    };
  }
});

async function main() {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  } catch {
    process.exit(1);
  }
}

main();
