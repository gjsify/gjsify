// What GTK can tell this layer about the pixels — without React, and mostly
// without a window.
//
// Three React Native APIs read from here (`StyleSheet.hairlineWidth`, `Dimensions`,
// `useWindowDimensions`) and the reason they share one module is that they share one
// hard question: WHEN is the answer available? The measurements, each with the
// precondition that produced it, on gjs 1.88.1 / GTK 4.22.4 / Wayland:
//
// 1. **`Gdk.Display.get_default()` is null before `Gtk.init()`.** So nothing here can
//    be a module-level constant, and `hairlineWidth` — which real code reads at
//    module scope — has to have an answer with no display at all.
// 2. **The monitors are readable with NO window.** After `Gtk.init()`,
//    `display.get_monitors()` answered a list of one, `scale_factor` 1 and `scale`
//    1.0. That is what makes a windowless `hairlineWidth` honest rather than a guess.
// 3. **GTK4 has no primary monitor.** `Gdk.Display.get_primary_monitor` is
//    `undefined` (measured) — it was removed in GTK4. So "the screen" is not a
//    well-defined thing until a window exists to be on one, which is the argument
//    for taking the SMALLEST scale (see {@link hairlineWidth}) rather than picking a
//    monitor.
// 4. **A toplevel has no surface until it is presented.** `window.realize()` on a
//    never-presented `Gtk.Window` fails — `gdk_surface_get_frame_clock: assertion
//    'GDK_IS_SURFACE (surface)' failed`, then `gtk_native_realize: assertion 'clock
//    != NULL'`, and `get_surface()` still answered null. So the surface is not a
//    dependency anything here may have before the application is running.
// 5. **The surface is NOT the window's size.** A window with `default-width` 640 and
//    `default-height` 480 reported a 668×509 surface once presented — the surface
//    carries the client-side-decoration shadow. React Native's window dimensions are
//    the window's, so the ALLOCATION is what is reported and the surface is only what
//    notifies.
// 6. **`Gtk.Window.get_toplevels()` is a live list and needs no application.** It
//    answered 0 before any window and 1 after CONSTRUCTING one — before presenting
//    it. That is how `Dimensions` finds the window without a registry of its own.
//
// Values through `gi://`, types through `@girs/*` — machine-checked, see
// `app-registry.ts` for the rule and what breaks when it is broken.

import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';

import { PrimitiveError } from '../primitives/errors.js';

/** React Native's own shape, field for field. */
export interface DisplayMetrics {
    readonly width: number;
    readonly height: number;
    readonly scale: number;
    readonly fontScale: number;
}

/**
 * The window `Dimensions` reports on, or null when there is none yet.
 *
 * `Gtk.Window.get_toplevels()` rather than a window this package registers, and the
 * difference is who it works for: a registry would only answer for a window
 * `AppRegistry.runApplication` created, while an application that builds its own
 * window — which every gjsify application that predates this package does — would
 * get nothing. The list is GTK's own and holds every toplevel.
 *
 * The MAPPED window wins over an unmapped one: an application that has opened a
 * dialog has two toplevels, and the one the user is looking at is the mapped one.
 * Among equals the FIRST is taken, because `get_toplevels()` is in creation order
 * and the application's own window is created first.
 */
function activeWindow(): Gtk.Window | null {
    if (Gdk.Display.get_default() === null) return null;
    const toplevels = Gtk.Window.get_toplevels();
    let fallback: Gtk.Window | null = null;
    for (let index = 0; index < toplevels.get_n_items(); index++) {
        const window = toplevels.get_item(index) as Gtk.Window | null;
        if (window === null) continue;
        if (window.get_mapped()) return window;
        fallback ??= window;
    }
    return fallback;
}

/**
 * The finest device-pixel grid this application could be drawn on, as a scale.
 *
 * `get_scale()` (a double, GTK 4.12) before `get_scale_factor()` (an int): a
 * fractional-scaling desktop reports 1.5 from the first and 2 from the second, and a
 * hairline computed from the integer would be half a device pixel on such a monitor.
 * Measured: both exist on `Gdk.Monitor` and on `Gdk.Surface`.
 */
const scaleOf = (monitor: Gdk.Monitor): number => {
    const fractional = monitor.get_scale();
    return fractional > 0 ? fractional : monitor.get_scale_factor();
};

