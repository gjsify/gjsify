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
// ONE DOOR PER DECLARED MEMBER, AND IT IS `connect`. A declared property's `notify::<prop>` and
// a declared signal belong to GObject, so the NativeScript verbs REFUSE them by name —
// `addEventListener`, `removeEventListener` and therefore `on`, `once` and `off` throw a
// TypeError naming `connect`, identically on both legs. The first shape of this was worse than
// either: route D made `addEventListener('notify::active')` a silent no-op while the pure-JS leg
// still fired it, so the same line worked off-device and did nothing on it. A refusal is the
// only reading that is both GJS-like (GJS has one subscribe verb) and leg-independent, and the
// repository carries NO backward compatibility for the old spelling — there are no third-party
// apps on this port, so a consumer of ours is UPDATED rather than kept working by a shim (the
// rule is recorded in `status/open-todos/nativescript.md`).
//
// OVERRIDING TWO NAMES COVERS FIVE VERBS. Measured in `@nativescript/core` 9.0.20 and 9.1.3
// (`data/observable/index.js`): `on` and `once` call `this.addEventListener`, `off` calls
// `this.removeEventListener`, and `View` overrides only the latter two — so the three aliases
// funnel through the overrides below and need no separate copies. The slice in `../ns-core.d.ts`
// declares the two; the aliases are the real package's and are not re-declared here.
//
// `notify({ eventName: 'notify::<prop>' })` IS REFUSED TOO. It is NativeScript's dispatch door,
// and a declared member has no NativeScript listeners to dispatch to — the subscribe door above
// refuses them — so the call could only ever reach nobody. On the pure-JS leg the seam's own
// `notify` wrapper refuses it; on route D the refusal wraps the `notify` node-gi installed
// (which is why the seam no longer leaves that one untouched), so both legs answer the same.
// The STRING form is unaffected on either: `notify('active')` is `g_object_notify`.
//
// A HANDLER EXCEPTION IS LOGGED AND THE NEXT HANDLER RUNS — on both legs, because that is what
// GJS does. Measured with the installed `gjs`: a `notify::` handler that throws produces
// `Gjs-CRITICAL … JS ERROR: Error: boom from handler`, the second handler still runs, the
// assignment returns normally and the property keeps the written value; `emit` of an ordinary
// signal behaves the same. node-gi reaches the same behaviour from `SurfacePendingException`
// (`packages/node-gi/node-gi/src/calls.cc`), which prints `(node-gi) Unhandled exception in …`
// and clears the pending exception, so the real leg had it already. The pure-JS leg used to let
// the exception unwind its caller's `row.title = 'x'` instead, which was the second per-leg
// difference in this area; {@link emitDeclared} now logs and continues. The consequence is the
// one `adw-action-row.ts` records: a refusal may not live in a `notify::` handler, because
// nothing can see it. It belongs in a {@link DeclaredProperty.normalize}, which runs on both
// legs before the value lands.
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
// WHY THE REGISTRATION GOES ON THE MIXIN CLASS, AND WHAT `new.target` IS FOR. `registerClass`
// wants one class per GType and a mixin class is exactly one per widget class — stable, shared by
// every instance and by any port subclass, where registering `new.target` would be a different
// class per subclass and would try to register the same GType name twice. So the registration
// TARGET is always the mixin class. `new.target` is read for one other thing: to discover which
// mixin classes the instance being built actually has, so the WHOLE chain of them is realized
// base-first (see the next paragraph).
//
// A SECOND DOOR, FOR A WIDGET THAT EXTENDS ANOTHER WIDGET. `AdwSwitchRow extends AdwActionRow`
// adds `active` to a class that already declares four properties, and GObject answers that with
// a GType over a GType — which node-gi supports over a foreign parent, and which this seam
// reaches through {@link withProperties}: the same declaration mechanism as `withSignals`,
// without the `connect` / `disconnect` / `emit` routers and without `withGtkWidgetLayout`,
// because the base widget already carries both. Arm 6 of `check-nativescript-xml-doors.mjs`
// allows exactly this wrapper on a port base, and still refuses a second `withSignals`.
//
// WHY THE DECLARATION STATE IS A MODULE-LEVEL REGISTRY AND NOT EACH CALL'S CLOSURE. With two
// declarations in one chain, the methods that run on an `AdwSwitchRow` instance are the PARENT
// mixin's — `withProperties` installs none, so `connect` resolves to `AdwActionRow`'s router,
// whose closure knows nothing of `active`. So every declaration is recorded against its class in
// {@link DECLARATIONS}, a router resolves the instance's whole chain through
// {@link resolvedFor} (cached per concrete class), and the gi thunks come from the ancestor that
// installed them: a derived registration finds `connect` already on the chain and SKIPS it
// (measured — it lands in that class's `$foreignSkipped`), and the parent's captured thunk
// works on a leaf instance, delivering the leaf's own `notify::active` with the leaf as emitter.
//
// WHY THE WHOLE CHAIN IS REALIZED FROM THE BASE-MOST CONSTRUCTOR. The GType an instance attaches
// is decided the first time it touches a registered property, so every declaration in the chain
// has to be registered BEFORE any widget constructor body runs. The one place that is true is
// `WithSignals`'s constructor, after `super(...)`: realizing only `AdwActionRow`'s declaration
// there and leaving `AdwSwitchRow`'s for later meant the instance attached the PARENT's GType and
// the leaf's `active` did not exist on it at all.
//
// WHY THE SEAM OWNS THE ACCESSORS UNDER ROUTE D. node-gi reads a property out of the GObject's
// own store (`NodeGiGetProperty`), not out of a JS getter — so a widget that kept `get title()`
// would shadow the installed accessor with one the store never sees, and `bind_property` would
// bind to a value nothing writes. The declaration is therefore the only place a migrated
// widget's property lives, and `declare title: string;` is what keeps its TYPE and its docs.
//
// AND THE DECLARED NAMES DO NOT SHADOW ANYTHING EITHER. The measurement above is about `connect`,
// `disconnect` and the six layout properties; every migrated widget adds names of its own, and
// those meet the same hostile base — a name `ViewBase` assigns in its own constructor is dead on
// arrival. Measured against BOTH versions in play, `@nativescript/core@9.1.3` (what
// `tests/integration/nativescript-gi` installs, so the device legs) and `9.1.0-alpha.11` (the
// showcases): the `GridLayout`, `StackLayout` and `Switch` chains declare none of `title`,
// `subtitle`, `iconName` / `icon-name`, `activatable`, `activatableWidget`, `active`, `prefix`
// or `suffix`. Both halves were read, because either alone is a half answer: the `.d.ts` for
// each chain, and the runtime `.js` for a `Property({ name: … })`, a `defineProperty` and a bare
// `this.<name> =`. A name the host chain DOES own is not a disaster but it is not ours — the
// registration skips it rather than shadowing it, and says so in the frozen `$foreignSkipped`.

