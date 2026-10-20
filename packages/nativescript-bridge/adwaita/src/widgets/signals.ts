// The FOURTH door into a widget of this package — GJS's signal verbs on every class.
//
// WHY IT EXISTS. This port already emits the GObject SIGNAL NAMES: `adw-switch-row.ts` exports
// `NOTIFY_ACTIVE = 'notify::active'` and says so. Only the SUBSCRIBE VERB differed. A GJS
// snippet writes `row.connect('notify::active', cb)` and gets a numeric handler id back,
// `row.disconnect(id)` removes exactly that one; the port offered NativeScript's `on()` /
// `addEventListener()`, which return nothing. So the one line every event snippet has could not
// run verbatim, on a surface where the widget name, the property names and the construct-props
// bag already can (ADR 0034 § Amendment 14).
//
// WHY A MIXIN AT `extends`, WHEN THE BAG IS A FUNCTION CALLED PER CONSTRUCTOR. ADR 0034
// § Amendment 13 refused a base class and a mixin for the construct-props bag: the widget
// classes extend EIGHT different `@nativescript/core` bases, and the bag has to run LAST in
// each concrete class's OWN constructor, after that class's children exist. Both reasons are
// about constructor ORDER, and neither reaches a METHOD. `connect` and `disconnect` carry no
// per-class state, so the natural place for them is where the port MEETS the platform — the
// `extends` of every class whose base is a `@nativescript/core` class — and a subclass of a
// port class inherits them like any other method: one token per such class, `extends
// withSignals(GridLayout)`, no per-class body at all. Held by arm 6 of
// `check-nativescript-xml-doors.mjs`: a class extending a platform base without the wrapper
// fails, and so does a port-derived class wrapping again.
//
// THE NAMES DO NOT SHADOW ANYTHING. Measured against `@nativescript/core@9.1.0-alpha.11`, the
// version the storybook showcase installs: `Observable`, `ViewBase`, `View`, `LayoutBase` and
// their platform variants declare no `connect` and no `disconnect` — the one `disconnect()` in
// the whole package is `GesturesObserver`'s, not a view and not a base of anything here — and
// no runtime `.js` assigns either name. This matters because the base is hostile territory:
// `ViewBase`'s own constructor ASSIGNS `this.cssClasses = new Set()`, so a name it owns, taken
// by a subclass, kills the widget inside its own constructor (the `styleClasses` entry in
// `scripts/check-vocabulary-alignment.mjs` records that incident). The ambient slice in
// `../ns-core.d.ts` cannot hold this in the other direction, so the measurement is written
// here with its version.
//
// WHAT THE CALLBACK RECEIVES. GJS passes the emitting object FIRST, then the signal's own
// arguments — `(self, pspec)` for a `notify::` signal. NativeScript passes one payload object.
// The callback here gets `(self, data)`: `self` is what a verbatim GJS snippet reads (`row
// .connect('notify::active', (row) => row.active)`), and `data` is what the port's own
// `notify::` events carry the new value in. A `GParamSpec` is not reconstructed: a snippet
// reading `pspec.name` is the declared remainder, and the value it wants is on `self`.
//
// THE SEAM CARRIES `GtkWidget`'s LAYOUT PROPERTIES TOO. This mixin is the one place every
// class meets the platform, which makes it the one place a property every GTK widget inherits
// can be written once: `withSignals` applies `withGtkWidgetLayout` (`widget-layout.ts`)
// beneath itself, so `halign`, `valign`, `hexpand`, `vexpand`, `marginStart` and `marginEnd`
// arrive with `connect` on every class and on every class a later change adds. Held against
// the ambient slice the same way as the two method names above: `View` declares none of the six.
//
// AN UNKNOWN HANDLER ID THROWS. `g_signal_handler_disconnect` logs a CRITICAL for an id nothing
// holds and returns; GJS surfaces it as a warning, fatal only under `G_DEBUG=fatal-criticals`.
// The port throws instead, for the reason the construct-props bag throws on an unknown key: a
// silent no-op is the failure `xml-values.ts` exists to refuse, and a disconnect that quietly
// did nothing leaves a handler firing after the caller was told it was gone.
//
// --- THE SECOND ARGUMENT: A REAL GObject UNDER THE WIDGET (ADR 0105 § 2, route D) --------------
//
// `withSignals(Base, meta)` is the same seam with a DECLARATION attached: `meta` says what
// properties and signals the class has, in the port's own vocabulary, and the seam then builds
// them one of two ways — out of a real GType registered over the `@nativescript/core` base
// (Android, the default there since ADR 0110), or out of the JS store below (browser, iOS,
// anything off-device). Both legs answer the same consumer API: the same property names in all
// three spellings, the same `notify::<prop>`, the same `connect` / `disconnect` / `emit`.
//
// `meta === undefined` IS THE OLD SEAM, BYTE FOR BYTE. Nothing is registered, nothing is
// generated, no engine is consulted — the ~39 widgets that have not migrated carry no risk from
// this at all, and a widget migrates by gaining a `Properties` block and losing its accessors.
//
// WHY THE ENGINE IS READ AT FIRST CONSTRUCTION AND NOT AT CLASS EVALUATION. `engineForTarget`
// FREEZES the engine slot when it is read, and a widget module's body runs the moment anything
// imports the barrel — so asking there would freeze the slot before the app's own first
// statement and make `useRealGObjectEngine` throw "registered too late" for the ordinary import
// order. So the question is asked LAZILY, once, from the mixin's constructor: importing a widget
// never freezes anything, and the slot is read strictly later than today's freeze point.
//
// WHAT THAT WIDENS. On Android, where an empty slot is a missing decision rather than a default,
// the refusal now reaches a widget's first CONSTRUCTION rather than only an import of
// `/gobject`. That is deliberate and it is ADR 0110's rule applied where it bites: an app that
// has decided neither way is told so at the first widget it builds, instead of silently getting
// the subset.
//
// WHY THE REGISTRATION GOES ON THE MIXIN CLASS. `registerClass` wants one class per GType and
// `WithSignals` is exactly one per widget class — stable, shared by every instance and by any
// port subclass, where `new.target` would be a different class per subclass and would try to
// register the same GType name twice.
//
// WHY THE SEAM OWNS THE ACCESSORS UNDER ROUTE D. node-gi reads a property out of the GObject's
// own store (`NodeGiGetProperty`), not out of a JS getter — so a widget that kept `get title()`
// would shadow the installed accessor with one the store never sees, and `bind_property` would
// bind to a value nothing writes. The declaration is therefore the only place a migrated
// widget's property lives, and `declare title: string;` is what keeps its TYPE and its docs.

