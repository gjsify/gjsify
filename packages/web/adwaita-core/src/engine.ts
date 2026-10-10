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

import type { Binding, BindingFlag, GObjectInstance, ParamSpec, RegisteredClass, SignalHandler } from './gobject.js';

export interface GObjectEngine {
    /** Names the engine in a diagnostic; `'pure-js'` for the default one. */
    readonly name: string;

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
     * returns whether that CHANGED anything. The return value is what decides a `notify`: the core
     * notifies iff this is true, and never for the construct write. An unset slot counts as
     * changed even for a value equal to the default, as `_generateAccessors` does.
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
