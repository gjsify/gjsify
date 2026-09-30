// Node-gi test entry — `@gjsify/gamepad`'s SDL3 source over the REAL shim on the Node
// target, through `@gjsify/node-gi` (ADR 0075 + Amendment 1).
//
// HOW IT WIRES UP (`gjsify workspace @gjsify/gamepad run test:gjs-on-node`, which is the
// sqlite pattern — `scripts/node-gi-consumer-harness.mjs` builds the same file):
//   • `--app node` rewrites the literal `gi://GjsifyGamepad?version=1.0` in
//     `backend.ts` to `@gjsify/node-gi/gi`'s `requireGi('GjsifyGamepad','1.0')`, so
//     the package's own probe — no test seam, no injected importer — decides what this
//     host has. That is what makes the result a measurement rather than a restatement
//     of the code.
//   • The bare `print(...)` banner references a GJS ambient global, the genuine-GJS-
//     source signal `detectNodeGiGlobals` keys on. It flips `nodeGiGlobalsInject` on,
//     so `@gjsify/node-gi/globals` is auto-injected and `@girs/*` value imports
//     resolve to their real bodies whose inner `gi://` specifiers are rewritten too.
//   • `@gjsify/gamepad-native` must be REACHABLE as a typelib: the shim is not
//     committed, so `gjsify workspace @gjsify/gamepad-native run build:prebuilds`
//     stages `prebuilds/darwin-<arch>/` into the per-target sibling, and the CLI's
//     `detectNativePackages` puts it on `GI_TYPELIB_PATH` — the same path a
//     `--app node` consumer takes.
//
// Only the node-gi suite is registered here, unlike `test.mts`: `src/test.browser.mts`
// deliberately does not exist for this package (the manette/SDL backends have no browser
// equivalent), and the ordinary `test.mts` suites drive fakes and need no bridge.
// What a Node run cannot prove is the GJS leg's — hence not a second copy of it.
import { run } from '@gjsify/unit';

import testSuiteSdlNodeGi from './sdl-node-gi.spec.js';

// Bare GJS ambient global — the node-gi-source signal (see header). Seeded by the
// auto-injected `@gjsify/node-gi/globals` shim.
// oxlint-disable-next-line no-restricted-globals -- deliberate: the bare `print` IS the trigger `detectNodeGiGlobals` keys the `@gjsify/node-gi/globals` injection on (scripts/node-gi-consumer-harness.mjs)
print('gamepad SDL3 source on @gjsify/node-gi (GjsifyGamepad on Node)');

run({ testSuiteSdlNodeGi });