/**
 * One device pixel, in the logical pixels GTK CSS is written in.
 *
 * React Native's `hairlineWidth` is "the thinnest line the platform can draw", which
 * is one device pixel; GTK CSS lengths are logical pixels, so that is `1 / scale`.
 *
 * IT IS A FUNCTION AND NOT A CONSTANT, because real code reads
 * `StyleSheet.hairlineWidth` at module scope and `Gdk.Display.get_default()` is null
 * until `Gtk.init()` (measured). Before then this answers 1 — one logical pixel,
 * which IS one device pixel on an unscaled display and is the only value available;
 * the same read after the application starts answers from the display. A cached
 * module-level constant would freeze the pre-init answer for the life of the process.
 *
 * THE SMALLEST SCALE, NOT THE LARGEST, and this is the one judgement in the file.
 * GTK4 removed the primary-monitor concept (measured), so with no window there is no
 * principled "main screen" to read — and a global constant has to be right on every
 * monitor the window may be moved to. `1 / max(scale)` is one device pixel on the
 * finest monitor and SUB-pixel on a coarser one, where GTK snaps it and it can
 * disappear; `1 / min(scale)` is one device pixel on the coarsest and at most a
 * device pixel too thick elsewhere. A line that is slightly too thick is a worse
 * hairline; a line that is not drawn is not a hairline at all.
 */
export function hairlineWidth(): number {
    const display = Gdk.Display.get_default();
    if (display === null) return 1;
    const monitors = display.get_monitors();
    let smallest = 0;
    for (let index = 0; index < monitors.get_n_items(); index++) {
        const monitor = monitors.get_item(index) as Gdk.Monitor | null;
        if (monitor === null) continue;
        const scale = scaleOf(monitor);
        if (scale > 0 && (smallest === 0 || scale < smallest)) smallest = scale;
    }
    return smallest === 0 ? 1 : 1 / smallest;
}

/**
 * The desktop's text-scaling factor, as React Native's `fontScale`.
 *
 * `Gtk.Settings:gtk-xft-dpi` is the one place GTK publishes it, in 1024ths of a DPI
 * (measured: 98304, which is 96 × 1024, i.e. no scaling). GNOME's own
 * `text-scaling-factor` is a GSettings key this layer would have to read through a
 * schema that may not be installed; `gtk-xft-dpi` is what GTK itself resolves that
 * key into, so it is both nearer and always present.
 */
function fontScale(): number {
    const settings = Gtk.Settings.get_default();
    if (settings === null) return 1;
    const dpi = settings.gtkXftDpi;
    return dpi > 0 ? dpi / 1024 / 96 : 1;
}

/** The scale of the monitor a window is on, or the hairline scale when it has no surface yet. */
function windowScale(window: Gtk.Window): number {
    const surface = window.get_surface();
    if (surface === null) return 1 / hairlineWidth();
    const fractional = surface.get_scale();
    return fractional > 0 ? fractional : surface.get_scale_factor();
}

/**
 * The application window's size — React Native's `Dimensions.get('window')`.
 *
 * The ALLOCATION (`Gtk.Widget.get_width/get_height`), not the surface: measured, a
 * 640×480 window has a 668×509 surface because the surface carries the CSD shadow,
 * and React Native's number is the window's.
 *
 * Before the window has been allocated the allocation is 0×0 (measured), and then
 * `default-width`/`default-height` are reported — which is the size the window is
 * about to have, readable from the moment it is constructed. A zero would be a lie
 * that divides.
 */
export function windowMetrics(): DisplayMetrics {
    const window = activeWindow();
    if (window === null) {
        throw new PrimitiveError(
            'Dimensions',
            "get('window')",
            'reports the size of the application WINDOW and there is none yet — `Gtk.Window.get_toplevels()` is empty, so this ran before the application built its window (module scope is before it, always). Read it from a component or an effect, or use `useWindowDimensions`, which re-renders when the size changes',
        );
    }
    const allocated = { width: window.get_width(), height: window.get_height() };
    return {
        width: allocated.width > 0 ? allocated.width : window.defaultWidth,
        height: allocated.height > 0 ? allocated.height : window.defaultHeight,
        scale: windowScale(window),
        fontScale: fontScale(),
    };
}

/**
 * The monitor's size — React Native's `Dimensions.get('screen')`.
 *
 * Implemented rather than refused, because `screen` genuinely IS the monitor and
 * asking for it is a different question from asking for the window. What ADR 0032
 * decides is that the WINDOW is what `Dimensions.get('window')` reports; a desktop
 * application is not full-screen, so answering the window's question with the
 * monitor's number would be wrong in the ordinary case rather than the rare one.
 *
 * The monitor is the one the window is on when there is a surface to ask about
 * (`get_monitor_at_surface`), and the first one otherwise — GTK4 has no primary
 * monitor to prefer (measured).
 */