import type { EventData, Observable } from '@nativescript/core';
import { engineForTarget, type ForeignClassMeta, type ForeignProperty } from '@gjsify/adwaita-core';

import { ENGINE_TARGET } from '../engine-target.js';
import { camelProperty, readGtkProperty, writeGtkProperty } from './shadowed-properties.js';
import { withGtkWidgetLayout } from './widget-layout.js';
import { watchMapping, WIDGET_SIGNALS } from './widget-mapping.js';

/** The shape of `HandledAccumulator` (adwaita-core) a signal payload may carry; read structurally. */
interface HandledAccumulatorLike {
    readonly stopped: boolean;
    collect(returned: unknown): void;
}

/** What `connect` records per handler, keyed on the id it handed back. */
interface Handler {
    readonly eventName: string;
    readonly listener: (data: EventData) => void;
    /** Ends the `map` / `unmap` watch a handler of either started. */
    readonly unwatch?: () => void;
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

/**
 * Where a route-D handler id starts. `g_signal_connect`'s ids and {@link nextHandlerId}'s are
 * two counters that know nothing of each other, and `disconnect(id)` has to send an id back to
 * the one that minted it. Offsetting the real ones keeps the two spaces disjoint without a
 * per-instance lookup table, and leaves `nextHandlerId` a billion ids before they could meet.
 */
const GOBJECT_ID_BASE = 0x4000_0000;

/** The real handler ids live on an instance, so an id nothing holds is still refused. */
const REAL_HANDLERS = new WeakMap<object, Set<number>>();

/** The declared property values of an instance on the PURE-JS leg; route D uses the GObject. */
const VALUES = new WeakMap<object, Map<string, unknown>>();

/** The refusal `disconnect` throws, worded the same whichever leg minted the id. */
function unknownHandler(self: object, handlerId: number): TypeError {
    return new TypeError(
        `${self.constructor.name} has no handler with id ${handlerId}. connect() hands out each id ` +
            'once and disconnect() takes it once; a second disconnect, or an id another widget ' +
            'returned, is refused here rather than left as a silent no-op.',
    );
}

// The pure-JS leg, as module-level functions rather than only as class methods: under route D the
// class methods become ROUTERS that still answer everything GObject does not own (NativeScript's
// own events, `WIDGET_SIGNALS`, the handled-accumulator protocol), and a router calling a method
// it had just replaced is how the two legs would drift apart.

function pureConnect(self: Observable, eventName: string, listener: (data: EventData) => void): number {
    const id = nextHandlerId++;
    let handlers = HANDLERS.get(self);
    if (handlers === undefined) {
        handlers = new Map();
        HANDLERS.set(self, handlers);
    }
    const unwatch = WIDGET_SIGNALS.includes(eventName) ? watchMapping(self) : undefined;
    handlers.set(id, { eventName, listener, unwatch });
    self.addEventListener(eventName, listener);
    return id;
}

function pureDisconnect(self: Observable, handlerId: number): void {
    const handler = HANDLERS.get(self)?.get(handlerId);
    if (handler === undefined) throw unknownHandler(self, handlerId);
    self.removeEventListener(handler.eventName, handler.listener);
    handler.unwatch?.();
    HANDLERS.get(self)?.delete(handlerId);
}

function pureEmit(self: Observable, eventName: string, args: readonly unknown[]): void {
    self.notify({ eventName, object: self, args });
}

/**
 * The three spellings GObject answers a property in — `can-close`, `can_close`, `canClose` —
 * deduplicated, because a single-word name is all three at once.
 */
function spellingsOf(name: string): string[] {
    return [...new Set([name, name.replace(/-/g, '_'), camelProperty(name)])];
}

/**
 * `notify` on a class that DECLARES properties — GJS's `notify('<prop>')` beside NativeScript's
 * `notify({ eventName })`, which is how both legs install it (node-gi routes on the argument's
 * type, and the pure-JS leg imitates that).
 *
 * A migrated widget declares it the same way it declares its properties — `declare notify:
 * GObjectNotify;` — rather than the mixin typing it for every class, because a class with no
 * declaration HAS no property to name and the string form would be a type that lies about 39
 * widgets. One line, beside the `declare` lines the migration already brings.
 */
export interface GObjectNotify {
    /** `g_object_notify`: emit `notify::<propertyName>`. Throws on a name the class never declared. */
    (propertyName: string): void;
    /** NativeScript's own: dispatch `data` to the listeners of `data.eventName`. */
    <T extends EventData>(data: T): void;
}

/** The two methods the mixin adds. Named so a consumer can annotate with it. */
export interface GObjectSignals {
    /**
     * Subscribe to `eventName` — a NativeScript event, or one of the `notify::<prop>`
     * events this port's widgets emit — and get back the id that `disconnect` takes.
     *
     * The callback receives the emitting widget FIRST, as a GJS signal handler does,
     * then the NativeScript payload.
     */
    connect(eventName: string, callback: (self: this, data: EventData) => unknown): number;
    /** Remove exactly the handler `connect` returned this id for. Throws on an id nothing holds. */
    disconnect(handlerId: number): void;
    /** `g_signal_emit_by_name`: run every handler `connect` added for `eventName`, with `args` in the payload. */
    emit(eventName: string, ...args: unknown[]): void;
    /**
     * `g_object_get_property`: the GTK property `name` (`'can-close'` or camel case). A
     * name NativeScript owns as something else is read through the class's `get_<p>()`.
     */
    get_property(name: string): unknown;
    /** `g_object_set_property`, routed the same way as {@link get_property}. */
    set_property(name: string, value: unknown): void;
}

/**
 * Every signal `ctor` emits: the own `emittedSignals` of each class up its chain, base first.
 * A class declares only what it adds, so `GtkButton`'s `clicked` does not hide `map`.
 */
export function emittedSignalsOf(ctor: unknown): readonly string[] {
    const chain: unknown[] = [];
    for (let at = ctor; typeof at === 'function'; at = Object.getPrototypeOf(at)) chain.unshift(at);
    const all = new Set<string>();
    for (const each of chain) {
        if (!Object.hasOwn(each as object, 'emittedSignals')) continue;
        for (const name of (each as { emittedSignals: readonly string[] }).emittedSignals) all.add(name);
    }
    return [...all];
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
 * Give a `@nativescript/core` base GJS's `connect` / `disconnect`, and `GtkWidget`'s layout
 * properties with them ({@link withGtkWidgetLayout}).
 *
 * Applied ONCE per class that extends a platform base — `extends withSignals(GridLayout)`
 * — and never on a class whose base is already a widget of this package, which inherits
 * the two methods and would otherwise carry a second, identical copy one prototype up.
 */
export function withSignals<TBase extends ObservableConstructor>(Base: TBase, meta?: ForeignClassMeta) {
    // Every spelling of a declared property, mapped to its CANONICAL name — the one GObject's
    // `notify::` detail and `bind_property` take.
    const canonicalOf = new Map<string, string>();
    for (const name of Object.keys(meta?.Properties ?? {})) {
        for (const spelling of spellingsOf(name)) canonicalOf.set(spelling, name);
    }
    const declaredSignals = new Set(Object.keys(meta?.Signals ?? {}));

    /**
     * The key GObject owns for `eventName`, or `null` when the pure-JS leg does. A declared
     * signal and a `notify::` of a declared property are GObject's; a NativeScript event, a
     * `WIDGET_SIGNALS` entry and the handled-accumulator protocol are not and never become so.
     *
     * It is also what CANONICALISES a detail, which is why the pure-JS leg asks it too: three
     * spellings of a property are one property, so `notify::can_close` has to reach a handler
     * connected to `notify::canClose` on either leg. Route D gets that from this map; without
     * it the pure leg would emit only `notify::can-close` and silently drop the other two.
     */
    function giKeyOf(eventName: string): string | null {
        if (declaredSignals.has(eventName)) return eventName;
        if (!eventName.startsWith('notify::')) return null;
        const canonical = canonicalOf.get(eventName.slice('notify::'.length));
        return canonical === undefined ? null : `notify::${canonical}`;
    }

    // The realization state is THIS call's, not a WeakMap's: one `withSignals(...)` call is one
    // widget class, and a port subclass sharing its parent's mixin shares its registration,
    // which is what GObject inheritance does too.
    let realized = false;
    let routeD = false;
    let giConnect: ((this: object, key: string, handler: (...args: unknown[]) => unknown) => number) | undefined;
    let giDisconnect: ((this: object, id: number) => void) | undefined;
    let giEmit: ((this: object, key: string, ...args: unknown[]) => unknown) | undefined;

    abstract class WithSignals extends withGtkWidgetLayout(Base) implements GObjectSignals {
        /**
         * What every widget emits; a class's own list adds to it (`emittedSignalsOf`). A
         * declared property's `notify::` and a declared signal are emitted by the seam itself,
         * so they belong here rather than in each migrated widget's own list.
         */
        static readonly emittedSignals: readonly string[] = [
            ...WIDGET_SIGNALS,
            ...declaredSignals,
            ...Object.keys(meta?.Properties ?? {}).map((name) => `notify::${name}`),
        ];

        // oxlint-disable-next-line typescript/no-explicit-any -- TS2545 admits no other spelling for a mixin base
        constructor(...args: any[]) {
            super(...args);
            realize();
        }

        connect(eventName: string, callback: (self: this, data: EventData) => unknown): number {
            const key = giKeyOf(eventName);
            if (routeD && key !== null) {
                // GJS hands a handler `(self, ...args)`; this port hands it `(self, data)` with
                // the port's own payload, so the real emission is reshaped into one. A
                // `notify::` carries a GParamSpec in GJS and a bare payload here, as the
                // pure-JS leg's does — the value a snippet wants is on `self`.
                const isNotify = key.startsWith('notify::');
                const real = giConnect!.call(this, key, (self: unknown, ...rest: unknown[]) => {
                    const object = self as Observable;
                    const data = (isNotify ? { eventName, object } : { eventName, object, args: rest }) as EventData;
                    return callback(self as this, data);
                });
                let live = REAL_HANDLERS.get(this);
                if (live === undefined) REAL_HANDLERS.set(this, (live = new Set()));
                live.add(real);
                return GOBJECT_ID_BASE + real;
            }
            // One wrapper per connect, so two handlers sharing a callback stay two
            // handlers — `removeEventListener(name, callback)` would drop both.
            // A payload carrying an `accumulator` is a signal with a handled-accumulator (`close-request`):
            // handlers after the one that took it over do not run, and each return value is folded in.
            const listener = (data: EventData): void => {
                const accumulator = (data as { accumulator?: HandledAccumulatorLike }).accumulator;
                if (accumulator === undefined) {
                    callback(this, data);
                    return;
                }
                if (accumulator.stopped) return;
                accumulator.collect(callback(this, data));
            };
            return pureConnect(this, key ?? eventName, listener);
        }

        disconnect(handlerId: number): void {
            if (handlerId >= GOBJECT_ID_BASE) {
                const real = handlerId - GOBJECT_ID_BASE;
                // The port's contract, not GObject's: an id nothing holds throws here too,
                // where `g_signal_handler_disconnect` would only log a CRITICAL.
                if (REAL_HANDLERS.get(this)?.delete(real) !== true) throw unknownHandler(this, handlerId);
                giDisconnect!.call(this, real);
                return;
            }
            pureDisconnect(this, handlerId);
        }

        emit(eventName: string, ...args: unknown[]): void {
            const key = giKeyOf(eventName);
            if (routeD && key !== null) {
                giEmit!.call(this, key, ...args);
                return;
            }
            pureEmit(this, key ?? eventName, args);
        }

        get_property(name: string): unknown {
            return readGtkProperty(this, camelProperty(name));
        }

        set_property(name: string, value: unknown): void {
            writeGtkProperty(this, camelProperty(name), value);
        }
    }

    const prototype = WithSignals.prototype as unknown as Record<string, unknown>;
    /** The class methods above, held before route D deletes them to make room for GObject's. */
    const ROUTERS = {
        connect: WithSignals.prototype.connect,
        disconnect: WithSignals.prototype.disconnect,
        emit: WithSignals.prototype.emit,
    };

    /**
     * Asks — once, at the first construction of any instance of this class — which leg this
     * build runs on, and builds it. See the header for why this is not class-evaluation time.
     */
    function realize(): void {
        if (realized) return;
        realized = true;
        if (meta === undefined) return;
        const engine = engineForTarget(ENGINE_TARGET);
        if (engine?.supportsForeignParentClasses === true) {
            registerRouteD(engine.registerForeignClass.bind(engine));
            return;
        }
        installPureJsProperties();
    }

    function registerRouteD(register: (klass: object, meta: ForeignClassMeta) => void): void {
        // node-gi SKIPS any member name the prototype chain already answers, starting at
        // `klass.prototype` itself, and records the skip in the frozen static `$foreignSkipped`.
        // The four names below are the ones this seam must get the REAL implementation of: the
        // class methods are deleted so the registration installs them, and `connect`, `disconnect`
        // and `emit` are put back afterwards as routers over what it installed. `notify` is left
        // as node-gi wrote it — its own arg-type routing captured `Observable.prototype.notify`
        // as the host half, which is exactly the behaviour the pure-JS leg installs by hand.
        //
        // `get_property` / `set_property` stay, and so appear in `$foreignSkipped`: node-gi's
        // are the two-argument introspected form and this port's are the one-argument door its
        // widgets already use.
        delete prototype.connect;
        delete prototype.disconnect;
        delete prototype.emit;
        delete prototype.notify;
        register(WithSignals, meta!);
        giConnect = prototype.connect as typeof giConnect;
        giDisconnect = prototype.disconnect as typeof giDisconnect;
        giEmit = prototype.emit as typeof giEmit;
        if (giConnect === undefined || giDisconnect === undefined || giEmit === undefined) {
            throw new Error(
                `Registering '${meta!.GTypeName}' over its NativeScript base installed no ` +
                    'connect/disconnect/emit, so the widget would answer neither GObject nor this port. ' +
                    'ADR 0105 refuses a silent fallback here: the subset is reachable only by calling ' +
                    "usePureJsGObjectEngine() from '@gjsify/adwaita-core' before the port loads.",
            );
        }
        for (const [name, method] of Object.entries(ROUTERS)) {
            Object.defineProperty(prototype, name, {
                configurable: true,
                writable: true,
                enumerable: false,
                value: method,
            });
        }
        routeD = true;
    }

    /**
     * The other leg: the declared properties as ordinary accessors over a JS store, and GJS's
     * `notify('<prop>')` beside NativeScript's `notify({ eventName })`. Deliberately the same
     * rules node-gi's own accessors follow, so a widget behaves alike on both — an equal write
     * is not a change, a read MATERIALISES the default so that a later default-equal write is
     * not one either, and a spelling the host chain already owns is left to it.
     */
    function installPureJsProperties(): void {
        const hostNotify = prototype.notify as (this: object, ...args: unknown[]) => unknown;
        for (const [name, property] of Object.entries(meta!.Properties ?? {})) {
            const fallback = defaultValueOf(property);
            for (const spelling of spellingsOf(name)) {
                if (spelling in prototype) continue;
                Object.defineProperty(prototype, spelling, {
                    configurable: true,
                    enumerable: false,
                    get(this: object): unknown {
                        const values = valuesOf(this);
                        if (!values.has(name)) values.set(name, fallback);
                        return values.get(name);
                    },
                    set(this: Observable, value: unknown): void {
                        const values = valuesOf(this);
                        if (values.has(name) && values.get(name) === value) return;
                        values.set(name, value);
                        pureEmit(this, `notify::${name}`, []);
                    },
                });
            }
        }
        Object.defineProperty(prototype, 'notify', {
            configurable: true,
            writable: true,
            enumerable: false,
            value(this: Observable, data: unknown, ...rest: unknown[]): unknown {
                if (typeof data !== 'string') return hostNotify.call(this, data, ...rest);
                const canonical = canonicalOf.get(data);
                if (canonical === undefined) {
                    throw new TypeError(
                        `${this.constructor.name} has no property '${data}' to notify. The declared ones are ` +
                            `${[...canonicalOf.keys()].join(', ') || '(none)'}; a NativeScript event is notified ` +
                            'with its payload object, not with a name.',
                    );
                }
                pureEmit(this, `notify::${canonical}`, []);
                return undefined;
            },
        });
    }

    return WithSignals;
}

function valuesOf(instance: object): Map<string, unknown> {
    let values = VALUES.get(instance);
    if (values === undefined) VALUES.set(instance, (values = new Map()));
    return values;
}

/** What a declared property reads as before anything writes it — GObject's own kind defaults. */
function defaultValueOf(property: ForeignProperty): unknown {
    if (property.default !== undefined) return property.default;
    if (property.kind === 'string') return '';
    return property.kind === 'boolean' ? false : 0;
}
