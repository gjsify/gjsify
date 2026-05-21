// Integration-test entry for @gjsify/integration-yargs.
// Builds once per runtime (gjs/node) via `gjsify build src/test.mts`.
//
// yargs v18 is pure ESM; it pulls in cliui, escalade, get-caller-file,
// string-width, y18n and yargs-parser.

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
