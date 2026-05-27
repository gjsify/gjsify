// Integration-test entry for @gjsify/integration-chokidar.
// Builds once per runtime (gjs/node) via `gjsify build src/test.mts`.
//
// chokidar drives the file-watching surface (`fs.watch` + `fs.stat`) of every
// modern TypeScript-aware dev tool — Vite, Rolldown, esbuild --watch, tsc --watch.
// This suite is the first real-world end-to-end consumer of @gjsify/fs's
// FSWatcher (Gio.FileMonitor-backed) implementation under GJS, complementary
// to the per-package unit tests in packages/node/fs/src/watch.spec.ts.
//
// No explicit `@gjsify/node-globals/register` — `gjsify build` defaults to
// `--globals auto`, scanning the bundled output and injecting only the
// granular /register subpaths actually referenced (timers, process here).

import { run } from '@gjsify/unit';
import basicEventsSuite from './basic-events.spec.js';
import recursiveWatchSuite from './recursive-watch.spec.js';
import ignoredSuite from './ignored.spec.js';
import awaitWriteFinishSuite from './await-write-finish.spec.js';

run({
    basicEventsSuite,
    recursiveWatchSuite,
    ignoredSuite,
    awaitWriteFinishSuite,
});
