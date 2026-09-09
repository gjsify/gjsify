// The FOURTH door into a widget of this package — GJS's signal verbs on every class.
//
// WHY IT EXISTS. This port already emits the GObject SIGNAL NAMES: `adw-switch-row.ts`
// exports `NOTIFY_ACTIVE = 'notify::active'` and says so. Only the SUBSCRIBE VERB
// differed. A GJS snippet writes `row.connect('notify::active', cb)` and gets a numeric
// handler id back, `row.disconnect(id)` removes exactly that one; the port offered
// NativeScript's `on()` / `addEventListener()`, which return nothing. So the one line
// every event snippet has could not run verbatim, on a surface where the widget name,
// the property names and the construct-props bag already can (ADR 0034 § Amendment 14).
//
// WHY A MIXIN AT `extends`, WHEN THE BAG IS A FUNCTION CALLED PER CONSTRUCTOR. ADR 0034
// § Amendment 13 refused a base class and a mixin for the construct-props bag: the
// widget classes extend EIGHT different `@nativescript/core` bases, and the bag has to
// run LAST in each concrete class's OWN constructor, after that class's children exist.
// Both reasons are about constructor ORDER, and neither reaches a METHOD. `connect` and
// `disconnect` carry no per-class state and run whenever a caller says, so the natural
// place for them is where the port MEETS the platform — the `extends` of every class
// whose base is a `@nativescript/core` class — and a subclass of a port class inherits
// them like any other method. That is one token per such class, `extends
// withSignals(GridLayout)`, and no per-class body at all; a TypeScript mixin keeps the
// base's own type surface (the objection to a mixin in § Amendment 13 was re-declaring
// eight of them, which a generic one does not). Held by arm 6 of
// `check-nativescript-xml-doors.mjs`: a class extending a platform base without the
// wrapper fails, and so does a port-derived class wrapping again.
//
// THE NAMES DO NOT SHADOW ANYTHING. Measured against `@nativescript/core@9.1.0-alpha.11`,
// the version the storybook showcase installs: `Observable`, `ViewBase`, `View`,
// `LayoutBase` and their platform variants declare no `connect` and no `disconnect` —
// the one `disconnect()` in the whole package is `GesturesObserver`'s, which is not a
// view and not a base of anything here — and no runtime `.js` assigns either name. This
// matters because the base is hostile territory: `ViewBase`'s own constructor ASSIGNS
// `this.cssClasses = new Set()`, so a name it owns, taken by a subclass, kills the widget
// inside its own constructor (the `styleClasses` entry in
// `scripts/check-vocabulary-alignment.mjs` records that incident). The ambient slice in
// `../ns-core.d.ts` cannot hold this in the other direction — a name a future core adds
// would be shadowed by this mixin without a type error — so the measurement is written
// here with its version, and `status/open-todos.md` carries the rest of that limit.
//
// WHAT THE CALLBACK RECEIVES. GJS passes the emitting object FIRST, then the signal's own
// arguments — `(self, pspec)` for a `notify::` signal. NativeScript passes one payload
// object. The callback here gets `(self, data)`: `self` is what a verbatim GJS snippet
// reads (`row.connect('notify::active', (row) => row.active)`), and `data` is the
// NativeScript payload, which is what the port's own `notify::` events carry the new
// value in. A `GParamSpec` is not reconstructed: a snippet reading `pspec.name` is the
// declared remainder, and the value it wants is on `self`.
//
// AN UNKNOWN HANDLER ID THROWS. `g_signal_handler_disconnect` logs a CRITICAL for an id
// nothing holds and returns; GJS surfaces it as a warning, fatal only under
// `G_DEBUG=fatal-criticals`. The port throws instead, for the reason the construct-props
// bag throws on an unknown key: a silent no-op is the failure `xml-values.ts` exists to
// refuse, and a disconnect that quietly did nothing leaves a handler firing after the
// caller was told it was gone.

import type { EventData, Observable } from '@nativescript/core';

/** What `connect` records per handler, keyed on the id it handed back. */
interface Handler {
    readonly eventName: string;
    readonly listener: (data: EventData) => void;
}

/**
 * The handlers every instance holds, keyed on the instance.
 *
 * A module-level `WeakMap` rather than an instance field so the mixin adds NO own
 * property to a widget: an own field would be a name that could collide with a base's
 * (the hazard above), and it would show up in the construct-props bag's key set, which
 * is derived from the class's members.
 */
const HANDLERS = new WeakMap<object, Map<number, Handler>>();

/**
 * Handler ids are unique across the process, never per instance, as GObject's are:
 * `g_signal_connect` hands out one counter's values to every object, so an id says
 * which handler without saying which object. Starts at 1 because 0 is what
 * `g_signal_connect` returns on failure.
 */
let nextHandlerId = 1;

/** The two methods the mixin adds. Named so a consumer can annotate with it. */
export interface GObjectSignals {
    /**
     * Subscribe to `eventName` — a NativeScript event, or one of the `notify::<prop>`
     * events this port's widgets emit — and get back the id that `disconnect` takes.
     *
     * The callback receives the emitting widget FIRST, as a GJS signal handler does,
     * then the NativeScript payload.
     */
    connect(eventName: string, callback: (self: this, data: EventData) => void): number;
    /** Remove exactly the handler `connect` returned this id for. Throws on an id nothing holds. */
    disconnect(handlerId: number): void;
}

/**
 * A constructor the mixin can wrap: anything that is an `Observable`, abstract or not.
 *
 * `any[]` and not `unknown[]`: TypeScript accepts a mixin base only as a constructor with a
 * single rest parameter of type `any[]` (TS2545), so the wider spelling is the one the
 * language requires here rather than a shortcut.
 */
// oxlint-disable-next-line typescript/no-explicit-any -- TS2545 admits no other spelling for a mixin base
export type ObservableConstructor = abstract new (...args: any[]) => Observable;

/**
 * Give a `@nativescript/core` base GJS's `connect` / `disconnect`.
 *
 * Applied ONCE per class that extends a platform base — `extends withSignals(GridLayout)`
 * — and never on a class whose base is already a widget of this package, which inherits
 * the two methods and would otherwise carry a second, identical copy one prototype up.
 */
export function withSignals<TBase extends ObservableConstructor>(Base: TBase) {
    abstract class WithSignals extends Base implements GObjectSignals {
        connect(eventName: string, callback: (self: this, data: EventData) => void): number {
            // One wrapper per connect, so two handlers sharing a callback stay two
            // handlers — `removeEventListener(name, callback)` would drop both.
            const listener = (data: EventData): void => callback(this, data);
            const id = nextHandlerId++;
            let handlers = HANDLERS.get(this);
            if (handlers === undefined) {
                handlers = new Map();
                HANDLERS.set(this, handlers);
            }
            handlers.set(id, { eventName, listener });
            this.addEventListener(eventName, listener);
            return id;
        }

        disconnect(handlerId: number): void {
            const handler = HANDLERS.get(this)?.get(handlerId);
            if (handler === undefined) {
                throw new TypeError(
                    `${this.constructor.name} has no handler with id ${handlerId}. connect() hands out each id ` +
                        'once and disconnect() takes it once; a second disconnect, or an id another widget ' +
                        'returned, is refused here rather than left as a silent no-op.',
                );
            }
            this.removeEventListener(handler.eventName, handler.listener);
            HANDLERS.get(this)?.delete(handlerId);
        }
    }
    return WithSignals;
}
