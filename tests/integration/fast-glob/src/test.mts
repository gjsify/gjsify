// Integration-test entry for @gjsify/integration-fast-glob.
// Builds once per runtime (gjs/node) via `gjsify build src/test.mts`.
//
// @gjsify/node-globals/register pins timers + queueMicrotask and registers
// process — fast-glob uses path/fs heavily and reads process.cwd() through
// internal helpers.

import '@gjsify/node-globals/register';
import { run } from '@gjsify/unit';
import basicPatternsSuite from './basic-patterns.spec.js';
import globVsStreamSuite from './glob-vs-stream.spec.js';
import cwdAndAbsoluteSuite from './cwd-and-absolute.spec.js';
import dotAndHiddenSuite from './dot-and-hidden.spec.js';
import symlinksSuite from './symlinks.spec.js';

run({
  basicPatternsSuite,
  globVsStreamSuite,
  cwdAndAbsoluteSuite,
  dotAndHiddenSuite,
  symlinksSuite,
});
