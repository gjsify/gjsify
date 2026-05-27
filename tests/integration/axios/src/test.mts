// Integration-test entry for @gjsify/integration-axios.
// Builds once per runtime (gjs/node) via `gjsify build src/test.mts`.
//
// No explicit `@gjsify/node-globals/register` — `gjsify build` defaults to
// `--globals auto`, scanning the bundled output and injecting only the
// granular /register subpaths actually referenced.

import { run } from '@gjsify/unit';

import basicSuite from './basic.spec.js';
import headersSuite from './headers.spec.js';
import timeoutSuite from './timeout.spec.js';
import redirectsSuite from './redirects.spec.js';
import compressionSuite from './compression.spec.js';
import streamsSuite from './streams.spec.js';
import abortSuite from './abort.spec.js';

run({ basicSuite, headersSuite, timeoutSuite, redirectsSuite, compressionSuite, streamsSuite, abortSuite });
