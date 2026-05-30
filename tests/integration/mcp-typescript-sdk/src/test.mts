// Integration-test entry for @gjsify/integration-mcp-typescript-sdk.
// Builds once per runtime (gjs/node) via `gjsify build src/test.mts`.
//
// No explicit `@gjsify/node-globals/register` — `gjsify build` defaults to
// `--globals auto`, scanning the bundled output and injecting only the
// granular /register subpaths actually referenced.

import { run } from '@gjsify/unit';
import protocolSuite from './protocol.spec.js';
import toolSuite from './tool.spec.js';
import resourceSuite from './resource.spec.js';
import promptSuite from './prompt.spec.js';
import streamableHttpSuite from './streamable-http.spec.js';
import inMemoryTransportSuite from './in-memory-transport.spec.js';
import stdioBufferSuite from './stdio-buffer.spec.js';
import uriTemplateSuite from './uri-template.spec.js';
import toolNameValidationSuite from './tool-name-validation.spec.js';
import stdioSubprocessSuite from './stdio-subprocess.spec.js';
import serverInitiatedRequestsSuite from './server-initiated-requests.spec.js';
import cancellationProgressSuite from './cancellation-progress.spec.js';

run({
    protocolSuite,
    toolSuite,
    resourceSuite,
    promptSuite,
    streamableHttpSuite,
    inMemoryTransportSuite,
    stdioBufferSuite,
    uriTemplateSuite,
    toolNameValidationSuite,
    stdioSubprocessSuite,
    serverInitiatedRequestsSuite,
    cancellationProgressSuite,
});
