import { run } from '@gjsify/unit';

import { installAccessibilityBackend } from './conformance/at-context.js';

import accessibilitySuite from './accessibility.spec.js';
import reactSuite from './adapters/react.spec.js';
import adjustmentSuite from './adjustment.spec.js';
import buildableSuite from './buildable.spec.js';
import solidSuite from './adapters/solid.spec.js';
import vueSuite from './adapters/vue.spec.js';
import conformanceSuite from './conformance.spec.js';
import fontDirSuite from './font-dir.spec.js';
import fontFamiliesSuite from './font-families.spec.js';
import fontsSuite from './fonts.spec.js';
import generatedSuite from './generated.spec.js';
import generatorSuite from './generator.spec.js';
import hostSuite from './host.spec.js';
import menuSuite from './menu.spec.js';
import placementSuite from './placement.spec.js';
import probeSuite from './probe.spec.js';
import propsSuite from './props.spec.js';
import uiFontSuite from './ui-font.spec.js';
import sharedTreesSuite from './shared-trees.spec.js';
import gtkCssSuite from './style/gtk-css.spec.js';
import gtkPropsSuite from './style/gtk-props.spec.js';
import layoutSuite from './style/layout.spec.js';
import listModelSuite from './list-model.spec.js';
import listSuite from './list/list.spec.js';
import paintSuite from './style/paint.spec.js';
import sheetSuite from './style/sheet.spec.js';
import themeSuite from './style/theme.spec.js';
import tokensSuite from './style/tokens.spec.js';

// GIVE THIS PROCESS AN ACCESSIBILITY BACKEND before `run()` builds the first widget.
// The ARIA vectors measure GTK's AT context, and `GTK_A11Y=none` — which every headless
// CI leg sets to stay off the a11y bus — means there is no context to measure: the
// writes record nothing and every `test_accessible_has_*` answers false, at exit 0.
// The reasoning, the cross-runtime measurement and the ordering hazard are all in
// `conformance/at-context.ts`; this call is the one thing an entry point has to do.
installAccessibilityBackend();

run({
    tokensSuite,
    themeSuite,
    sheetSuite,
    paintSuite,
    layoutSuite,
    gtkCssSuite,
    gtkPropsSuite,
    buildableSuite,
    propsSuite,
    accessibilitySuite,
    placementSuite,
    probeSuite,
    fontDirSuite,
    fontFamiliesSuite,
    uiFontSuite,
    fontsSuite,
    hostSuite,
    menuSuite,
    listModelSuite,
    adjustmentSuite,
    conformanceSuite,
    sharedTreesSuite,
    generatorSuite,
    generatedSuite,
    listSuite,
    solidSuite,
    vueSuite,
    reactSuite,
});
