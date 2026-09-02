// The NODE leg: everything that does not need a display or a typelib.
//
// Two entries rather than one, because the package genuinely has two halves. The GTK
// modules import `gi://Adw` and only run under GJS (or node-gi with a display); the
// React Native modules import `react-native`, which is Flow source that this chain
// cannot parse and which `build:test:node` therefore aliases onto the type-pinned
// double. Neither leg can host the other's specs, and a single entry would have to
// drop one of them — silently, since nothing counts a suite that was never written.

import { run } from '@gjsify/unit';

import avatarNativeSuite from './widgets/avatar.native.spec.js';
import bannerNativeSuite from './widgets/banner.native.spec.js';
import binNativeSuite from './widgets/bin.native.spec.js';
import buttonContentNativeSuite from './widgets/button-content.native.spec.js';
import clampNativeSuite from './widgets/clamp.native.spec.js';
import doubleSuite from './testing/react-native.spec.js';
import headerBarNativeSuite from './widgets/header-bar.native.spec.js';
import navigationPageNativeSuite from './widgets/navigation-page.native.spec.js';
import navigationSplitViewNativeSuite from './widgets/navigation-split-view.native.spec.js';
import navigationViewNativeSuite from './widgets/navigation-view.native.spec.js';
import overlaySplitViewNativeSuite from './widgets/overlay-split-view.native.spec.js';
import paritySuite from './parity.spec.js';
import preferencesNativeSuite from './widgets/preferences.native.spec.js';
import rowsNativeSuite from './widgets/rows.native.spec.js';
import spinnerNativeSuite from './widgets/spinner.native.spec.js';
import statusPageNativeSuite from './widgets/status-page.native.spec.js';
import toastOverlayNativeSuite from './widgets/toast-overlay.native.spec.js';
import toolbarViewNativeSuite from './widgets/toolbar-view.native.spec.js';
import viewStackNativeSuite from './widgets/view-stack.native.spec.js';
import viewSwitcherNativeSuite from './widgets/view-switcher.native.spec.js';
import windowTitleNativeSuite from './widgets/window-title.native.spec.js';
import wrapBoxNativeSuite from './widgets/wrap-box.native.spec.js';

run({
    paritySuite,
    doubleSuite,
    avatarNativeSuite,
    bannerNativeSuite,
    binNativeSuite,
    buttonContentNativeSuite,
    clampNativeSuite,
    headerBarNativeSuite,
    navigationPageNativeSuite,
    navigationSplitViewNativeSuite,
    navigationViewNativeSuite,
    overlaySplitViewNativeSuite,
    preferencesNativeSuite,
    rowsNativeSuite,
    spinnerNativeSuite,
    statusPageNativeSuite,
    toastOverlayNativeSuite,
    toolbarViewNativeSuite,
    viewStackNativeSuite,
    viewSwitcherNativeSuite,
    windowTitleNativeSuite,
    wrapBoxNativeSuite,
});
