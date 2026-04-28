// MCP Client example — spawns a stdio server and invokes its tools, resources, and prompts.
// Runs on both Node.js and GJS via @gjsify/*.
//
// Usage:
//   node dist/index.node.mjs
//   gjsify run dist/index.gjs.mjs
//
// Prerequisites: build cli-mcp-server first (yarn build in ../cli-mcp-server)

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  // Determine the server script path.
  // When built, the server is at ../cli-mcp-server/dist/index.node.mjs (relative to this file's src).
  // In practice, resolve from the workspace root.
  const serverScript = resolve(__dirname, '..', '..', 'cli-mcp-server', 'dist', 'index.node.mjs');

  console.log('Starting MCP client...');
  console.log(`Server script: ${serverScript}`);

  const client = new Client({
    name: 'gjsify-example-client',
    version: '1.0.0',
  });

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverScript],
  });

  await client.connect(transport);
  console.log('Connected to MCP server.\n');

  // --- List tools ---
  const { tools } = await client.listTools();
  console.log('Available tools:', tools.map(t => t.name).join(', '));

  // --- Call echo tool ---
  const echoResult = await client.callTool({
    name: 'echo',
    arguments: { message: 'Hello from gjsify MCP client!' },
  });
  console.log('\necho result:', (echoResult.content as any)[0].text);

  // --- Call add tool ---
  const addResult = await client.callTool({
    name: 'add',
    arguments: { a: 17, b: 25 },
  });
  console.log('add result:', (addResult.content as any)[0].text);

  // --- List resources ---
  const { resources } = await client.listResources();
  console.log('\nAvailable resources:', resources.map(r => `${r.name} (${r.uri})`).join(', '));

  // --- Read resource ---
  const resourceResult = await client.readResource({ uri: 'info://server' });
  console.log('server-info:', (resourceResult.contents[0] as any).text);

  // --- List prompts ---
  const { prompts } = await client.listPrompts();
  console.log('\nAvailable prompts:', prompts.map(p => p.name).join(', '));

  // --- Get prompt ---
  const promptResult = await client.getPrompt({
    name: 'greet',
    arguments: { name: 'GJS Developer' },
  });
  console.log('greet prompt:', (promptResult.messages[0].content as any).text);

  // --- Cleanup ---
  console.log('\nDone. Closing client...');
  await client.close();
  process.exit(0);
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
