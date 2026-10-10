// A `GObjectEngine` whose store is a real GObject — ADR 0105 § 2.
//
// `@gjsify/adwaita-core` re-creates the GObject subset in pure JS because the browser has no
// GObject and NativeScript had none either. On Android it now CAN have one: node-gi reaches real
// GObject through napi (ADR 0104). This engine is that reach — a registered class gets a real
// GType, every instance gets one real instance of it (its TWIN), and property values, `notify`,
// signal emission, emission-stopping and `bind_property` are the real thing.
//
// WHAT IT IS NOT. It is not a second subset. `registerClass`'s refusals, the accessor rule, the
// construct order and every error message stay in the core — `adwaita-core/src/engine.ts` says
// why at length. A vector of `GOBJECT_VECTORS` that the core decides is decided identically here;
// what this engine can change is only what a value read, a write and an emission DO.
//
// WHY A TWIN AND NOT THE INSTANCE ITSELF. The subset's instance is a plain JS object of the
// consumer's own class, built by its own constructor, carrying the port's widget state. node-gi
// hands out its own wrapper for a GObject it registered, and there is no way to make an already
// constructed JS object become one. So the GObject is held BESIDE the instance, keyed by it, and
// every engine operation is forwarded to the twin. The instance stays the identity the consumer
// sees: a handler is called with the instance, never with the twin.
//
// WHY THE TWIN DECLARES EVERYTHING READWRITE. A construct-only property is construct-only in the
// subset — the core refuses the second write and never generates a setter — and the ONLY writer
// left is the engine itself, from `defineConstructOnly`, after the twin already exists. Declaring
// it `CONSTRUCT_ONLY` on the twin would make that one legitimate write fail. The boundary is not
// weakened: it is still the core that enforces it, on the same vector.
//
// WHY `setValue` RETURNS FALSE. `g_object_set_property` emits `notify` itself, and the engine's
// handlers are connected to the twin, so by the time the write returns the notification has
// already reached them. Returning "the core must notify" as false is what keeps it at one.
//
// WHY `requireGi` IS INJECTED. `@gjsify/node-gi` is no workspace member: it resolves only where a
// job links it. A static import of `@gjsify/node-gi/gi` in a type-checked file fails `build:types`
// with TS2307 on every other job, and a dynamic `gi://`-style load would set `dynamic_gi` in
// `scripts/audit-runtimes.mjs`'s textual walk and mis-declare this package. So nothing here
// imports the bridge at all; the caller passes `requireGi` in, exactly as the stage-0 oracle does.

import { bindProperties, type Binding, type BindingFlag } from '@gjsify/adwaita-core';
import type { ClassLike, GObjectEngine, GType, ParamSpec, RegisteredClass } from '@gjsify/adwaita-core';

/**
 * `@gjsify/node-gi/gi`'s default export, as much of it as this engine uses. Declared rather than
 * imported for the reason in the header — the bridge's own types are not resolvable in a job that
 * has not linked it.
 */
export type RequireGi = (namespace: string, version?: string) => unknown;

/** A live GObject as node-gi hands it out: GJS-shaped property access plus the signal API. */
interface RealInstance {
    [property: string]: unknown;
    set_property(name: string, value: unknown): void;
    notify(name: string): void;
    connect(signal: string, handler: (...args: unknown[]) => unknown): number;
    disconnect(id: number): void;
    emit(signal: string, ...args: unknown[]): unknown;
    bind_property(property: string, target: RealInstance, targetProperty: string, flags: number): { unbind(): void };
}

type RealConstructor = new () => RealInstance;

/** A `GObject.ParamSpec.*` descriptor; opaque here, consumed only by `registerClass`. */
type RealParamSpec = unknown;

interface RealGObject {
    registerClass(meta: Record<string, unknown>, klass: Function): RealConstructor;
    Object: RealConstructor;
    ParamSpec: {
        string(name: string, nick: string, blurb: string, flags: number, value?: string): RealParamSpec;
        boolean(name: string, nick: string, blurb: string, flags: number, value?: boolean): RealParamSpec;
        int(n: string, k: string, b: string, f: number, min: number, max: number, value?: number): RealParamSpec;
        uint(n: string, k: string, b: string, f: number, min: number, max: number, value?: number): RealParamSpec;
        double(n: string, k: string, b: string, f: number, min: number, max: number, value?: number): RealParamSpec;
    };
    ParamFlags: Record<string, number>;
    BindingFlags: Record<string, number>;
    signal_stop_emission_by_name(instance: RealInstance, detailedSignal: string): void;
}

