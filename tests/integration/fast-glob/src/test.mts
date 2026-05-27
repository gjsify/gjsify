// Integration-test entry for @gjsify/integration-fast-glob.
// Builds once per runtime (gjs/node) via `gjsify build src/test.mts`.
//
// fast-glob uses path/fs heavily and reads process.cwd() through
// internal helpers.
//
// No explicit `@gjsify/node-globals/register` — `gjsify build` defaults to
// `--globals auto`, scanning the bundled output and injecting only the
// granular /register subpaths actually referenced.

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
