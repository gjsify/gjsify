// The engine seam — ADR 0105 § 2, the second seam, BELOW the door.
//
// The door (`GObjectDoor`) owns widgets: it builds a template into a port's real objects and
// routes a signal the subset does not know to the port's own event system. The ENGINE owns what
// is left: where a registered instance's property values live, which handlers are connected, how
// an emission runs and how `notify` reaches a `notify::<property>` handler.
//
// WHY SPLIT THEM. `@gjsify/adwaita-core` re-creates GObject in pure JS because the browser has no
// GObject and NativeScript had none either. On Android it now CAN have one: node-gi reaches real
// GObject through napi (ADR 0104). ADR 0105 replaces the re-creation there WITHOUT changing the
// contract — so the re-creation has to become one implementation of something, and this interface
// is that something. `createGObject(door, engine)` picks it; the pure-JS engine is the default on
// every target and the only one in the browser.
//
// WHAT STAYS IN THE CORE, deliberately:
//   - `registerClass`'s REFUSALS (ADR 0096 § 2). They are the subset's whole point: real GObject
//     accepts `Children`, a `vfunc_*` override and a wide `param_types`, and an engine that
//     silently allowed them would move the contract. The refusal vectors (`holds: 'subset'`) must
//     fail on EVERY engine, which they cannot if the engine decides them.
//   - accessor GENERATION (`_checkAccessors`/`_generateAccessors`, the three aliases, the
//     "setter defined without getter" messages). That is GJS's class-building rule, identical on
//     any engine; only the STORE behind the accessor is the engine's.
//   - construct order (ADR 0096 § 3 steps 4–5), signal arity checking and the error messages.
// So a new engine is a value store and a signal bus, not a second subset.
//
// WHAT A HANDLER ID IS. The CORE allocates every handler id, hands it to the engine and looks it
// up again on disconnect. A real-GObject engine therefore maps the core's id to its own
// `g_signal_connect` id instead of returning one — the subset's ids stay a single, dense space
// shared with the door's foreign connections, which is what `disconnect(id)` needs.

import type {
    Binding,
    BindingFlag,
    ClassLike,
    GObjectInstance,
    ParamSpec,
    RegisteredClass,
    SignalHandler,
} from './gobject.js';

// --- The FOREIGN-PARENT vocabulary (ADR 0105 § 2 route D) -------------------------------------
//
// Route D is the other direction entirely: instead of a twin GObject beside the widget, node-gi
// registers a GType over the widget's OWN `@nativescript/core` base and attaches it, so the
// `Label` handed to `addChild` IS the GObject. The port's widget classes are the ones that want
// it, and a widget class says what it wants with a declarative block at its `extends`.
//
// WHY THE BLOCK IS SPELLED HERE AND NOT IN node-gi's VOCABULARY. `GObject.ParamSpec.string(…)` is
// the spelling node-gi takes, and a port that wrote it would have to IMPORT node-gi to describe
// its own properties — tier 3 from tier 2, which is the exact dependency `engineForTarget` exists
// to keep out (a port is installable in a browser). So a widget declares `{ kind: 'string' }` and
// the engine that has node-gi translates. The pure-JS engine translates it to accessors over its
// own store, which is what the browser and iOS get.

/** The property kinds the subset has, and the only ones a declared widget property may take. */
export type ForeignPropertyKind = 'string' | 'boolean' | 'int' | 'uint' | 'double';

/** One property a widget class declares at its `extends`. `default` is the unset value. */
export interface ForeignProperty {
    readonly kind: ForeignPropertyKind;
    readonly default?: string | boolean | number | null;
    readonly nick?: string;
    readonly blurb?: string;
}

/** One signal a widget class declares at its `extends`, in the subset's parameter vocabulary. */
export interface ForeignSignal {
    readonly param_types?: readonly ForeignPropertyKind[];
}

/**
 * What a widget class declares at its `extends` — GJS's `registerClass` meta, in the port's own
 * vocabulary. Keys are the CANONICAL (dashed or single-word) property names, as GObject's are.
 */
export interface ForeignClassMeta {
    readonly GTypeName: string;
    readonly Properties?: Readonly<Record<string, ForeignProperty>>;
    readonly Signals?: Readonly<Record<string, ForeignSignal>>;
    /**
     * REFUSED, by name, and declared here so the refusal is findable from the call site.
     *
     * `Implements` is the one meta key route D cannot carry (ADR 0122 § 4): a foreign-parent class
     * is registered over a `@nativescript/core` base that is not a GObject, so there is no GType
     * to add an interface to. A widget that needs `Gio.ListModel` holds one instead of being one —
     * which is what `Adw.ComboRow:model` does. Ignoring the key would leave a class that says it
     * implements the interface and does not, which is the silent outcome ADR 0105 refuses.
     */
    readonly Implements?: readonly unknown[];
}

export interface GObjectEngine {
    /** Names the engine in a diagnostic; `'pure-js'` for the default one. */
    readonly name: string;

