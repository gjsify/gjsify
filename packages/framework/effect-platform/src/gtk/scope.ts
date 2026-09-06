// SPDX-License-Identifier: MIT
//
// The GObject lifetime ↔ Effect `Scope` bridge, and the sync/async boundary that
// has to sit beside it.
//
// TWO LIFETIMES THAT KNOW NOTHING ABOUT EACH OTHER. A widget's lifetime is
// GObject refcounting; an Effect fiber's is its `Scope`. Nothing connects them, so
// a fiber that outlives its widget touches a disposed C object — in GJS that is
// `Object Adw.Window (0x…), has been already disposed — impossible to get any
// property from it`, a CRITICAL and a `null` where a value was expected. The fix
// is one line of policy: every fiber a widget starts is forked INTO the widget's
// scope, and closing that scope interrupts them.
//
// "CLOSE IT ON `destroy`" IS NOT ENOUGH, and this is the measurement that makes
// this file two functions instead of one. On GTK 4.22 / libadwaita 1.9 / gjs
// 1.88.1, with the application still holding a JS reference to the window:
//
//   action on a presented Adw.Window   signals emitted
//   ---------------------------------  ----------------------------------
//   close()                            close-request, unrealize
//   destroy()                          unrealize                 ← no destroy
//   run_dispose()                      unrealize, destroy
//
// So `GtkWidget::destroy` is emitted from `dispose`, not from
// `gtk_window_destroy()`. It is exactly the right signal for the question "may a
// fiber still touch this widget" — after it, GJS marks the wrapper disposed and
// every property read is a CRITICAL — and it is the wrong signal for "is this
// window still on screen", which is what an application actually wants to stop
// work on. A window closed by the user has left the screen and is still very much
// alive, because the app holds a reference to it.
//
// Hence: `widgetScope` for the correctness boundary, `windowScope` for the useful
// one. Both are idempotent, and `windowScope` installs both triggers, so a window
// that is closed and later disposed closes its scope once, at the earlier event.
//
// THE SYNC BOUNDARY IS THE OTHER HALF, and it is the part that has no type to hold
// it. A GTK signal handler is synchronous, and some of them return a value that
// decides propagation — `Gtk.EventControllerKey::key-pressed` returns a boolean,
// and a handler that returns a Promise returns something GTK reads as `true`,
// swallowing every key it was asked about. A fiber cannot answer that. So the rule
// is: the DECISION stays synchronous in the handler, and the WORK is forked. That
// is what `runInScope` is for, and why it returns a `Fiber` rather than a promise —
// there is nothing in a handler that could await one. `window.ts` does exactly this
// for Escape, and the probe emits the signal and reads the boolean back.
//
// If a handler needs the fiber's OUTCOME, that is `fiber.addObserver(exit => …)`,
// which is synchronous and one line. An earlier version of this file wrapped it as
// `onExit`; nothing ever called the wrapper, so it is gone.

import type GObject from 'gi://GObject?version=2.0';
import type Gtk from 'gi://Gtk?version=4.0';

import { Effect, Exit, Scope } from 'effect';
import type * as Fiber from 'effect/Fiber';

/** A scope plus the means to close it early and stop listening. */
export interface WidgetScope {
    readonly scope: Scope.Closeable;
    /** Close now and disconnect the triggers. Idempotent. */
    readonly close: () => void;
}

/**
 * A `Scope` closed by one or more signals on `source`, whichever fires first.
 *
 * Shared by the two functions below, and exported because a widget with a
 * different end-of-life signal — a `Gtk.ListItem` being recycled, a page leaving
 * an `Adw.NavigationView` — needs the same thing with a different name.
 */
export const signalScope = (source: GObject.Object, signals: ReadonlyArray<string>): WidgetScope => {
    const scope = Scope.makeUnsafe('sequential');
    let closed = false;
    let handlers: Array<number> = [];

    const disconnect = () => {
        for (const handler of handlers) source.disconnect(handler);
        handlers = [];
    };

    const close = () => {
        if (closed) return;
        closed = true;
        disconnect();
        // `closeUnsafe` returns the REST of the close as an Effect when the
        // finalizers did not all complete synchronously, and `undefined` when they
        // did. MEASURED: it returns an Effect even for a single `Effect.sync`
        // finalizer — but running that Effect completes it synchronously, so the
        // finalizers HAVE run by the time this function returns. That matters: the
        // alternative reading, "cleanup happens eventually", would make the whole
        // arrangement useless for releasing anything the widget's dispose needs
        // released.
        const remaining = Scope.closeUnsafe(scope, Exit.void);
        if (remaining !== undefined) Effect.runFork(remaining);
    };

    handlers = signals.map((signal) =>
        source.connect(signal, () => {
            close();
            // `close-request` is one of the signals installed by `windowScope`, and
            // it is a `G_SIGNAL_RUN_LAST` boolean: a truthy return STOPS the close.
            // Returning `false` says "not handled here", which is what a lifetime
            // observer means. A handler that returned nothing would work today and
            // break the day someone adds a signal with a different accumulator.
            return false;
        }),
    );

    return { scope, close };
};

/**
 * A `Scope` closed when `widget` is DISPOSED — the boundary after which no fiber
 * may touch it.
 *
 * Note what this does not do: `gtk_window_destroy()` does not emit `destroy` while
 * a reference is held, so a window closed by the application keeps this scope open.
 * For a window, use {@link windowScope}.
 */
export const widgetScope = (widget: Gtk.Widget): WidgetScope => signalScope(widget, ['destroy']);

/**
 * A `Scope` closed when `window` leaves the screen OR is disposed, whichever comes
 * first — the lifetime an application means when it says "while this window is
 * open".
 */
export const windowScope = (window: Gtk.Window): WidgetScope => signalScope(window, ['close-request', 'destroy']);

/**
 * Start `effect` as a fiber owned by `scope`. Closing the scope interrupts it, and
 * its finalizers run before the close completes.
 *
 * Returns the `Fiber` rather than a promise on purpose: the caller is a signal
 * handler that must return NOW, and a promise there is a value GTK will
 * misinterpret. If you need the outcome, that is `fiber.addObserver(exit => …)`,
 * which is synchronous and one line.
 */
export const runInScope = <A, E>(scope: Scope.Scope, effect: Effect.Effect<A, E, never>): Fiber.Fiber<A, E> =>
    // `runSync` and not `runFork`, and the difference is not stylistic:
    // `Effect.forkIn` is itself an Effect that YIELDS the fiber, so
    // `runFork(forkIn(…))` hands back a `Fiber<Fiber<A, E>>` — an outer fiber that
    // completes immediately with the real one as its value. Measured: polling it
    // returns a completed Exit while the work is still running, which reads exactly
    // like "the scope never started anything".
    Effect.runSync(Effect.forkIn(effect, scope));