import type { EventData, Observable } from '@nativescript/core';
import {
    engineForTarget,
    type ForeignClassMeta,
    type ForeignObjectProperty,
    type ForeignProperty,
    type ForeignScalarProperty,
} from '@gjsify/adwaita-core';

import { ENGINE_TARGET } from '../engine-target.js';
import { camelProperty, readGtkProperty, writeGtkProperty } from './shadowed-properties.js';
import { withGtkWidgetLayout } from './widget-layout.js';
import { watchMapping, WIDGET_SIGNALS } from './widget-mapping.js';

/**
 * One arm of {@link ForeignProperty}, plus the one thing the engine's vocabulary has no room for:
 * how a value is brought into the property's shape BEFORE it is stored. The engine never sees
 * `normalize`.
 *
 * Applied per ARM rather than to the union, because `ForeignProperty` is a discriminated union
 * since ADR 0122 § 6 and `property.kind === 'object'` has to keep narrowing to the arm that
 * carries `valueType`.
 */
type Declared<P> = P & {
    /**
     * Replaces the seam's own coercion for EVERY write, typed or not — a floor, a clamp, a lenient
     * parse. Runs identically on both legs, ahead of the store and of the equal-write check, so a
     * write the normalizer maps onto the held value is not a change.
     *
     * `self` is the INSTANCE being written, so a normalizer may read the row's other properties:
     * `AdwEntryRow` clamps `text` to that row's own `max-length`, and derives `text-length` from
     * its own `text` — which is also how a property that is read-only upstream is held read-only
     * here, since a write that resolves to the value already held is not a change.
     */
    readonly normalize?: (value: unknown, self: object) => unknown;

    /**
     * Replaces the equal-write check for this property: `written` is the value as the caller
     * spelled it, `next` what {@link Declared.normalize} made of it, `held` what the store holds
     * — and the answer decides whether the write notifies at all.
     *
     * WHY. A C setter guards on `g_strcmp0 (value, adw_…_get_…(self))`, against the GETTER
     * READBACK rather than the stored field. Where storage normalises, the two differ and the
     * guard can never fire: `GtkImage` turns an empty icon name into "no icon", so writing `''`
     * to a button that already reads back `null` notifies EVERY time (measured on GJS 1.88.1 /
     * libadwaita 1.9.4). Comparing the held value says the opposite, and only the property whose
     * `normalize` collapses distinct writes onto one held value can tell the difference.
     *
     * RUNS ON BOTH LEGS. It used to run on the pure one alone, on the reasoning that "there the
     * guard IS the C one" — which holds for a widget wrapping a real C object and not for a
     * foreign-parent class, which has no C setter at all. On route D node-gi's generated setter
     * is an identity guard and nothing more (`installForeignPropertyAccessors` in `gi.js`), so a
     * property that left this to the real leg got the identity answer there and the measured one
     * off-device — the per-leg difference this seam exists to close.
     */
    readonly changed?: (next: unknown, held: unknown, written: unknown, self: object) => boolean;

    /**
     * The rest of the C setter: runs once this property's own `notify::<name>` is out, so a
     * setter that also drives OTHER properties emits in the order C does. For a property with
     * {@link ForeignScalarProperty.explicitNotify} it runs INSTEAD of that notify, and owes every
     * emission the write makes, its own included.
     *
     * WHY IT IS NOT `normalize`. A normalizer runs AHEAD of the store, so a cross-write made
     * there notifies before the property that caused it. `Adw.SplitButton` measures the other way
     * round — `label = 'Open'` on an icon button emits `label` first and the slots it clears
     * after — and the two cannot both be one hook. The SHAPE of a value still belongs to
     * `normalize`; what the write does to its siblings belongs here.
     *
     * RUNS ON BOTH LEGS, for the reason {@link Declared.changed} states: the foreign-parent class
     * route D registers has no C setter to do this instead. `adw-split-button`'s label/icon-name
     * mutual clear is the one that was silently missing on Android because of it.
     */
    readonly afterNotify?: (self: object) => void;
};

/** A declared property of any kind, with its optional {@link Declared.normalize}. */
export type DeclaredProperty = Declared<ForeignScalarProperty> | Declared<ForeignObjectProperty>;

/** {@link ForeignClassMeta} whose properties may carry a {@link DeclaredProperty.normalize}. */
export interface DeclaredClassMeta extends Omit<ForeignClassMeta, 'Properties'> {
    readonly Properties?: Readonly<Record<string, DeclaredProperty>>;
}

/**
 * What the seam does to a value on its way into a declared property, on BOTH legs.
 *
 * WHY IT EXISTS. NativeScript's XML builder assigns an attribute as `instance[name] = value` and
 * nothing else, so `<AdwSpinner spinning="false">` arrives as the STRING `'false'`. The pure-JS
 * leg would store that string, and the real leg hands it to node-gi, which converts as GJS does
 * (`JS_ToBoolean`): `'false'` is true. Neither is what the author wrote, and they are not even
 * wrong the same way. So a STRING written to a boolean or numeric property is parsed to the
 * declared type here, in the one place both legs pass through — every later widget inherits it.
 *
 * ONLY A STRING IS TOUCHED. A boolean or number written from TypeScript goes through unchanged,
 * to GObject's own conversion on the real leg and to the store on the pure one, so nothing a
 * typed caller does moves. A string that is not a boolean or number THROWS rather than falling
 * back to a default: `'maybe'` for a boolean, `''` or `'24px'` for a number. A widget that wants
 * a lenient reading says so with {@link DeclaredProperty.normalize}.
 */
