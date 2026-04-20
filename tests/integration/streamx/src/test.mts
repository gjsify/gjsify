// Integration-test entry for @gjsify/integration-streamx.
// Builds once per runtime (gjs/node) via `gjsify build src/test.mts`.
//
// @gjsify/node-globals/register pins timers with GLib.Source GC and
// registers queueMicrotask — required for streamx's fast scheduling path
// (streamx falls back to process.nextTick if queueMicrotask is undefined).

import '@gjsify/node-globals/register';
import { run } from '@gjsify/unit';
import readableSuite from './readable.spec.js';
import writableSuite from './writable.spec.js';
import transformSuite from './transform.spec.js';
import pipelineSuite from './pipeline.spec.js';
import duplexSuite from './duplex.spec.js';
import throughputSuite from './throughput.spec.js';

run({
  readableSuite,
  writableSuite,
  transformSuite,
  pipelineSuite,
  duplexSuite,
  throughputSuite,
});
