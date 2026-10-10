// Node-gi test entry — the GObject conformance vectors against REAL GObject on Node, through
// `@gjsify/node-gi` (ADR 0105 stage 0: "real GObject is the oracle").
//
// HOW IT WIRES UP (`gjsify workspace @gjsify/adwaita-core run test:gjs-on-node`, the sqlite and
// gamepad pattern):
//   • `requireGi` is imported HERE, by name, and handed to the suite. `--app node` keeps the
//     specifier external (`node-gi-externals.spec.ts` pins it), so the bundle `require`s the real
//     binding instead of inlining a native addon.
//   • The import belongs in this file and not in the spec because `tsconfig.json` excludes the
//     test entries: `@gjsify/node-gi` is no workspace member, so only a job that links it can
//     resolve those types, and a static import in a type-checked file fails `build:types`
//     everywhere else. The spec's header has the full reasoning.
//   • The import is also what turns the globals shim on: `detectNodeGiModuleImports` counts a
//     STATIC import of `@gjsify/node-gi/*` as bridge-bound, so `nodeGiGlobalsInject` flips
//     without this entry needing the bare `print(...)` banner the sqlite and gamepad entries use
//     as their trigger — and a dynamic `import()` would not count, which is a second reason the
//     bridge is reached this way.
//
// Only the node-gi suite is registered, NOT the pure-TS suites of `test.mts`: those are
// runtime-independent and already run on Node via `test:node`, so a second copy here would
// measure nothing new. What this leg adds is the one thing neither `test.mts` nor
// `gobject.gjs.spec.ts` can answer — whether the OTHER real GObject binding holds the vectors.
import { run } from '@gjsify/unit';
import requireGi from '@gjsify/node-gi/gi';

import { gobjectNodeGiSuite } from './gobject.node-gi.spec.js';

run({ gobjectNodeGiTestSuite: gobjectNodeGiSuite(requireGi) });
