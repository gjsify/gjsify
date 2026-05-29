// Integration-test entry for @gjsify/integration-chalk.
// Builds once per runtime (gjs/node) via `gjsify build src/test.mts`.
//
// chalk is the universal terminal-color npm package. It calls into the
// vendored supports-color which probes `process.stdout.isTTY`, `process.env`
// (TERM, COLORTERM, CI, FORCE_COLOR, NO_COLOR, …) and `tty.WriteStream`
// — the @gjsify/{tty,process} surface. We pin chalk.level explicitly per
// suite so the assertions are deterministic across environments (CI strips
// TTYs, local terminals may set COLORTERM=truecolor); the underlying
// detection path is exercised by the package's own unit tests, and any
// supports-color regression would surface here as well as soon as a level
// is read without being set.
//
// No explicit `@gjsify/node-globals/register` — `gjsify build` defaults to
// `--globals auto`, scanning the bundled output and injecting only the
// granular /register subpaths actually referenced (process, tty here).

import { run } from '@gjsify/unit';
import basicSuite from './basic.spec.js';
import templatesSuite from './templates.spec.js';
import levelSuite from './level.spec.js';

run({
    basicSuite,
    templatesSuite,
    levelSuite,
});
