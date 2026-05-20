// Integration-test entry for @gjsify/integration-execa.
// Builds once per runtime (gjs/node) via `gjsify build src/test.mts`.
//
// execa spawns subprocesses via node:child_process (→ @gjsify/child_process
// under GJS, which wraps Gio.Subprocess), so the standard timers +
// EventEmitter wiring needs to be in place before any execa call.
//
// No explicit `@gjsify/node-globals/register` — `gjsify build` defaults to
// `--globals auto`, scanning the bundled output and injecting only the
// granular /register subpaths actually referenced (process, timers,
// queueMicrotask here).

import { run } from '@gjsify/unit';
import basicSpawnSuite from './basic-spawn.spec.js';
import outputCaptureSuite from './output-capture.spec.js';
import errorHandlingSuite from './error-handling.spec.js';
import syncSuite from './sync.spec.js';

run({
    basicSpawnSuite,
    outputCaptureSuite,
    errorHandlingSuite,
    syncSuite,
});
