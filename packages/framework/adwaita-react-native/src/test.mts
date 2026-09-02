// The GJS leg: the GTK half, against the libadwaita that is installed.
//
// `parity.spec.ts` runs in BOTH entries on purpose. Its type-level half is settled by
// `tsc` before either runs, but its runtime half — that the base modules refuse — is a
// claim about the shipped artifact, and the shipped artifact differs per condition.
// Asserting it on one leg only would leave the other free to resolve the base barrel
// to something.

import { run } from '@gjsify/unit';

import clampGtkSuite from './widgets/clamp.gtk.spec.js';
import contentGtkSuite from './widgets/content.gtk.spec.js';
import headerBarGtkSuite from './widgets/header-bar.gtk.spec.js';
import paritySuite from './parity.spec.js';
import preferencesGtkSuite from './widgets/preferences.gtk.spec.js';
import rowsGtkSuite from './widgets/rows.gtk.spec.js';
import statusPageGtkSuite from './widgets/status-page.gtk.spec.js';
import toolbarViewGtkSuite from './widgets/toolbar-view.gtk.spec.js';
import windowTitleGtkSuite from './widgets/window-title.gtk.spec.js';
import wrapBoxGtkSuite from './widgets/wrap-box.gtk.spec.js';

run({
    paritySuite,
    clampGtkSuite,
    contentGtkSuite,
    headerBarGtkSuite,
    preferencesGtkSuite,
    rowsGtkSuite,
    statusPageGtkSuite,
    toolbarViewGtkSuite,
    windowTitleGtkSuite,
    wrapBoxGtkSuite,
});
