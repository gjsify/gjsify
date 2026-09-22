// The accessibility backend every ARIA vector measures — and the guard that names its absence.
//
// GTK's ARIA surface is not written on the widget. `gtk_accessible_update_property`
// and its two siblings hand their values to the widget's `GtkATContext`, and
// `gtk_test_accessible_has_*` reads them back out of it. A process with NO AT context
// has no accessibility tree to write into: every `update_*` returns at its first line
// and every `has_*` answers false. Nothing is logged, and the process exits 0.
//
// WHICH IS WHAT `GTK_A11Y=none` DOES, and CI sets it — node-gi.yml says why:
// "GTK_A11Y=none avoids the a11y bus", which a headless runner has none of. MEASURED
// here on gtk 4.22.5, one process per cell, the SAME four raw-GTK vectors on both
// runtimes:
//
//     GTK_A11Y      gjs 1.88.1              node-gi on Node 24
//     unset         has_* true, critical    has_* true, critical
//     none          has_* FALSE, silent     has_* FALSE, silent
//     test          has_* true, critical    has_* true, critical
//
// The two runtimes agree in every cell, so a red that appears only on the node-gi
// legs is a claim about their ENV and not about the bridge: the legs that set
// `GTK_A11Y=none` were the node-gi ones, and the gjs legs do not set it at all.
//
// `test` serves the runner's intent BETTER than `none` rather than fighting it. It
// installs `GtkTestATContext`, which is in-process — no bus, no session, no D-Bus at
// all — and it is the backend GTK's own test suite uses for exactly these functions.
// So this REMOVES an environment difference instead of adding one: a developer's
// machine answers these vectors through `GtkAtSpiContext`, and every CI leg now
// answers them through a real context too.
//
// `packages/framework/react-native/src/test.mts` reached this same conclusion from the
// same six failures; this is the one declaration both entry points can call, because
// `conformance` is the published subpath a consumer's test entry already imports.

import GLib from 'gi://GLib?version=2.0';
import type Gtk from '@girs/gtk-4.0';

/**
 * Give this process an in-process accessibility backend, before anything asks for one.
 *
 * OVERWRITE is deliberate: CI sets `GTK_A11Y=none` explicitly, and honouring it would
 * keep the vectors measuring an absent layer rather than the code under test.
 *
 * AND THE ORDER IS LOAD-BEARING, which is why this belongs at a test ENTRY POINT and
 * not beside a `Gtk.init()`. GTK reads the variable lazily but exactly ONCE, at the
 * first `get_at_context()`, and caches the answer — measured on gtk 4.22.5 starting
 * from `GTK_A11Y=none`: set after `Gtk.init()` and before any widget is asked for its
 * context, `test` takes; set after ONE widget has been asked, the answer is `null`
 * forever. A module body runs after every `import` above it, so an entry point is
 * early enough only for as long as nothing it imports touches an AT context while
 * being evaluated. {@link withAtContext} is what NAMES the day that stops being true.
 */
export function installAccessibilityBackend(): void {
    GLib.setenv('GTK_A11Y', 'test', true);
}

/**
 * The widget, or a refusal that says why an ARIA assertion about it cannot mean anything.
 *
 * A THROW rather than an `expect`, because the SENTENCE is the whole value here. Without
 * it the symptom is `Expected: true (boolean) / Actual: false (boolean)`, six times over,
 * on three OS legs at once — and that shape reads as a marshalling defect in whichever
 * runtime those legs happen to share. It is not one; it is this.
 *
 * It also guards the assertions that expect FALSE, and those are the ones that make this
 * a gate rather than a nicety: with no AT context they pass VACUOUSLY. A reset vector, a
 * "nothing was authored here" vector — every one of them is green against a layer that
 * was never there.
 */
export function withAtContext<T extends Gtk.Accessible>(widget: T): T {
    if (widget.get_at_context() === null) {
        throw new Error(
            'this widget has no GtkATContext, so gtk_accessible_update_property/_state/_relation ' +
                'record nothing and every Gtk.test_accessible_has_* answers false — silently, at exit 0. ' +
                'These vectors would be measuring an absent accessibility layer rather than this package. ' +
                'GTK_A11Y=none does exactly that; the test entry point calls ' +
                'installAccessibilityBackend() to install GTK’s in-process `test` backend instead, so ' +
                'either something unset it again or an AT context was asked for before it ran.',
        );
    }
    return widget;
}
