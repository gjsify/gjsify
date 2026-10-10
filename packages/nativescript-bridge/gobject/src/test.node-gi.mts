// Node-gi test entry — the GObject conformance vectors against the SUBSET whose store is real
// GObject, through `@gjsify/node-gi` (ADR 0105 stage 2).
//
// This is the only file in the package that names `@gjsify/node-gi`. `engine.ts` and
// `engine.node-gi.spec.ts` take `requireGi` as a parameter instead, because:
//   • `@gjsify/node-gi` is no workspace member — it resolves only where a job links it (this
//     leg does, via the `file:` devDependency), so a static import in a type-checked file fails
//     `build:types` with TS2307 on every other job. `tsconfig.json` excludes this entry.
//   • a dynamic `gi://`-style load is no alternative either: `scripts/audit-runtimes.mjs` walks
//     every non-`.gjs.spec.*` file textually, and such a load sets `dynamic_gi` and mis-declares
//     this package's runtime triplet.
//   • the static import is also what turns the globals shim on — `detectNodeGiModuleImports`
//     counts a STATIC import of `@gjsify/node-gi/*` as bridge-bound, so `nodeGiGlobalsInject`
//     flips. A dynamic `import()` would not count.
//
// `--app node` keeps the specifier external, so the bundle `require`s the real binding rather
// than inlining a native addon.
import { run } from '@gjsify/unit';
import requireGi from '@gjsify/node-gi/gi';

import { realGioEngineSuite } from './engine.node-gi.spec.js';

run({ realGioEngineTestSuite: realGioEngineSuite(requireGi) });
