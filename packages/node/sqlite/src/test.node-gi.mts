// Node-gi test entry — runs @gjsify/sqlite's OWN GJS test suite under the
// @gjsify/node-gi reverse bridge on Node (ADR-0005 "second real consumer"
// graduation-gate item; consumer #1 is `gjsify storybook --runtime node`).
//
// HOW IT WIRES UP (build with `gjsify build src/test.node-gi.mts --app node
// --alias node:sqlite=@gjsify/sqlite`):
//   • `--alias node:sqlite=@gjsify/sqlite` retargets the specs'
//     `import { DatabaseSync } from 'node:sqlite'` onto the libgda-backed
//     POLYFILL — the exact module the `--app gjs` target tests — instead of
//     Node's own experimental `node:sqlite`. Without it the node target would
//     test native Node (useless for proving node-gi runs GJS code).
//   • The bare `print(...)` banner below references a GJS ambient global, the
//     genuine-GJS-source signal the CLI's `detectNodeGiGlobals` looks for. It
//     flips `nodeGiGlobalsInject` on, so (a) `@gjsify/node-gi/globals` is
//     auto-injected (seeding `print`/`imports`/… before this file runs) and
//     (b) `@girs/gda-6.0` / `@girs/glib-2.0` / `@girs/gobject-2.0` resolve to
//     their real bodies whose inner `gi://Gda?version=6.0` etc. are rewritten to
//     `requireGi('Gda','6.0')` by the L2 `gjsGiNodePlugin`. Net: the polyfill's
//     `Gda.Connection` SQLite surface runs on Node through node-gi.
//
// sqlite's `DatabaseSync`/`StatementSync` API is fully SYNCHRONOUS (libgda
// `open`/`execute` are blocking), so — unlike an async-Gio consumer — it needs
// NO GLib main-loop pumping and the WHOLE suite runs under node-gi. It reuses
// the package's existing spec suites VERBATIM — same assertions as `test:gjs`.
// Result: ALL 52 tests pass (connection lifecycle, prepare, param binding,
// SQL/parser validation, error handling, option validation, scalar result-row
// reading via `Gda.DataModel.get_value_at()` whose GValue returns node-gi
// unboxes since gjsify PR #735, AND the BLOB round-trip — see below).
import { run } from '@gjsify/unit';

import testSuiteDatabaseSync from './database-sync.spec.js';
import testSuiteStatementSync from './statement-sync.spec.js';
import testSuiteDataTypes from './data-types.spec.js';

// Bare GJS ambient global — the node-gi-source signal (see header). Seeded by
// the auto-injected `@gjsify/node-gi/globals` shim.
print('sqlite suite on @gjsify/node-gi (Gda SQLite on Node)');

// ── BLOB (byte-array) round-trip — now GREEN ─────────────────────────────────
// The 'supports INTEGER, REAL, TEXT, BLOB, and NULL' test round-trips a
// `Uint8Array` BLOB (inserted inline as an `X'…'` literal, read back through
// `Gda.DataModel.get_value_at()`). It failed under node-gi because the read
// returns a boxed `GdaBinary` handle (exactly as GJS does — verified), and the
// reader's `if (typeof value.toArray === 'function')` duck-type check falsely
// matched: node-gi's boxed-handle Proxy used to fabricate a method for ANY name,
// so `typeof handle.toArray === 'function'` was true (it is `'undefined'` on
// GJS), and calling the non-existent `toArray()` threw → `get()` swallowed it →
// the row read as `undefined`. Fixed in @gjsify/node-gi's boxed Proxy (gi.js):
// a name that is neither a method nor a field now yields `undefined`, matching
// GJS. The distinct byte-array GValue marshalling (GByteArray ↔ Uint8Array) was
// also brought to GJS parity in the same change. No @gjsify/sqlite change needed.
run({ testSuiteDatabaseSync, testSuiteStatementSync, testSuiteDataTypes });