function coerceDeclared(name: string, property: DeclaredProperty, value: unknown, self: object): unknown {
    if (property.normalize !== undefined) return property.normalize(value, self);
    return readDeclaredValue(name, property.kind, value);
}

/**
 * Whether a write to a held property notifies — identity, unless the property brought its own
 * {@link DeclaredProperty.changed}. Identity is what node-gi's accessors do and the default for
 * that reason; see `changed` for the one shape of property it cannot describe.
 */
function isDeclaredChange(
    property: DeclaredProperty,
    next: unknown,
    held: unknown,
    written: unknown,
    self: object,
): boolean {
    if (property.changed !== undefined) return property.changed(next, held, written, self);
    return held !== next;
}

/**
 * {@link coerceDeclared}'s string reading on its own, so a {@link DeclaredProperty.normalize} that
 * only wants to ADD a rule — a clamp, a floor — does not have to restate it. Without it every
 * normalizer re-decides what `<AdwEntryRow maxLength="12">` means, and XML would answer one way
 * for a property that has a normalizer and another way for one that does not.
 */
export function readDeclaredValue(name: string, kind: ForeignProperty['kind'], value: unknown): unknown {
    if (typeof value !== 'string' || kind === 'string') return value;
    const text = value.trim();
    if (kind === 'object') {
        // NOTHING is parsed into an object property. There is no spelling of a `Gio.ListModel` an
        // XML attribute could carry, and a markup author who wants one writes the MODEL attribute
        // the renderer's own door reads (ADR 0122 § 5) — so a string here is a mistake, and saying
        // so beats storing a string in a property whose ParamSpec would refuse it one leg later.
        throw new TypeError(`Property '${name}' holds an object; '${value}' is a string.`);
    }
    if (kind === 'boolean') {
        const lowered = text.toLowerCase();
        if (lowered === 'true') return true;
        if (lowered === 'false') return false;
        throw new TypeError(`Property '${name}' is a boolean; '${value}' is neither 'true' nor 'false'.`);
    }
    const parsed = text === '' ? Number.NaN : Number(text);
    if (!Number.isFinite(parsed)) throw new TypeError(`Property '${name}' is a number; '${value}' is not one.`);
    return parsed;
}

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

/** What `connect` records per handler of a DECLARED member on the pure-JS leg. */
interface DeclaredHandler {
    /** The CANONICAL key an emission matches on — `notify::icon-name`, `closed`. */
    readonly key: string;
    /** The spelling the caller subscribed with, echoed in the payload as route D echoes it. */
    readonly eventName: string;
    readonly callback: (self: Observable, data: EventData) => unknown;
}

/**
 * The handlers of a declared property's `notify::` and of a declared signal, on the pure-JS leg.
 *
 * The seam's OWN table rather than NativeScript's listener list, so that a declared member is
 * reachable through `connect` and through nothing else — on this leg as on route D, where the
 * GObject holds them and the observable never sees them. Routing them through the observable
 * instead is what let `notify({ eventName: 'notify::active' })` reach handlers off-device and
 * nobody on it.
 */
const DECLARED_HANDLERS = new WeakMap<object, Map<number, DeclaredHandler>>();

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

function declaredConnect(
    self: Observable,
    key: string,
    eventName: string,
    callback: (self: Observable, data: EventData) => unknown,
): number {
    const id = nextHandlerId++;
    let handlers = DECLARED_HANDLERS.get(self);
    if (handlers === undefined) DECLARED_HANDLERS.set(self, (handlers = new Map()));
    handlers.set(id, { key, eventName, callback });
    return id;
}

/** Whether `handlerId` was one of this instance's declared handlers; removes it if so. */
function declaredDisconnect(self: Observable, handlerId: number): boolean {
    return DECLARED_HANDLERS.get(self)?.delete(handlerId) === true;
}

/**
 * Run the declared handlers of `key` — the pure-JS leg's emission, shaped exactly as route D
 * shapes the real one: a `notify::` carries no value and a signal carries its arguments, and the
 * payload's `eventName` is the spelling each handler subscribed with.
 *
 * An exception a handler throws is LOGGED and the next handler runs, which is what GJS does and
 * what node-gi already did on the real leg (see the header for both measurements).
 */
function emitDeclared(self: Observable, key: string, args: readonly unknown[]): void {
    const handlers = DECLARED_HANDLERS.get(self);
    if (handlers === undefined) return;
    const isNotify = key.startsWith('notify::');
    // A snapshot, and a re-check against the live map: GObject runs the handlers an emission
    // started with, and one a previous handler disconnected does not run.
    const snapshot = [...handlers];
    for (const [id, handler] of snapshot) {
        if (handler.key !== key || handlers.get(id) !== handler) continue;
        const data = (
            isNotify
                ? { eventName: handler.eventName, object: self }
                : { eventName: handler.eventName, object: self, args }
        ) as EventData;
        try {
            handler.callback(self, data);
        } catch (error) {
            console.error(`[${self.constructor.name}] unhandled exception in a '${handler.eventName}' handler:`, error);
        }
    }
}

/**
 * The refusal every NativeScript event verb gives for a DECLARED member — see the header:
 * `connect` is the one subscribe door and the GObject verbs are the one emit door, and the
 * answer is the same on both legs.
 */
