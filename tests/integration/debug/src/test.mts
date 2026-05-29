// Integration-test entry for @gjsify/integration-debug.
// Builds once per runtime (gjs/node) via `gjsify build src/test.mts`.
//
// `debug` exercises the TTY-color-aware stderr write path that
// Express / socket.io / eslint pull through on every log call.
// On GJS this routes through @gjsify/process (process.stderr.write,
// process.stderr.fd), @gjsify/tty (isatty), and @gjsify/util
// (formatWithOptions + inspect). Each spec swaps process.stderr.write
// for a capturing stub instead of relying on the runner's actual TTY
// state — same trick as debug's own test.node.js sinon-stub pattern.
//
// No explicit `@gjsify/node-globals/register` — `gjsify build`
// defaults to `--globals auto`, scanning the bundled output and
// injecting only the granular /register subpaths actually referenced
// (process here).

import { run } from '@gjsify/unit';
import enableDisableSuite from './enable-disable.spec.js';
import formatSuite from './format.spec.js';
import outputSuite from './output.spec.js';

run({
    enableDisableSuite,
    formatSuite,
    outputSuite,
});
