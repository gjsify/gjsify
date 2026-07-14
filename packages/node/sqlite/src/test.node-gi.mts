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
// Result of the 52 tests: 51 pass (connection lifecycle, prepare, param
// binding, SQL/parser validation, error handling, option validation AND
// scalar result-row reading via `Gda.DataModel.get_value_at()`, whose GValue
// returns node-gi unboxes to JS primitives since gjsify PR #735).
import { run } from '@gjsify/unit';

import testSuiteDatabaseSync from './database-sync.spec.js';
import testSuiteStatementSync from './statement-sync.spec.js';
import testSuiteDataTypes from './data-types.spec.js';

// Bare GJS ambient global — the node-gi-source signal (see header). Seeded by
// the auto-injected `@gjsify/node-gi/globals` shim.
print('sqlite suite on @gjsify/node-gi (Gda SQLite on Node)');

// ── node-gi gap: BLOB (byte-array) ↔ GValue marshalling ───────────────────────
// The ONE remaining failure. This test round-trips a `Uint8Array` BLOB: it binds
// one as a statement parameter (`Gda.Holder.set_value(u8)`) and reads a BLOB
// column back (`Gda.DataModel.get_value_at()`). node-gi doesn't marshal a JS
// byte array to/from a `GValue` holding a GLib byte array the way GJS auto-does:
// a bound `Uint8Array` doesn't round-trip (the inserted BLOB row isn't found on
// read), and a BLOB `get_value_at()` return comes back as a RAW boxed node-gi
// handle rather than a `Uint8Array` (confirmed by a direct Gda probe). This is
// DISTINCT from the scalar GValue-return unboxing gjsify PR #735 already fixed
// (int/real/text now round-trip — that turned 13 of the original 14 failures
// green). It's a native-engine follow-up (byte-array GValue boxing/unboxing in
// src/marshal.cc), not a @gjsify/sqlite bug and not fixable at the JS/L1 layer,
// so this one test is skipped WITH a reason (never silently). All other reads —
// INTEGER/REAL/TEXT/NULL, get()/all()/run(), BigInt toggles, array rows — pass.
const NODE_GI_BLOB_GVALUE =
    'node-gi does not marshal a Uint8Array BLOB to/from a GValue byte array: a bound Uint8Array param does not round-trip and a BLOB get_value_at() return is a raw boxed handle, not a Uint8Array (byte-array GValue boxing/unboxing gap in marshal.cc; distinct from the scalar GValue-return fix in PR #735)';
const skip: Record<string, string> = {
    'supports INTEGER, REAL, TEXT, BLOB, and NULL': NODE_GI_BLOB_GVALUE,
};

run({ testSuiteDatabaseSync, testSuiteStatementSync, testSuiteDataTypes }, { skip });