export function screenMetrics(): DisplayMetrics {
    const display = Gdk.Display.get_default();
    if (display === null) {
        throw new PrimitiveError(
            'Dimensions',
            "get('screen')",
            'needs a `Gdk.Display`, and `Gdk.Display.get_default()` answers null before `Gtk.init()` (measured). Read it after the application has started',
        );
    }
    const surface = activeWindow()?.get_surface() ?? null;
    const monitor =
        (surface === null ? null : display.get_monitor_at_surface(surface)) ??
        (display.get_monitors().get_item(0) as Gdk.Monitor | null);
    if (monitor === null) {
        throw new PrimitiveError(
            'Dimensions',
            "get('screen')",
            'found a display with no monitors on it. That is a headless session; there is no screen to measure',
        );
    }
    const geometry = monitor.get_geometry();
    return { width: geometry.width, height: geometry.height, scale: scaleOf(monitor), fontScale: fontScale() };
}

/**
 * Call `listener` whenever the window's size changes; returns the unsubscribe.
 *
 * THE NOTIFIER AND THE VALUE ARE DIFFERENT OBJECTS, and that is measured rather than
 * chosen. `Gtk.Widget` installs no width or height property and emits no
 * size-allocate signal — it reports its allocation through
 * `Gtk.Widget.vfunc_size_allocate`, a subclass override, which is the same wall
 * `<View onLayout>` is refused against. `Gdk.Surface` DOES install `width` and
 * `height` (read-only, measured) and notifies on them — measured: two
 * `notify::width` emissions while a window was being mapped. So the surface says
 * WHEN and the window says WHAT.
 *
 * PRECONDITION NOT MEASURED: whether the window's allocation is already updated
 * inside that handler. A compositor-driven resize cannot be triggered from a probe —
 * `set_default_size` on a mapped window is a no-op (measured: the window stayed
 * 640×480 while `default-width` became 800) — so the ordering is stated as unknown
 * rather than guessed. If GTK allocates after the notification, a resize is reported
 * from the value read at the NEXT notification.
 *
 * A window with no surface yet is subscribed through its own `realize`, because that
 * is when the surface appears (measured: null before, present after presenting).
 * Every connection is disconnected by the disposer rather than left to a flag: GJS
 * blocks JS callbacks during GC, so a handler that is not disconnected stays
 * connected for the life of the process.
 */
export function onWindowMetricsChange(listener: () => void): () => void {
    const window = activeWindow();
    if (window === null) return () => {};
    const disposers: (() => void)[] = [];

    const watchSurface = (surface: Gdk.Surface): void => {
        for (const signal of ['notify::width', 'notify::height'] as const) {
            const handler = surface.connect(signal, () => listener());
            disposers.push(() => surface.disconnect(handler));
        }
    };

    const surface = window.get_surface();
    if (surface !== null) watchSurface(surface);
    else {
        const handler = window.connect('realize', () => {
            const realized = window.get_surface();
            if (realized !== null) watchSurface(realized);
            listener();
        });
        disposers.push(() => window.disconnect(handler));
    }
    return () => {
        for (const dispose of disposers) dispose();
        disposers.length = 0;
    };
}

/**
 * The last metrics handed out, so a repeated read is the SAME object.
 *
 * `useSyncExternalStore` compares snapshots with `Object.is` and re-renders when they
 * differ, so a getter that built a fresh record on every call would report a change on
 * every render — React's own "getSnapshot should be cached" loop. Caching by VALUE
 * rather than by time is what makes the comparison mean what the hook thinks it means:
 * a real resize replaces the object, a re-render does not.
 */
let cachedWindowMetrics: DisplayMetrics | null = null;

/** {@link windowMetrics}, with a stable identity while the numbers are unchanged. */
export function windowMetricsSnapshot(): DisplayMetrics {
    const next = windowMetrics();
    const last = cachedWindowMetrics;
    if (
        last === null ||
        last.width !== next.width ||
        last.height !== next.height ||
        last.scale !== next.scale ||
        last.fontScale !== next.fontScale
    ) {
        cachedWindowMetrics = next;
    }
    return cachedWindowMetrics as DisplayMetrics;
}

/** Test seam: forget the cached snapshot, so the next read is a fresh object. */
export function resetWindowMetricsCache(): void {
    cachedWindowMetrics = null;
}
