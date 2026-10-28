// Node-gi test entry — runs @gjsify/sqlite's OWN GJS test suite under the
// @gjsify/node-gi reverse bridge on Node (ADR-0005 "second real consumer"
// graduation-gate item; consumer #1 is `gjsify storybook --runtime node`).
//
// HOW IT WIRES UP (build with `gjsify build src/test.node-gi.mts --app node
// --alias node:sqlite=@gjsify/sqlite`):
//   • `--alias node:sqlite=@gjsify/sqlite` retargets the specs'
//     `import { DatabaseSync } from 'node:sqlite'` onto the GI-backed POLYFILL
//     — the exact module the `--app gjs` target tests — instead of Node's own
//     experimental `node:sqlite`. Without it the node target would test native
//     Node (useless for proving node-gi runs GJS code).
//   • The bare `print(...)` banner below references a GJS ambient global, the
//     genuine-GJS-source signal the CLI's `detectNodeGiGlobals` looks for. It
//     flips `nodeGiGlobalsInject` on, so (a) `@gjsify/node-gi/globals` is
//     auto-injected (seeding `print`/`imports`/… before this file runs) and
//     (b) `@gjsify/sqlite-native` / `@girs/glib-2.0` / `@girs/gobject-2.0`
//     resolve to their real bodies whose inner `gi://GjsifySqlite?version=1.0`
//     etc. are rewritten to `requireGi('GjsifySqlite','1.0')` by the L2
//     `gjsGiNodePlugin`. Net: the polyfill's libsqlite3 bridge runs on Node
//     through node-gi.
//
// sqlite's `DatabaseSync`/`StatementSync` API is fully SYNCHRONOUS (the bridge
// wraps sqlite3's own blocking calls), so — unlike an async-Gio consumer — it
// needs NO GLib main-loop pumping and the WHOLE suite runs under node-gi. It
// reuses the package's existing spec suites VERBATIM — same assertions as
// `test:gjs`: connection lifecycle, prepare, param binding, SQL validation,
// error handling, option validation, typed column reads, AND the BLOB
// round-trip through `GLib.Bytes`.
//
// One thing this leg sees that the gjs leg cannot: node-gi's `GLib.Error` is a
// real `Error` SUBCLASS (`class GLibError extends Error`), while GJS's is a
// boxed value. Any "is this error already Node-shaped?" test written as
// `e instanceof Error` therefore answers differently here — measured: the gjs
// leg stayed 84/84 green while three tests went red on this one. The predicate
// that has to be used instead is `isNodeSqliteError()` in `errors.ts`.
import { run } from '@gjsify/unit';

import testSuiteDatabaseSync from './database-sync.spec.js';
import testSuiteErrors from './errors.spec.js';
import testSuiteStatementSync from './statement-sync.spec.js';
import testSuiteDataTypes from './data-types.spec.js';
import testSuiteStatementCache from './statement-cache.spec.js';

// Bare GJS ambient global — the node-gi-source signal (see header). Seeded by
// the auto-injected `@gjsify/node-gi/globals` shim.
// oxlint-disable-next-line no-restricted-globals -- deliberate: the bare `print` IS the trigger `detectNodeGiGlobals` keys the `@gjsify/node-gi/globals` injection on (scripts/node-gi-consumer-harness.mjs)
print('sqlite suite on @gjsify/node-gi (libsqlite3 via GjsifySqlite on Node)');

// ── BLOB (byte-array) round-trip ─────────────────────────────────────────────
// A BLOB crosses the bridge as a `GLib.Bytes`, which node-gi has to hand back
// as a boxed handle whose fields read like GJS's. The duck-typing this once
// provoked is the reason it is called out: node-gi's boxed-handle Proxy used to
// fabricate a method for ANY name, so a `typeof value.toArray === 'function'`
// check matched a method that did not exist, the call threw, and the row read
// as `undefined`. Fixed in @gjsify/node-gi's boxed Proxy (gi.js) — a name that
// is neither a method nor a field now yields `undefined`, matching GJS.
run({ testSuiteDatabaseSync, testSuiteErrors, testSuiteStatementSync, testSuiteDataTypes, testSuiteStatementCache });