/** The subset's signal parameter types in node-gi's vocabulary; the core refuses every other. */
const SIGNAL_TYPES: Readonly<Record<string, string>> = {
    gchararray: 'string',
    gboolean: 'boolean',
    gint: 'int',
    guint: 'uint',
    gdouble: 'double',
};

const BINDING_BITS: Readonly<Record<BindingFlag, string>> = {
    bidirectional: 'BIDIRECTIONAL',
    'sync-create': 'SYNC_CREATE',
    'invert-boolean': 'INVERT_BOOLEAN',
};

/** The widest range of each numeric kind, for a ParamSpec the subset built without one. */
const RANGES: Readonly<Record<'int' | 'uint' | 'double', readonly [number, number]>> = {
    int: [-2147483648, 2147483647],
    uint: [0, 4294967295],
    double: [-Number.MAX_VALUE, Number.MAX_VALUE],
};

function aliasesOf(name: string): string[] {
    return [name, name.replace(/-/g, '_'), name.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase())];
}

/**
 * A real {@link GObjectEngine}: every registered class gets a GType, every instance a GObject.
 *
 * `requireGi` is `@gjsify/node-gi/gi`'s loader (or anything GJS-shaped — `imports.gi` answers the
 * same calls), so the only thing this package needs of the bridge is handed to it.
 */
