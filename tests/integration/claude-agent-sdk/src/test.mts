// Integration-test entry for @gjsify/integration-claude-agent-sdk.
//
// Tests @anthropic-ai/claude-agent-sdk on both runtimes (Node baseline + GJS):
//   - smoke: module-level import, well-known constants, AbortError class
//   - in-memory-store: InMemorySessionStore CRUD + test helpers
//   - session-summary: foldSessionSummary pure-function behaviour
//   - mcp-server: createSdkMcpServer + tool + zod v4 + MCP protocol round-trip
//   - session-fs: filesystem session readers over node:fs/os/path + process.env
//
// No Claude API key or network access is required.  The suites avoid the parts
// of the SDK that spawn the `claude` binary; everything tested is pure-JS, MCP
// in-process, or filesystem I/O — which is exactly the surface that stresses
// @gjsify's Node API implementations.
//
// `gjsify build` injects Node.js globals automatically (--globals auto).

import { run } from '@gjsify/unit';
import smokeSuite from './smoke.spec.js';
import inMemoryStoreSuite from './in-memory-store.spec.js';
import sessionSummarySuite from './session-summary.spec.js';
import mcpServerSuite from './mcp-server.spec.js';
import sessionFsSuite from './session-fs.spec.js';
import disposeSuite from './dispose.spec.js';

run({
    smokeSuite,
    inMemoryStoreSuite,
    sessionSummarySuite,
    mcpServerSuite,
    sessionFsSuite,
    disposeSuite,
});
