import GLib from 'gi://GLib?version=2.0';
import { run } from '@gjsify/unit';

import animatedSuite from './animated/animated.spec.js';
import easingSuite from './animated/easing.spec.js';
import apisSuite from './apis/apis.spec.js';
import eventEmitterSuite from './event-emitter.spec.js';
import listsSuite from './lists/lists.spec.js';
import classesSuite from './primitives/classes.spec.js';
import defaultsSuite from './primitives/defaults.spec.js';
import primitivesSuite from './primitives/primitives.spec.js';
import widgetsSuite from './primitives/widgets.spec.js';
import propTableSuite from './prop-table.spec.js';
import hrefSuite from './router/href.spec.js';
import routerWidgetsSuite from './router/router.spec.js';
import routesSuite from './router/routes.spec.js';
import solidSuite from './solid/solid.spec.js';
import surfacesSuite from './surfaces/surfaces.spec.js';
import stylesheetSuite from './stylesheet.spec.js';
import supportTableSuite from './support-table.spec.js';
import unsupportedSuite from './unsupported.spec.js';

// GIVE THIS PROCESS AN ACCESSIBILITY BACKEND, because the accessibility vectors
// measure GTK's AT context and `GTK_A11Y=none` means there is no context to measure.
//
// MEASURED (gtk 4.22.4): with `GTK_A11Y=none`, `Gtk.Accessible.get_at_context()` is
// NULL, `update_property()`/`update_state()` record nothing, and every
// `Gtk.test_accessible_has_*` answers false — silently, at exit 0. That is not a
// defect in the layer: it is GTK doing exactly what it was told. Every GTK job in
// CI sets `GTK_A11Y=none`, and node-gi.yml says why — "GTK_A11Y=none avoids the
// a11y bus", which a runner has none of. Six vectors failed on three OS legs on
// exactly this, reproduced locally with one env var, and the count and the names
// matched CI's to the test.
//
// `test` serves that intent BETTER than `none` rather than fighting it: it installs
// `GtkTestATContext`, which is in-process — no bus, no session, no D-Bus at all —
// and it is the backend GTK's own test suite uses for these very functions. So this
// removes an environment difference instead of adding one: a developer's machine
// answers these vectors through `GtkAtSpiContext` and now every leg answers them
// through a real context too.
//
// OVERWRITE is deliberate (`g_setenv(..., true)`): CI sets `none` explicitly, so
// honouring it would keep the suite measuring nothing. And it is set HERE rather
// than beside `Gtk.init()` because GTK reads the variable LAZILY, at the first
// `get_at_context()` — measured both ways — so the entry point is early enough and
// there is no import-order fragility to get wrong.
GLib.setenv('GTK_A11Y', 'test', true);

run({
    supportTableSuite,
    propTableSuite,
    unsupportedSuite,
    eventEmitterSuite,
    classesSuite,
    defaultsSuite,
    stylesheetSuite,
    primitivesSuite,
    apisSuite,
    widgetsSuite,
    easingSuite,
    animatedSuite,
    listsSuite,
    solidSuite,
    hrefSuite,
    surfacesSuite,
    routesSuite,
    routerWidgetsSuite,
});
