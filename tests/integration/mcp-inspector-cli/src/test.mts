// Entry for @gjsify/integration-mcp-inspector-cli.
// Built only for Node via `gjsify build src/test.mts --app node`.
//
// Why Node-only? The harness drives subprocess pipelines (inspector CLI +
// example MCP server). The bundled GJS implementations of `child_process`
// don't expose `proc.stdout`/`proc.stderr` as proper Readable streams, which
// is what we need to parse the inspector's JSON output.
//
// This is fine because the *server* under test is still the GJS build of
// @gjsify/example-node-net-mcp-server — we spawn it via `gjs -m …` regardless
// of where the harness itself runs. The Node harness is only the test driver.
//
// Timeouts are generous because every test spins up a fresh
// @modelcontextprotocol/inspector subprocess (~2 s setup) plus a server
// subprocess. The suite is opt-in (`yarn test:integration`) and not part of
// the default `yarn test`.

import { run } from '@gjsify/unit';
import inspectorCliSuite from './inspector-cli.spec.js';

run({
  inspectorCliSuite,
}, {
  testTimeout: 60_000,
  suiteTimeout: 600_000,
  timeout: 600_000,
});