    /**
     * Whether {@link registerForeignClass} can do anything. Not a convenience: it is what makes
     * "is this engine the real one, on a host that has route D" answerable BEFORE a widget class
     * commits to a registration, so the seam can pick the pure-JS accessors instead of calling
     * and catching. ADR 0105's no-silent-fallback rule is why it is a question and not a try.
     *
     * False on the pure-JS engine, and false on a real engine whose HOST has foreign parents off
     * (`FOREIGN_PARENT_CLASSES` in node-gi's `#host` — true on NativeScript, false on node).
     */
    readonly supportsForeignParentClasses: boolean;

    /**
     * Registers `klass` — whose parent is a `@nativescript/core` class, not a GObject one — as a
     * real GType, installing the GObject surface as own members of `klass.prototype`.
     *
     * Throws when {@link supportsForeignParentClasses} is false, and throws when the registration
     * itself fails. It never falls back: a widget that asked for a real GObject and silently got
     * a JS store is the one outcome ADR 0105 refuses, because nothing downstream could tell.
     */
    registerForeignClass(klass: ClassLike, meta: ForeignClassMeta): void;

    /**
     * A class finished registering. The engine may build whatever per-class thing it needs from
     * `info.properties` and `info.signals` (a real engine registers a GType here). The core has
     * already applied every refusal, so `info` is inside the subset.
     */
    register(info: RegisteredClass): void;

    /**
     * The value of `spec` on `instance`. Until something sets it this is `spec.get_default_value()`
     * — a property reads as its default, which is a vector of its own.
     */
    getValue(instance: object, spec: ParamSpec): unknown;

    /**
     * Stores `value` — ALWAYS, which is what makes this the construct-only writer too — and
     * returns whether the CORE must notify. For a store that only holds values that is "did this
     * change anything", and the pure-JS engine answers exactly that: an unset slot counts as
     * changed even for a value equal to the default, as `_generateAccessors` does.
     *
     * It is deliberately the core's DUTY and not the engine's CHANGE, because an engine whose
     * write already emits `notify` — a real-GObject one, where `g_object_set_property` notifies
     * itself — would otherwise have to suppress the second one. Such an engine returns false
     * always and the notification still happens, once, from inside the store. The core never
     * notifies for the construct write either way.
     */
    setValue(instance: object, spec: ParamSpec, value: unknown): boolean;

    /**
     * Connects `handler` under the core's `id`. `key` is a plain signal name or
     * `notify::<property>`, already resolved against the class chain and canonical (the dashed
     * spelling of the property).
     */
    addHandler(instance: GObjectInstance, id: number, key: string, handler: SignalHandler): void;

    /** Disconnects the handler the core gave `id` to; false when this engine has no such id. */
    removeHandler(instance: GObjectInstance, id: number): boolean;

    /**
     * Runs the handlers of `key`. The core has already checked that `key` is a signal of the class
     * and that the argument count matches its `param_types`. A handler is called as
     * `handler(instance, ...args)` — the JS instance, never an engine-internal twin.
     */
    emit(instance: GObjectInstance, key: string, args: readonly unknown[]): void;

    /** Emits `notify::<spec.name>`. Separate from {@link emit} because real GObject's notify is. */
    notify(instance: GObjectInstance, spec: ParamSpec): void;

    /**
     * Marks the innermost emission of `key` in progress so the handlers after the current one do
     * not run. False when there is none, which the core turns into GLib's warning.
     */
    stopEmission(instance: GObjectInstance, key: string): boolean;

    /**
     * `g_object_bind_property` for the three flags the template builders use. An engine with real
     * bindings returns a real `GBinding`'s `unbind`; the pure-JS one follows `notify`.
     */
    bind(
        source: GObjectInstance,
        sourceProperty: string,
        target: GObjectInstance,
        targetProperty: string,
        flags: readonly BindingFlag[],
    ): Binding;
}

// --- The slot --------------------------------------------------------------------------------
//
// `createGObject(door, engine)` is an argument, and a PORT is the one that calls it: by the time
// an app imports `@gjsify/adwaita-nativescript/gobject` that module has already built its
// namespace. So the app cannot pass the engine — it has to put the engine somewhere the port
// reads. This is that somewhere, and it is in the CORE rather than in the NativeScript port
// because the core is what owns the default (ADR 0105 § 2).
//
// WHY THE APP AND NOT THE PORT DECIDES. The engine needs `requireGi`, and `requireGi` needs
// `@gjsify/node-gi` plus the `@gjsify/gi-runtime-android` payload. Both are tier-3 Android-only
// things; the port is tier 2 and installable in a browser. A port that reached for them itself
// would make every consumer an Android consumer. So the opt-in is one call in app code —
// `useRealGObjectEngine(requireGi)` from `@gjsify/adwaita-gobject-native` — and the port only
// reads what it finds.
//
// WHY IT FREEZES ON FIRST READ, AND WHY A LATE REGISTRATION THROWS. The port reads the slot once,
// when its module body runs. An app that registers AFTER that would get a namespace backed by the
// pure-JS engine while believing it had a real GObject — a silent, whole-app-wide wrong answer,
// and the exact kind of "which engine is this actually" doubt a try/catch fallback would create.
// So the read is recorded and a later registration is an error that names the fix. The ordering
// the app owes is ordinary ESM: the module that calls `useRealGObjectEngine` must be EVALUATED
// before the port's, which means importing it first, from its own side-effect module.
//
// A QUERY IS A READ. {@link gobjectEngineName} freezes the slot too, because an answer that a
// later registration would invalidate is worse than no answer.

