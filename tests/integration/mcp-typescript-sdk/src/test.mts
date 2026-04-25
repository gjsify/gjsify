// Integration-test entry for @gjsify/integration-mcp-typescript-sdk.
// Builds once per runtime (gjs/node) via `gjsify build src/test.mts`.

import '@gjsify/node-globals/register';
import { run } from '@gjsify/unit';
import protocolSuite from './protocol.spec.js';
import toolSuite from './tool.spec.js';
import resourceSuite from './resource.spec.js';
import promptSuite from './prompt.spec.js';

run({
  protocolSuite,
  toolSuite,
  resourceSuite,
  promptSuite,
});
