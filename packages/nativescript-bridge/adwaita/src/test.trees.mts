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

import { Canvas2DBridgeNsTest } from './canvas2d/canvas2d-bridge.spec.js';
import { AdwApplicationNsTest } from './application.spec.js';
import { GioResourceNsTest } from './gio-resource.spec.js';
import { AdwBlueprintTreesNsTest } from './blueprint-trees.spec.js';
import { AdwBlueprintMarkupNsTest } from './blueprint-markup.spec.js';
import { AdwClampClasslessChildNsTest } from './clamp-child.spec.js';
import { AdwAboutDialogDoorsNsTest } from './about-dialog-doors.spec.js';
import { AdwAboutDialogCreditsNsTest } from './about-dialog-credits.spec.js';
import { AdwCarouselDoorsNsTest } from './carousel-doors.spec.js';
import { AdwConstructVectorsNsTest } from './construct-vectors.spec.js';
import { AdwContainersNsTest } from './containers.spec.js';
import { AdwGalleryBlueprintsNsTest } from './gallery-blueprints.spec.js';
import { GtkButtonActionsNsTest } from './gtk-button-actions.spec.js';
import gtkPlatformNsTest from './gtk-platform.spec.js';
import gioNsTest from './gio.spec.js';
import { GtkMenuTreeNsTest } from './gtk-menu-tree.spec.js';
import { PopupMenuWidgetsNsTest } from './popup-menu-widgets.spec.js';
import { GtkBoxNsTest } from './gtk-box.spec.js';
import { AdwGObjectDoorNsTest } from './gobject-door.spec.js';
import { AdwGTypeNameNsTest } from './gtype-name.spec.js';
import { AdwGridLayoutNsTest } from './grid-layout.spec.js';
import { GtkGridNsTest } from './gtk-grid.spec.js';
import { GtkListBoxNsTest } from './gtk-list-box.spec.js';
import { GtkControlsNsTest } from './gtk-controls.spec.js';
import { GtkStackNsTest } from './gtk-stack.spec.js';
import { GtkToggleButtonNsTest } from './gtk-toggle-button.spec.js';
import { GtkWindowMembersNsTest } from './window-members.spec.js';
import { GtkWidgetTreeNsTest } from './widget-tree.spec.js';
import { AdwGtkValueDoorsNsTest } from './gtk-value-doors.spec.js';
import { AdwRegisterBarrelNsTest } from './register-barrel.spec.js';
import { AdwParamValuesNsTest } from './param-values.spec.js';
import { AdwShadowedPropertiesNsTest } from './shadowed-properties.spec.js';
import { AdwSharedTreesNsTest } from './shared-trees.spec.js';
import { AdwValueListsNsTest } from './value-lists.spec.js';
import { AdwViewSwitcherStackNsTest } from './view-switcher-stack.spec.js';
import { AdwWidgetBaseNsTest } from './widget-base.spec.js';
import { AdwWidgetMapNsTest } from './widget-map.spec.js';
import { AdwWindowRootsNsTest } from './window-roots.spec.js';
import { AdwWindowShellNsTest } from './window-shell.spec.js';
import { AdwWindowTitlePropertiesNsTest } from './window-title-properties.spec.js';
import { AdwSpinnerPropertiesNsTest } from './spinner-properties.spec.js';

run({
    AdwApplicationNsTest,
    GioResourceNsTest,
    AdwSharedTreesNsTest,
    AdwRegisterBarrelNsTest,
    AdwClampClasslessChildNsTest,
    AdwAboutDialogDoorsNsTest,
    AdwAboutDialogCreditsNsTest,
    AdwCarouselDoorsNsTest,
    AdwConstructVectorsNsTest,
    AdwGObjectDoorNsTest,
    AdwGTypeNameNsTest,
    AdwContainersNsTest,
    GtkBoxNsTest,
    GtkGridNsTest,
    AdwGridLayoutNsTest,
    GtkListBoxNsTest,
    GtkControlsNsTest,
    GtkStackNsTest,
    AdwWidgetBaseNsTest,
    AdwWidgetMapNsTest,
    AdwWindowRootsNsTest,
    GtkWindowMembersNsTest,
    AdwWindowShellNsTest,
    AdwWindowTitlePropertiesNsTest,
    AdwSpinnerPropertiesNsTest,
    GtkToggleButtonNsTest,
    GtkWidgetTreeNsTest,
    GtkButtonActionsNsTest,
    GtkMenuTreeNsTest,
    gtkPlatformNsTest,
    gioNsTest,
    PopupMenuWidgetsNsTest,
    AdwGtkValueDoorsNsTest,
    AdwViewSwitcherStackNsTest,
    AdwValueListsNsTest,
    AdwBlueprintTreesNsTest,
    AdwBlueprintMarkupNsTest,
    AdwParamValuesNsTest,
    AdwShadowedPropertiesNsTest,
    AdwGalleryBlueprintsNsTest,
    Canvas2DBridgeNsTest,
});
