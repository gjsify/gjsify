// Integration-test entry for @gjsify/integration-streamx.
// Builds once per runtime (gjs/node) via `gjsify build src/test.mts`.
//
// streamx's fast scheduling path requires timers with GLib.Source GC and
// queueMicrotask (it falls back to process.nextTick if queueMicrotask is
// undefined).
//
// No explicit `@gjsify/node-globals/register` — `gjsify build` defaults to
// `--globals auto`, scanning the bundled output and injecting only the
// granular /register subpaths actually referenced (timers, microtask here).

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
