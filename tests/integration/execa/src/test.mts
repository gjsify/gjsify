// Integration-test entry for @gjsify/integration-execa.
// Builds once per runtime (gjs/node) via `gjsify build src/test.mts`.
//
// @gjsify/node-globals/register pins timers + queueMicrotask and
// registers process — execa spawns subprocesses via node:child_process
// (→ @gjsify/child_process under GJS, which wraps Gio.Subprocess), so
// the standard timers + EventEmitter wiring needs to be in place before
// any execa call.

import '@gjsify/node-globals/register';
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
