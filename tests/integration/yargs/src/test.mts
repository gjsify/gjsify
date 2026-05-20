// Integration-test entry for @gjsify/integration-yargs.
// Builds once per runtime (gjs/node) via `gjsify build src/test.mts`.
//
// yargs v18 is pure ESM; it pulls in cliui, escalade, get-caller-file,
// string-width, y18n and yargs-parser. The relevant @gjsify/* surface for
// this suite is events (Yargs internals + EventEmitter compat),
// util (inspect/format used by yargs error messages), process (argv,
// process.cwd) and the ESM import path itself.
//
// No explicit `@gjsify/node-globals/register` — `gjsify build` defaults to
// `--globals auto`, scanning the bundled output and injecting only the
// granular /register subpaths actually referenced.

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