let registered: GObjectEngine | undefined;
let wasRead = false;

/**
 * Makes `engine` the engine behind every GObject namespace a port builds AFTER this call. Throws
 * when the slot has already been read, or when a DIFFERENT engine holds it — re-registering the
 * same one is idempotent, so a module two bundles both evaluate is not an error.
 *
 * Nothing calls this in the core. `@gjsify/adwaita-gobject-native`'s `useRealGObjectEngine` is the
 * one caller the workspace has, and it is the app that calls that.
 */
export function registerGObjectEngine(engine: GObjectEngine): void {
    if (registered === engine) return;
    if (registered) {
        throw new Error(
            `GObject engine already registered: '${registered.name}' cannot be replaced by '${engine.name}'. ` +
                'Register exactly one engine, once, before anything builds a GObject namespace.',
        );
    }
    if (wasRead) {
        throw new Error(
            `GObject engine '${engine.name}' registered too late: a GObject namespace was already built ` +
                'on the default engine. Move the registering call into a module that is imported BEFORE ' +
                "'@gjsify/adwaita-nativescript/gobject' — its own side-effect import, listed first — so " +
                'that it is evaluated first.',
        );
    }
    registered = engine;
}

/**
 * The engine a port must build its namespace on, or `undefined` when none was registered — which
 * the caller is to read as "use the default", not as an error. Freezes the slot.
 */
export function registeredEngine(): GObjectEngine | undefined {
    wasRead = true;
    return registered;
}

/** Forgets the slot. For tests, which need a second app's worth of module state in one process. */
export function resetRegisteredEngine(): void {
    registered = undefined;
    wasRead = false;
}

// --- What an EMPTY slot means, which is no longer one answer (ADR 0110 § 1) --------------------
//
// It used to be: empty → the pure-JS engine, on every target. On NativeScript ANDROID it is not,
// since the owner's decision of 2026-10-15 on the two gate reports — real GObject is what an
// Android app gets, and the subset is an explicit opt-out there. The browser (no GObject at all)
// and iOS (ADR 0105 § 6) are untouched: empty still means pure JS for them.
//
// WHY A PORT ON ANDROID DOES NOT SIMPLY BUILD THE REAL ENGINE ITSELF. The reason the opt-in is
// app code has not changed with the default: the engine needs `requireGi`, which needs
// `@gjsify/node-gi` plus `@gjsify/gi-runtime-android`'s payload — tier-3, Android-only — and the
// port is tier 2 and installable in a browser. A port that reached for them would make every
// consumer an Android consumer, and a port that reached for them in a try/catch would make
// "which engine backs my subset" unanswerable from inside the app.
//
// So on such a target an empty slot is not a default any more: it is a MISSING DECISION, and
// {@link engineForTarget} says so rather than quietly building the other engine. That is ADR
// 0105's no-silent-fallback rule one level up — the rule was about an opt-in that FAILED, this is
// the same rule about an opt-in that was never made.

/** The target a port builds its namespace for, as {@link engineForTarget} needs to know it. */
export interface EngineTarget {
    /** Named in the refusal, so the message says which port and which target refused. */
    readonly name: string;
    /** True where real GObject is the default — NativeScript Android, and nothing else today. */
    readonly realGObjectIsDefault: boolean;
}

/**
 * The engine a port must build its namespace on. A registered engine wins everywhere. An empty
 * slot is the pure-JS default (`undefined`, which is `createGObject`'s own default) on a target
 * that has one, and an ERROR on a target whose default is real GObject. Freezes the slot.
 */
export function engineForTarget(target: EngineTarget): GObjectEngine | undefined {
    const engine = registeredEngine();
    if (engine !== undefined) return engine;
    if (!target.realGObjectIsDefault) return undefined;
    throw new Error(
        `No GObject engine was registered, and on ${target.name} real GObject is the DEFAULT ` +
            '(ADR 0110 § 1) — there is no implicit fallback to the pure-JS subset here. Either call ' +
            "useRealGObjectEngine(requireGi) from '@gjsify/adwaita-gobject-native', with " +
            "'@gjsify/gi-runtime-android' as a dependency of the app, or call " +
            "usePureJsGObjectEngine() from '@gjsify/adwaita-core' to run on the subset deliberately. " +
            "Either call belongs in a module that is imported BEFORE '@gjsify/adwaita-nativescript', " +
            'as its own side-effect import listed first, so that it is evaluated first.',
    );
}
