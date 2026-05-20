// Integration-test entry for @gjsify/integration-yargs.
// Builds once per runtime (gjs/node) via `gjsify build src/test.mts`.
//
// yargs v18 is pure ESM; it pulls in cliui, escalade, get-caller-file,
// string-width, y18n and yargs-parser. The relevant @gjsify/* surface for
// this suite is events (Yargs internals + EventEmitter compat),
// util (inspect/format used by yargs error messages), process (argv,
// process.cwd), URL (cliui's terminal-detect imports it lazily) and the
// ESM import path itself.
//
// Explicit granular `/register` subpaths here (rather than relying on
// `--globals auto`) because this fixture is the one driven by the
// self-host CLI loop (`tests/e2e/self-host/run.mjs`), where the GJS-CLI
// bundle's iterative auto-detection currently misses `URL` for this
// specific input shape. Hard-wiring the registers keeps the self-host
// invariant green; the auto-detection divergence is tracked in STATUS.md.

import '@gjsify/node-globals/register/process';
import '@gjsify/node-globals/register/timers';
import '@gjsify/node-globals/register/url';
import '@gjsify/node-globals/register/encoding';
import '@gjsify/node-globals/register/microtask';
import { run } from '@gjsify/unit';
import parserSuite from './parser.spec.js';
import optionsSuite from './options.spec.js';
import commandsSuite from './commands.spec.js';
import helpSuite from './help.spec.js';
import esmSuite from './esm.spec.js';

run({
    parserSuite,
    optionsSuite,
    commandsSuite,
    helpSuite,
    esmSuite,
});