function refuseDeclaredEvent(
    self: object,
    eventName: string,
    verb: 'addEventListener' | 'removeEventListener' | 'notify',
): void {
    const key = giKeyOf(resolvedFor(self.constructor), eventName);
    if (key === null) return;
    const isNotify = key.startsWith('notify::');
    const what = isNotify ? "a declared property's notification" : 'a declared signal';
    const instead =
        verb === 'notify'
            ? isNotify
                ? `write the property, or emit it with notify('${key.slice('notify::'.length)}')`
                : `emit it with emit('${key}', …)`
            : `subscribe with connect('${eventName}', (self, data) => …), whose id disconnect() takes`;
    throw new TypeError(
        `${self.constructor.name}.${verb}('${eventName}'): '${key}' is ${what} and GObject owns ` +
            `it — ${instead}. On Android the emission belongs to the GObject and no NativeScript ` +
            `listener can see it, so ${verb} would work off-device and be silent on it.`,
    );
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
    /**
     * `g_signal_emit_by_name`: run every handler `connect` added for `eventName`, with `args` in the
     * payload. Valid ONLY for a signal the class declares, or `notify::<declared prop>`; any other
     * name throws as GJS does for an unknown signal. NativeScript's own events go through
     * `notify({ eventName, object })`.
     */
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

/** `g_signal_connect` as node-gi installs it on a registered class's prototype. */
type GiConnect = (this: object, key: string, handler: (...args: unknown[]) => unknown) => number;
/** `g_signal_handler_disconnect`, same. */
type GiDisconnect = (this: object, id: number) => void;
/** `g_signal_emit_by_name`, same. */
type GiEmit = (this: object, key: string, ...args: unknown[]) => unknown;

/**
 * One declaration — one `withSignals(Base, meta)` or `withProperties(Base, meta)` call, one
 * class, and under route D one GType. Mutable where realization fills it in; see the header for
 * why this is a registry entry rather than the call's own closure.
 */
interface Declaration {
    /** What the class declares, or `undefined` for the plain `withSignals(Base)` seam. */
    readonly meta: DeclaredClassMeta | undefined;
    /** The class the registration targets, and whose prototype the accessors land on. */
    readonly klass: ObservableConstructor;
    /** `klass.prototype`, as the index signature the installing code needs. */
    readonly prototype: Record<string, unknown>;
    /** Every spelling of this class's OWN declared properties, mapped to the canonical name. */
    readonly canonicalOf: ReadonlyMap<string, string>;
    /** Canonical names of this class's {@link isSeamOwned} properties — what `pushDeclared` takes. */
    readonly seamOwned: ReadonlySet<string>;
    /** This class's OWN declared signal names. */
    readonly declaredSignals: ReadonlySet<string>;
    /**
     * The router methods to restore over the GObject verbs the registration installs — the
     * `withSignals` door's. `withProperties` has none: its base already carries them, and its
     * own registration skips the names for exactly that reason.
     */
    readonly routers: Readonly<Record<string, unknown>> | undefined;
    realized: boolean;
    routeD: boolean;
    giConnect?: GiConnect;
    giDisconnect?: GiDisconnect;
    giEmit?: GiEmit;
}

/** Every declaration, keyed on the class that carries it. */
const DECLARATIONS = new WeakMap<object, Declaration>();

/** Concrete classes whose whole declaration chain is realized; see {@link realizeChain}. */
const REALIZED_TARGETS = new WeakSet<object>();

/** The seam's own pure-JS `notify`, so a derived declaration does not install a second one. */
const SEAM_NOTIFY = new WeakSet<object>();

/**
 * What a declared property's spellings and the GObject verbs look like for ONE concrete class:
 * every declaration up its chain, merged. Cached per class in {@link RESOLVED}.
 */
interface Resolved {
    readonly canonicalOf: ReadonlyMap<string, string>;
    readonly seamOwned: ReadonlySet<string>;
    readonly declaredSignals: ReadonlySet<string>;
    readonly routeD: boolean;
    readonly giConnect: GiConnect | undefined;
    readonly giDisconnect: GiDisconnect | undefined;
    readonly giEmit: GiEmit | undefined;
}

const RESOLVED = new WeakMap<object, Resolved>();

/** The declarations `target` has, base first — the order realization needs. */
function declarationsOf(target: object): Declaration[] {
    const found: Declaration[] = [];
    for (let at: unknown = target; typeof at === 'function'; at = Object.getPrototypeOf(at)) {
        const declaration = DECLARATIONS.get(at as object);
        if (declaration !== undefined) found.unshift(declaration);
    }
    return found;
}

/**
 * The merged view of `ctor`'s declarations. Read from the routers, which run on an instance and
 * therefore strictly after {@link realizeChain} filled every declaration in.
 *
 * A derived declaration reuses its ANCESTOR's gi thunks: its own registration found `connect`,
 * `disconnect` and `emit` on the chain and skipped them, and those captured thunks are the ones
 * that answer a leaf instance.
 */
function resolvedFor(ctor: object): Resolved {
    const cached = RESOLVED.get(ctor);
    if (cached !== undefined) return cached;
    const canonicalOf = new Map<string, string>();
    const seamOwned = new Set<string>();
    const declaredSignals = new Set<string>();
    const resolved: Resolved = {
        canonicalOf,
        seamOwned,
        declaredSignals,
        routeD: false,
        giConnect: undefined,
        giDisconnect: undefined,
        giEmit: undefined,
    };
    const merged = resolved as { -readonly [K in keyof Resolved]: Resolved[K] };
    for (const declaration of declarationsOf(ctor)) {
        for (const [spelling, canonical] of declaration.canonicalOf) canonicalOf.set(spelling, canonical);
        for (const name of declaration.seamOwned) seamOwned.add(name);
        for (const name of declaration.declaredSignals) declaredSignals.add(name);
        if (declaration.routeD) merged.routeD = true;
        if (declaration.giConnect !== undefined) merged.giConnect = declaration.giConnect;
        if (declaration.giDisconnect !== undefined) merged.giDisconnect = declaration.giDisconnect;
        if (declaration.giEmit !== undefined) merged.giEmit = declaration.giEmit;
    }
    RESOLVED.set(ctor, resolved);
    return resolved;
}

/**
 * The key GObject owns for `eventName`, or `null` when the pure-JS leg does. A declared signal
 * and a `notify::` of a declared property are GObject's; a NativeScript event, a `WIDGET_SIGNALS`
 * entry and the handled-accumulator protocol are not and never become so.
 *
 * It is also what CANONICALISES a detail, which is why the pure-JS leg asks it too: three
 * spellings of a property are one property, so `notify::can_close` has to reach a handler
 * connected to `notify::canClose` on either leg. Route D gets that from this map; without it the
 * pure leg would emit only `notify::can-close` and silently drop the other two.
 */
function giKeyOf(resolved: Resolved, eventName: string): string | null {
    if (resolved.declaredSignals.has(eventName)) return eventName;
    if (!eventName.startsWith('notify::')) return null;
    const canonical = resolved.canonicalOf.get(eventName.slice('notify::'.length));
    return canonical === undefined ? null : `notify::${canonical}`;
}

/** Record a door's declaration against its class. Returns the entry so a door can finish it. */
function declare(
    klass: ObservableConstructor,
    meta: DeclaredClassMeta | undefined,
    routers: Readonly<Record<string, unknown>> | undefined,
): Declaration {
    const canonicalOf = new Map<string, string>();
    const seamOwned = new Set<string>();
    for (const [name, property] of Object.entries(meta?.Properties ?? {})) {
        for (const spelling of spellingsOf(name)) canonicalOf.set(spelling, name);
        if (isSeamOwned(property)) seamOwned.add(name);
    }
    const declaration: Declaration = {
        meta,
        klass,
        prototype: klass.prototype as unknown as Record<string, unknown>,
        canonicalOf,
        seamOwned,
        declaredSignals: new Set(Object.keys(meta?.Signals ?? {})),
        routers,
        realized: false,
        routeD: false,
    };
    DECLARATIONS.set(klass, declaration);
    return declaration;
}

/** What a door contributes to `emittedSignals`: its declared signals and one `notify::` each. */
function declaredEmissionsOf(meta: DeclaredClassMeta | undefined): string[] {
    return [
        ...Object.keys(meta?.Signals ?? {}),
        ...Object.keys(meta?.Properties ?? {}).map((name) => `notify::${name}`),
    ];
}

/**
 * Realize every declaration the class being constructed has, base first — once per concrete
 * class. Called from `WithSignals`'s constructor with `new.target`; see the header for why the
 * whole chain has to be standing before any widget constructor body runs, and why the engine is
 * asked here rather than at class-evaluation time.
 */
function realizeChain(target: object): void {
    if (REALIZED_TARGETS.has(target)) return;
    REALIZED_TARGETS.add(target);
    for (const declaration of declarationsOf(target)) realize(declaration);
}

function realize(declaration: Declaration): void {
    if (declaration.realized) return;
    declaration.realized = true;
    if (declaration.meta === undefined) return;
    const engine = engineForTarget(ENGINE_TARGET);
    if (engine?.supportsForeignParentClasses === true) {
        registerRouteD(declaration, engine.registerForeignClass.bind(engine));
        return;
    }
    installPureJsProperties(declaration);
}

function registerRouteD(declaration: Declaration, register: (klass: object, meta: ForeignClassMeta) => void): void {
    // node-gi SKIPS any member name the prototype chain already answers, starting at
    // `klass.prototype` itself, and records the skip in the frozen static `$foreignSkipped`.
    // The four names below are the ones this seam must get the REAL implementation of: the
    // router methods are deleted so the registration installs them, and `connect`, `disconnect`
    // and `emit` are put back afterwards as routers over what it installed. `notify` keeps
    // node-gi's arg-type routing — it captured `Observable.prototype.notify` as the host half,
    // which is the behaviour the pure-JS leg installs by hand — with one refusal wrapped around
    // it: a payload naming a declared member, which on this leg could only reach nobody.
    //
    // A `withProperties` declaration deletes nothing (it owns none of these) and so is
    // registered with all four already on the chain. That is deliberate: the names land in its
    // `$foreignSkipped`, and the ancestor's thunks keep answering — for the derived class's own
    // properties too, because `g_signal_connect` keys on the instance's GType, which is the
    // leaf's.
    const { meta, prototype, routers } = declaration;
    if (routers !== undefined) {
        delete prototype.connect;
        delete prototype.disconnect;
        delete prototype.emit;
        delete prototype.notify;
    }
    register(declaration.klass, meta!);
    wrapRouteDAccessors(declaration);
    if (routers !== undefined) {
        declaration.giConnect = prototype.connect as GiConnect | undefined;
        declaration.giDisconnect = prototype.disconnect as GiDisconnect | undefined;
        declaration.giEmit = prototype.emit as GiEmit | undefined;
        if (
            declaration.giConnect === undefined ||
            declaration.giDisconnect === undefined ||
            declaration.giEmit === undefined
        ) {
            throw new Error(
                `Registering '${meta!.GTypeName}' over its NativeScript base installed no ` +
                    'connect/disconnect/emit, so the widget would answer neither GObject nor this port. ' +
                    'ADR 0105 refuses a silent fallback here: the subset is reachable only by calling ' +
                    "usePureJsGObjectEngine() from '@gjsify/adwaita-core' before the port loads.",
            );
        }
        for (const [name, method] of Object.entries(routers)) {
            Object.defineProperty(prototype, name, {
                configurable: true,
                writable: true,
                enumerable: false,
                value: method,
            });
        }
        refuseDeclaredNotifyPayload(prototype, prototype.notify as (this: object, ...args: unknown[]) => unknown);
    }
    declaration.routeD = true;
}

/**
 * Wrap `installed` so `notify({ eventName: 'notify::<declared>' })` is refused rather than
 * dispatched to the nobody a declared member has on the NativeScript side. The STRING form and
 * every other payload go straight through, so `notify('active')` is still `g_object_notify` and
 * a NativeScript event is still dispatched.
 *
 * Installed on both legs — here over node-gi's `notify`, and in {@link installPureNotify} over
 * the host's — because a refusal on one leg only would be the per-leg difference again.
 */
function refuseDeclaredNotifyPayload(
    prototype: Record<string, unknown>,
    installed: (this: object, ...args: unknown[]) => unknown,
): void {
    const value = function notify(this: Observable, data: unknown, ...rest: unknown[]): unknown {
        if (typeof data === 'object' && data !== null) {
            const { eventName } = data as { eventName?: unknown };
            if (typeof eventName === 'string') refuseDeclaredEvent(this, eventName, 'notify');
        }
        return installed.call(this, data, ...rest);
    };
    SEAM_NOTIFY.add(value);
    Object.defineProperty(prototype, 'notify', {
        configurable: true,
        writable: true,
        enumerable: false,
        value,
    });
}

/**
 * Whether the SEAM owns this property's storage on EVERY leg, rather than node-gi owning it on
 * route D. Two shapes of property need it, for two reasons that land in the same place:
 *
 *   - OBJECT-KIND. node-gi marshals a write into a `GValue` of the ParamSpec's type
 *     (`NodeGiSetProperty` → `g_value_copy` in `class.cc`), and every model this port holds —
 *     `GjsifyOptionList`, `GjsifyOptionObject`, `GtkStringList` — is pure JS on every leg BY
 *     CONSTRUCTION, because ADR 0122 § A3 refuses both a real-GObject stand-in and a `jsobject`
 *     ParamSpec. Such a value cannot enter the GObject at all.
 *   - {@link ForeignScalarProperty.explicitNotify}. node-gi's generated setter emits from inside
 *     `native.setProperty` and cannot be told not to, so a write through it is never silent —
 *     and a property whose widget owes an ORDER must be able to move its value without emitting
 *     at that instant. `Adw.ComboRow:model = null` is the case that forces it: `selected` goes
 *     to the sentinel SILENTLY while `model` alone notifies (measured, GJS 1.88 / libadwaita
 *     1.9.4).
 *
 * THE COST, stated plainly: the GObject's own slot for such a property is never written, so
 * `g_object_get`, `bind_property` and GtkBuilder read its default forever. ADR 0122 § A2 took
 * that trade for `model` already, nothing on this leg reads a port widget's properties through
 * C, and the alternative is emitting notifications libadwaita does not.
 *
 * What it BUYS is larger than what it costs: such a property runs the SAME accessor over the
 * SAME store on both legs, so the off-device spec covers route D's behaviour too — and route D
 * has no harness of its own.
 */
function isSeamOwned(property: DeclaredProperty): boolean {
    return property.kind === 'object' || property.explicitNotify === true;
}

/**
 * The accessor a SEAM-OWNED property gets, identical on both legs but for how it emits.
 *
 * Deliberately the same rules node-gi's own accessors follow, so a widget behaves alike
 * wherever it runs — an equal write is not a change, and a read MATERIALISES the default so
 * that a later default-equal write is not one either.
 */
function seamOwnedDescriptor(
    name: string,
    property: DeclaredProperty,
    notify: (self: Observable, name: string) => void,
): PropertyDescriptor {
    const fallback = defaultValueOf(property);
    return {
        configurable: true,
        enumerable: false,
        get(this: object): unknown {
            const values = valuesOf(this);
            if (!values.has(name)) values.set(name, fallback);
            return values.get(name);
        },
        set(this: Observable, raw: unknown): void {
            const value = coerceDeclared(name, property, raw, this);
            const values = valuesOf(this);
            if (values.has(name) && !isDeclaredChange(property, value, values.get(name), raw, this)) return;
            values.set(name, value);
            // `explicitNotify` hands the whole emission to `afterNotify`, this property's own
            // included — see {@link Declared.afterNotify}.
            if (property.explicitNotify !== true) notify(this, name);
            property.afterNotify?.(this);
        },
    };
}

/** Emit `notify::<name>` through whatever answers `notify` on this leg; both route a string. */
function notifyThrough(self: Observable, name: string): void {
    (self as unknown as { notify(propertyName: string): void }).notify(name);
}

/**
 * Give the accessors node-gi installed what the declaration asks of them: {@link coerceDeclared}
 * in front, and {@link Declared.changed} / {@link Declared.afterNotify} behind. A string-kind
 * property that declares none of the three has nothing to add and keeps node-gi's untouched.
 *
 * A {@link isSeamOwned} property is REPLACED rather than wrapped — its value never enters the
 * GObject.
 *
 * An accessor that is not there to wrap THROWS: it means the host chain owned the name and
 * node-gi skipped it, and a property that quietly bypasses the coercion is the very
 * disagreement between the legs this exists to close.
 */
function wrapRouteDAccessors(declaration: Declaration): void {
    const { meta, prototype } = declaration;
    for (const [name, property] of Object.entries(meta!.Properties ?? {})) {
        const hooks = property.changed !== undefined || property.afterNotify !== undefined;
        const seamOwned = isSeamOwned(property);
        if (!seamOwned && !hooks && property.kind === 'string' && property.normalize === undefined) continue;
        for (const spelling of spellingsOf(name)) {
            const installed = Object.getOwnPropertyDescriptor(prototype, spelling);
            if (installed?.set === undefined || installed.get === undefined) {
                throw new Error(
                    `Registering '${meta!.GTypeName}' installed no accessor for '${spelling}', so a ` +
                        'string from XML would reach the GObject uncoerced. The host chain probably ' +
                        "owns that name (see the class's $foreignSkipped); rename the property.",
                );
            }
            if (seamOwned) {
                Object.defineProperty(prototype, spelling, seamOwnedDescriptor(name, property, notifyThrough));
                continue;
            }
            const { get, set } = installed;
            Object.defineProperty(prototype, spelling, {
                ...installed,
                set(this: Observable, raw: unknown): void {
                    const value = coerceDeclared(name, property, raw, this);
                    if (!hooks) {
                        set.call(this, value);
                        return;
                    }
                    // The READBACK, before and after, is what stands in for the store this leg
                    // does not own: node-gi's setter is an identity guard, so "did it move" is
                    // the only thing it tells us, and it tells it by what the getter says next.
                    const held = get.call(this);
                    set.call(this, value);
                    const moved = get.call(this) !== held;
                    const changed = property.changed !== undefined ? property.changed(value, held, raw, this) : moved;
                    // node-gi emitted iff the value moved. A `changed` that says yes where the
                    // store did not move — `icon-name = ''` on a button already holding `null` —
                    // owes the emission here, and owes it before `afterNotify` runs.
                    if (changed && !moved) notifyThrough(this, name);
                    if (changed) property.afterNotify?.(this);
                },
            });
        }
    }
}

/**
 * The other leg: the declared properties as ordinary accessors over a JS store, and GJS's
 * `notify('<prop>')` beside NativeScript's `notify({ eventName })`. Deliberately the same
 * rules node-gi's own accessors follow, so a widget behaves alike on both — an equal write
 * is not a change, a read MATERIALISES the default so that a later default-equal write is
 * not one either, and a spelling the host chain already owns is left to it.
 *
 * Where the C setter is more than a store, the two hooks this leg has to itself stand in for the
 * rest of it: {@link DeclaredProperty.changed} for a guard that cannot be identity, and
 * {@link DeclaredProperty.afterNotify} for what the setter does to its siblings afterwards.
 */
function installPureJsProperties(declaration: Declaration): void {
    const { meta, prototype } = declaration;
    for (const [name, property] of Object.entries(meta!.Properties ?? {})) {
        // The same {@link seamOwnedDescriptor} route D gives a seam-owned property, because on
        // this leg EVERY declared property is seam-owned: there is no GObject to hold one.
        // Emission goes straight to the declared channel rather than through `notify`, which
        // would only re-resolve the instance's chain to arrive here.
        const descriptor = seamOwnedDescriptor(name, property, emitPureNotify);
        for (const spelling of spellingsOf(name)) {
            if (spelling in prototype) continue;
            Object.defineProperty(prototype, spelling, descriptor);
        }
    }
    installPureNotify(declaration);
}

function emitPureNotify(self: Observable, name: string): void {
    emitDeclared(self, `notify::${name}`, []);
}

function installPureNotify(declaration: Declaration): void {
    const { prototype } = declaration;
    // Read through the chain: whatever answers `notify` today is the host half this one wraps.
    const hostNotify = prototype.notify as (this: object, ...args: unknown[]) => unknown;
    // Unless it is already the seam's. That one resolves the INSTANCE's declarations, this one
    // included, so a second copy one prototype down would only add a hop.
    if (SEAM_NOTIFY.has(hostNotify)) return;
    const value = function notify(this: Observable, data: unknown, ...rest: unknown[]): unknown {
        if (typeof data !== 'string') {
            if (typeof data === 'object' && data !== null) {
                const { eventName } = data as { eventName?: unknown };
                if (typeof eventName === 'string') refuseDeclaredEvent(this, eventName, 'notify');
            }
            return hostNotify.call(this, data, ...rest);
        }
        const { canonicalOf } = resolvedFor(this.constructor);
        const canonical = canonicalOf.get(data);
        if (canonical === undefined) {
            throw new TypeError(
                `${this.constructor.name} has no property '${data}' to notify. The declared ones are ` +
                    `${[...canonicalOf.keys()].join(', ') || '(none)'}; a NativeScript event is notified ` +
                    'with its payload object, not with a name.',
            );
        }
        emitDeclared(this, `notify::${canonical}`, []);
        return undefined;
    };
    SEAM_NOTIFY.add(value);
    Object.defineProperty(prototype, 'notify', {
        configurable: true,
        writable: true,
        enumerable: false,
        value,
    });
}

/**
 * Give a `@nativescript/core` base GJS's `connect` / `disconnect`, and `GtkWidget`'s layout
 * properties with them ({@link withGtkWidgetLayout}).
 *
 * Applied ONCE per class that extends a platform base — `extends withSignals(GridLayout)`
 * — and never on a class whose base is already a widget of this package, which inherits
 * the two methods and would otherwise carry a second, identical copy one prototype up. Such a
 * class adds properties with {@link withProperties} instead.
 */
export function withSignals<TBase extends ObservableConstructor>(Base: TBase, meta?: DeclaredClassMeta) {
    abstract class WithSignals extends withGtkWidgetLayout(Base) implements GObjectSignals {
        /**
         * What every widget emits; a class's own list adds to it (`emittedSignalsOf`). A
         * declared property's `notify::` and a declared signal are emitted by the seam itself,
         * so they belong here rather than in each migrated widget's own list.
         */
        static readonly emittedSignals: readonly string[] = [...WIDGET_SIGNALS, ...declaredEmissionsOf(meta)];

        // oxlint-disable-next-line typescript/no-explicit-any -- TS2545 admits no other spelling for a mixin base
        constructor(...args: any[]) {
            super(...args);
            realizeChain(new.target);
        }

        /** Refuses a declared member's name; see the header. Covers `on` and `once` with it. */
        override addEventListener(
            eventName: string,
            callback: (data: EventData) => void,
            thisArg?: unknown,
            once?: boolean,
        ): void {
            refuseDeclaredEvent(this, eventName, 'addEventListener');
            super.addEventListener(eventName, callback, thisArg, once);
        }

        /** The other half of the refusal, and with it `off`. */
        override removeEventListener(eventName: string, callback?: (data: EventData) => void, thisArg?: unknown): void {
            refuseDeclaredEvent(this, eventName, 'removeEventListener');
            super.removeEventListener(eventName, callback, thisArg);
        }

        connect(eventName: string, callback: (self: this, data: EventData) => unknown): number {
            const resolved = resolvedFor(this.constructor);
            const key = giKeyOf(resolved, eventName);
            if (resolved.routeD && key !== null) {
                // GJS hands a handler `(self, ...args)`; this port hands it `(self, data)` with
                // the port's own payload, so the real emission is reshaped into one. A
                // `notify::` carries a GParamSpec in GJS and a bare payload here, as the
                // pure-JS leg's does — the value a snippet wants is on `self`.
                const isNotify = key.startsWith('notify::');
                const real = resolved.giConnect!.call(this, key, (self: unknown, ...rest: unknown[]) => {
                    const object = self as Observable;
                    const data = (isNotify ? { eventName, object } : { eventName, object, args: rest }) as EventData;
                    return callback(self as this, data);
                });
                let live = REAL_HANDLERS.get(this);
                if (live === undefined) REAL_HANDLERS.set(this, (live = new Set()));
                live.add(real);
                return GOBJECT_ID_BASE + real;
            }
            if (key !== null) {
                // The pure-JS leg's declared channel — the seam's own table, not the
                // observable's, so this leg has exactly the doors route D has.
                return declaredConnect(
                    this,
                    key,
                    eventName,
                    callback as (self: Observable, data: EventData) => unknown,
                );
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
            return pureConnect(this, eventName, listener);
        }

        disconnect(handlerId: number): void {
            if (handlerId >= GOBJECT_ID_BASE) {
                const real = handlerId - GOBJECT_ID_BASE;
                // The port's contract, not GObject's: an id nothing holds throws here too,
                // where `g_signal_handler_disconnect` would only log a CRITICAL.
                if (REAL_HANDLERS.get(this)?.delete(real) !== true) throw unknownHandler(this, handlerId);
                resolvedFor(this.constructor).giDisconnect!.call(this, real);
                return;
            }
            if (declaredDisconnect(this, handlerId)) return;
            pureDisconnect(this, handlerId);
        }

        emit(eventName: string, ...args: unknown[]): void {
            const resolved = resolvedFor(this.constructor);
            const key = giKeyOf(resolved, eventName);
            if (key !== null) {
                if (resolved.routeD) resolved.giEmit!.call(this, key, ...args);
                else emitDeclared(this, key, args);
                return;
            }
            // GJS's own refusal, worded as GJS words it. NativeScript's dispatch is `notify`.
            throw new Error(
                `No signal '${eventName}' on object '${this.constructor.name}'. emit() is GObject's ` +
                    "and takes a declared signal or a declared property's notify::<prop>; to dispatch " +
                    `a NativeScript event use notify({ eventName: '${eventName}', object: this }).`,
            );
        }

        get_property(name: string): unknown {
            return readGtkProperty(this, camelProperty(name));
        }

        set_property(name: string, value: unknown): void {
            writeGtkProperty(this, camelProperty(name), value);
        }
    }

    declare(WithSignals, meta, {
        connect: WithSignals.prototype.connect,
        disconnect: WithSignals.prototype.disconnect,
        emit: WithSignals.prototype.emit,
    });
    return WithSignals;
}

/**
 * Declare properties and signals on a class whose base is ALREADY a widget of this package —
 * `class AdwSwitchRow extends withProperties(AdwActionRow, { ... })`.
 *
 * The same declaration as {@link withSignals}'s second argument, and nothing else: `connect`,
 * `disconnect`, `emit`, `notify` and `GtkWidget`'s layout properties come down from the base
 * widget, and they already answer this class's declaration because they resolve the instance's
 * whole chain (see the header). Under route D this is a GType over the base's GType; under the
 * pure-JS leg it is the same accessors over the same store, one prototype down.
 */
export function withProperties<TBase extends ObservableConstructor>(Base: TBase, meta: DeclaredClassMeta) {
    abstract class WithProperties extends Base {
        /** Only what this class ADDS; `emittedSignalsOf` merges it with the base's. */
        static readonly emittedSignals: readonly string[] = declaredEmissionsOf(meta);
    }

    declare(WithProperties, meta, undefined);
    return WithProperties;
}

/**
 * Write a declared property's held value WITHOUT notifying, and without running `normalize`,
 * `changed` or `afterNotify` — the PUSH half of a property whose widget owns the emission.
 *
 * WHY A WIDGET NEEDS IT. A property whose value also moves from UNDERNEATH — the selection of an
 * `Adw.ComboRow` when its model is replaced, or when the held model splices — cannot be kept in
 * sync by writing it, because the write is the thing that emits and the emission order is
 * measured and is not the order a write would produce. `model = null` is the sharpest case:
 * `selected` goes to the sentinel and `selected-item` to null with NO notify at all, and `model`
 * alone notifies. So the widget pushes the new value in here and emits what it owes with
 * `notify('<name>')`, in the order it measured.
 *
 * Only a {@link isSeamOwned} property may be pushed, and a name that is not one THROWS rather
 * than writing a store route D would never read back: there the value lives in the GObject, and
 * a silent push would be correct off-device and invisible on the device.
 */
export function pushDeclared(self: object, name: string, value: unknown): void {
    const { canonicalOf, seamOwned } = resolvedFor(self.constructor);
    const canonical = canonicalOf.get(name);
    if (canonical === undefined || !seamOwned.has(canonical)) {
        throw new TypeError(
            `${self.constructor.name} cannot push '${name}': only a property the seam owns on both ` +
                'legs can be moved without notifying — declare it as object-kind or with ' +
                `explicitNotify. The pushable ones are ${[...seamOwned].join(', ') || '(none)'}.`,
        );
    }
    valuesOf(self).set(canonical, value);
}

function valuesOf(instance: object): Map<string, unknown> {
    let values = VALUES.get(instance);
    if (values === undefined) VALUES.set(instance, (values = new Map()));
    return values;
}

/** What a declared property reads as before anything writes it — GObject's own kind defaults. */
function defaultValueOf(property: ForeignProperty): unknown {
    // `g_param_spec_object`'s default is always NULL, which is why the object arm carries none.
    if (property.kind === 'object') return null;
    if (property.default !== undefined) return property.default;
    if (property.kind === 'string') return '';
    return property.kind === 'boolean' ? false : 0;
}