export function createRealGioEngine(requireGi: RequireGi): GObjectEngine {
    const GObject = requireGi('GObject', '2.0') as unknown as RealGObject;
    const READWRITE = GObject.ParamFlags.READWRITE;

    /** The GType of a registered subset class, and the info it was registered with. */
    const TWINS = new WeakMap<ClassLike, RealConstructor>();
    const INFOS = new WeakMap<ClassLike, RegisteredClass>();
    /** The one real GObject an instance stands for, built the first time anything needs it. */
    const INSTANCES = new WeakMap<object, RealInstance>();
    /** The core's handler id → the `g_signal_connect` id it stands for. */
    const HANDLERS = new WeakMap<object, Map<number, number>>();
    /**
     * The emissions this engine has in progress, innermost last. Real GObject knows them too, but
     * only `g_signal_stop_emission` can ask — and it CRITICALs instead of answering when there is
     * none, which is exactly the case the core wants told apart. So the stack is kept here to
     * decide, and the real call is made only once a match is found.
     */
    const EMISSIONS = new WeakMap<object, { readonly key: string; stopped: boolean }[]>();
    /**
     * The properties this engine has already read or written, per instance. `PURE_JS_ENGINE` holds
     * its values in a `Map` whose unset slot reads as `undefined`, which carries one bit
     * implicitly: a FIRST write counts as a change even when it equals the default, and a read
     * populates the slot with the default, so a default-equal write AFTER a read does not. A twin
     * has no unset slot — it answers the default from the moment it exists — so that bit is kept
     * here explicitly and the two engines decide every write alike.
     */
    const TOUCHED = new WeakMap<object, Set<string>>();

    let registrations = 0;

    /** Marks a property seen on an instance, answering whether this is the first time. */
    function touch(instance: object, property: string): boolean {
        let seen = TOUCHED.get(instance);
        if (!seen) TOUCHED.set(instance, (seen = new Set()));
        const first = !seen.has(property);
        seen.add(property);
        return first;
    }

    /**
     * A GType name no other registration can have taken. The subset's own type name is not unique
     * enough: `GOBJECT_VECTORS` registers the same class names on every subject, a GType name is
     * process-global, and a duplicate throws `a GType named 'X' is already registered`. The name is
     * also sanitised to what `g_type_register_static` accepts, which is narrower than the core's
     * own sanitisation.
     */
    function uniqueTypeName(typeName: string): string {
        const sanitised = typeName.replace(/[^A-Za-z0-9_+-]/g, '_').replace(/^[^A-Za-z_]/, '_');
        return `${sanitised || '_'}_RealGio${++registrations}`;
    }

    function paramSpecFor(spec: ParamSpec): RealParamSpec {
        const { name, nick, blurb } = spec;
        const fallback = spec.kind === 'string' || spec.kind === 'boolean' ? undefined : RANGES[spec.kind];
        const minimum = spec.minimum ?? fallback?.[0] ?? 0;
        const maximum = spec.maximum ?? fallback?.[1] ?? 0;
        const value = spec.get_default_value();
        switch (spec.kind) {
            case 'boolean':
                return GObject.ParamSpec.boolean(name, nick, blurb, READWRITE, value as boolean);
            case 'string':
                // A null default is a NULL default: node-gi takes the absent argument for it.
                return GObject.ParamSpec.string(name, nick, blurb, READWRITE, (value ?? undefined) as string);
            case 'int':
                return GObject.ParamSpec.int(name, nick, blurb, READWRITE, minimum, maximum, value as number);
            case 'uint':
                return GObject.ParamSpec.uint(name, nick, blurb, READWRITE, minimum, maximum, value as number);
            case 'double':
                return GObject.ParamSpec.double(name, nick, blurb, READWRITE, minimum, maximum, value as number);
        }
    }

    function signalTypeOf(type: GType): string {
        const mapped = SIGNAL_TYPES[type.name];
        if (mapped === undefined) {
            throw new TypeError(`real-gio engine: no GObject signal parameter type for '${type.name}'`);
        }
        return mapped;
    }

    /** The nearest twin above `klass`, so the twins mirror the subset's own chain. */
    function parentTwinOf(klass: ClassLike): RealConstructor {
        for (let each: unknown = Object.getPrototypeOf(klass); typeof each === 'function';) {
            const twin = TWINS.get(each as ClassLike);
            if (twin) return twin;
            each = Object.getPrototypeOf(each);
        }
        return GObject.Object;
    }

    function registeredChainOf(instance: object): RegisteredClass[] {
        const found: RegisteredClass[] = [];
        for (let each: unknown = (instance as { constructor: unknown }).constructor; typeof each === 'function';) {
            const info = INFOS.get(each as ClassLike);
            if (info) found.push(info);
            each = Object.getPrototypeOf(each);
        }
        return found;
    }

    function twinClassOf(instance: object): RealConstructor | undefined {
        for (let each: unknown = (instance as { constructor: unknown }).constructor; typeof each === 'function';) {
            const twin = TWINS.get(each as ClassLike);
            if (twin) return twin;
            each = Object.getPrototypeOf(each);
        }
        return undefined;
    }

    function twinOf(instance: object): RealInstance {
        const found = INSTANCES.get(instance);
        if (found) return found;
        const Twin = twinClassOf(instance);
        if (!Twin) {
            const name = (instance as { constructor?: { name?: string } }).constructor?.name ?? String(instance);
            throw new Error(`real-gio engine: '${name}' was never registered against this engine`);
        }
        const twin = new Twin();
        INSTANCES.set(instance, twin);
        return twin;
    }

    /** The ParamSpec a `notify::<property>` key names, so a handler sees the SUBSET's spec. */
    function specOf(instance: object, property: string): ParamSpec | undefined {
        for (const info of registeredChainOf(instance)) {
            for (const spec of info.properties) {
                if (spec.name === property) return spec;
            }
        }
        return undefined;
    }

    /** `bind_property` needs the canonical dashed name; a consumer may write any of the aliases. */
    function canonicalPropertyOf(instance: object, property: string): string {
        for (const info of registeredChainOf(instance)) {
            for (const spec of info.properties) {
                if (aliasesOf(spec.name).includes(property)) return spec.name;
            }
        }
        return property;
    }

    function withEmission(instance: object, key: string, run: () => void): void {
        let stack = EMISSIONS.get(instance);
        if (!stack) EMISSIONS.set(instance, (stack = []));
        stack.push({ key, stopped: false });
        try {
            run();
        } finally {
            stack.pop();
        }
    }

    return {
        name: 'real-gio',

        register(info) {
            const Parent = parentTwinOf(info.klass);
            const properties: Record<string, RealParamSpec> = {};
            for (const spec of info.properties) properties[spec.name] = paramSpecFor(spec);
            const signals: Record<string, { param_types: string[] }> = {};
            for (const [name, types] of Object.entries(info.signals)) {
                signals[name] = { param_types: types.map(signalTypeOf) };
            }
            TWINS.set(
                info.klass,
                GObject.registerClass(
                    { GTypeName: uniqueTypeName(info.typeName), Properties: properties, Signals: signals },
                    class extends Parent {},
                ),
            );
            INFOS.set(info.klass, info);
        },

        getValue(instance, spec) {
            // Bracket access, because a dashed property name is not an identifier.
            const twin = twinOf(instance);
            touch(instance, spec.name);
            return twin[spec.name];
        },

        setValue(instance, spec, value) {
            const twin = twinOf(instance);
            // AN EQUAL WRITE IS NOT A CHANGE — and that rule is the engine's to apply, not
            // GObject's. `g_object_set_property` notifies UNCONDITIONALLY (measured: two equal
            // writes, two notifies); in both GJS and node-gi the comparison lives in the
            // GENERATED ACCESSOR, which this engine stands in for. Without it the subset notified
            // twice where GJS notifies once, on two of the vectors.
            if (!touch(instance, spec.name) && twin[spec.name] === value) return false;
            // Otherwise the write IS the notification: `set_property` emits `notify::<name>` to
            // the handlers already connected to this twin. So the emission is pushed around the
            // write — a handler of it may stop it — and the core is told it has nothing left to do.
            withEmission(instance, `notify::${spec.name}`, () => {
                twin.set_property(spec.name, value);
            });
            return false;
        },

        addHandler(instance, id, key, handler) {
            const twin = twinOf(instance);
            const spec = key.startsWith('notify::') ? specOf(instance, key.slice('notify::'.length)) : undefined;
            // The handler is the consumer's: it gets the INSTANCE as emitter, never the twin, and
            // for a notify the subset's own ParamSpec rather than the real one.
            const realId = twin.connect(key, (_emitter, ...args) =>
                spec === undefined ? handler(instance, ...args) : handler(instance, spec),
            );
            let book = HANDLERS.get(instance);
            if (!book) HANDLERS.set(instance, (book = new Map()));
            book.set(id, realId);
        },

        removeHandler(instance, id) {
            const book = HANDLERS.get(instance);
            const realId = book?.get(id);
            if (realId === undefined) return false;
            book!.delete(id);
            twinOf(instance).disconnect(realId);
            return true;
        },

        emit(instance, key, args) {
            withEmission(instance, key, () => {
                twinOf(instance).emit(key, ...args);
            });
        },

        notify(instance, spec) {
            withEmission(instance, `notify::${spec.name}`, () => {
                twinOf(instance).notify(spec.name);
            });
        },

        stopEmission(instance, key) {
            const stack = EMISSIONS.get(instance) ?? [];
            for (let index = stack.length - 1; index >= 0; index--) {
                const emission = stack[index]!;
                if (emission.key === key && !emission.stopped) {
                    emission.stopped = true;
                    GObject.signal_stop_emission_by_name(twinOf(instance), key);
                    return true;
                }
            }
            return false;
        },

        bind(source, sourceProperty, target, targetProperty, flags): Binding {
            // A bind may cross out of this engine: the door's own widgets are no registered class
            // and have no twin. There is no real GBinding to make then, so the portable binding
            // engine — which only needs `notify` and a property write, both of which the core
            // routes back here — carries it.
            if (!twinClassOf(source) || !twinClassOf(target)) {
                return bindProperties(source, sourceProperty, target, targetProperty, flags);
            }
            const bits = flags.reduce(
                (all, flag) => all | (GObject.BindingFlags[BINDING_BITS[flag]] ?? 0),
                GObject.BindingFlags.DEFAULT ?? 0,
            );
            const binding = twinOf(source).bind_property(
                canonicalPropertyOf(source, sourceProperty),
                twinOf(target),
                canonicalPropertyOf(target, targetProperty),
                bits,
            );
            return { unbind: () => binding.unbind() };
        },
    };
}
