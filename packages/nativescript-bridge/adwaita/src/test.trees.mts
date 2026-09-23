// A SECOND TEST ENTRY, and the separation is the point rather than an accident of layout.
//
// Every spec in `./test.mts` drives a pure sibling and imports no widget class, because a
// widget module evaluates `@nativescript/core` at module scope and nothing off a device
// resolves it. The tree driver needs the opposite: it must build the port's REAL widgets, so
// its bundles alias that specifier onto `./testing/ns-core.mjs`, the runtime half of the
// ambient slice `src/ns-core.d.ts` already declares.
//
// One entry carrying both would put that alias under every other spec in the package —
// quietly retiring the constraint the whole suite is built around, and letting a pure spec
// start leaning on a platform double without anyone deciding to. Two entries keep the
// constraint exactly where it was and put the double under the one suite that asked for it.

import { run } from '@gjsify/unit';

import { AdwClampClasslessChildNsTest } from './clamp-child.spec.js';
import { AdwGtkValueDoorsNsTest } from './gtk-value-doors.spec.js';
import { AdwSharedTreesNsTest } from './shared-trees.spec.js';
import { AdwValueListsNsTest } from './value-lists.spec.js';
import { AdwViewSwitcherStackNsTest } from './view-switcher-stack.spec.js';

run({
    AdwSharedTreesNsTest,
    AdwClampClasslessChildNsTest,
    AdwGtkValueDoorsNsTest,
    AdwViewSwitcherStackNsTest,
    AdwValueListsNsTest,
});
