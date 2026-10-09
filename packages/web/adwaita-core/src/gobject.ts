// The GObject subset a GNOME component class needs, without GObject — ADR 0096 §§ 1–3.
//
// Renderer-free: a per-instance property store, the accessor rule of GJS's `_checkAccessors` /
// `_generateAccessors` (modules/core/_common.js), a signal registry, the binding engine, the
// meta reader behind `registerClass`, and the construction order of `Gtk.Widget.prototype._init`
// (modules/core/overrides/Gtk.js). What a port supplies is a {@link GObjectDoor}: how its
// widgets dispatch and listen for a named event, build a widget from a tree and take the built
// children. Real `gi://GObject` is the oracle of `@gjsify/adwaita-core/conformance`'s
// `GOBJECT_VECTORS`; a behaviour that is not in them is not claimed.
//
// THE SUBSET IS A BOUNDARY, NOT A DEFAULT: a meta key, a `vfunc_*` or a signal parameter type
// that ADR 0096 § 2 does not list is refused by name at registration, where GJS would accept it.

import type { SharedTreeNode } from './conformance/shared-trees.js';

/** What `registerClass` accepts as `Template`: the projected tree of a `?template` import (ADR 0096 § 4). */
export type BlueprintTemplate = SharedTreeNode;

/** The subset asked for something it does not list. `feature` is the name that was refused. */
export class UnsupportedGObjectError extends Error {
    readonly feature: string;

    constructor(feature: string, message: string) {
        super(message);
        this.name = 'UnsupportedGObjectError';
        this.feature = feature;
    }
}

// --- Types and param specs -------------------------------------------------------------------

/** An opaque GType token: it names a type and proves nothing else. */
export interface GType {
    readonly name: string;
}

const KNOWN_TYPES = new WeakSet<object>();

function makeType(name: string): GType {
    const type = Object.freeze({ name });
    KNOWN_TYPES.add(type);
    return type;
}

export const TYPE_STRING = makeType('gchararray');
export const TYPE_BOOLEAN = makeType('gboolean');
export const TYPE_INT = makeType('gint');
export const TYPE_UINT = makeType('guint');
export const TYPE_DOUBLE = makeType('gdouble');

const SIGNAL_PARAM_TYPES: readonly GType[] = [TYPE_STRING, TYPE_BOOLEAN, TYPE_INT, TYPE_UINT, TYPE_DOUBLE];

export const ParamFlags = {
    READABLE: 1,
    WRITABLE: 2,
    READWRITE: 3,
    CONSTRUCT: 4,
    CONSTRUCT_ONLY: 8,
} as const;

export type ParamKind = 'boolean' | 'string' | 'int' | 'uint' | 'double';

export class ParamSpec {
    readonly kind: ParamKind;
    readonly name: string;
    readonly nick: string;
    readonly blurb: string;
    readonly flags: number;
    readonly minimum?: number;
    readonly maximum?: number;
    private readonly defaultValue: unknown;

    private constructor(
        kind: ParamKind,
        name: string,
        nick: string,
        blurb: string,
        flags: number,
        defaultValue: unknown,
        minimum?: number,
        maximum?: number,
    ) {
        this.kind = kind;
        this.name = name;
        this.nick = nick;
        this.blurb = blurb;
        this.flags = flags;
        this.defaultValue = defaultValue;
        this.minimum = minimum;
        this.maximum = maximum;
    }

    static boolean(name: string, nick: string, blurb: string, flags: number, defaultValue: boolean): ParamSpec {
        return new ParamSpec('boolean', name, nick, blurb, flags, defaultValue);
    }

    static string(name: string, nick: string, blurb: string, flags: number, defaultValue: string | null): ParamSpec {
        return new ParamSpec('string', name, nick, blurb, flags, defaultValue);
    }

    static int(
        name: string,
        nick: string,
        blurb: string,
        flags: number,
        minimum: number,
        maximum: number,
        defaultValue: number,
    ): ParamSpec {
        return new ParamSpec('int', name, nick, blurb, flags, defaultValue, minimum, maximum);
    }

    static uint(
        name: string,
        nick: string,
        blurb: string,
        flags: number,
        minimum: number,
        maximum: number,
        defaultValue: number,
    ): ParamSpec {
        return new ParamSpec('uint', name, nick, blurb, flags, defaultValue, minimum, maximum);
    }

    static double(
        name: string,
        nick: string,
        blurb: string,
        flags: number,
        minimum: number,
        maximum: number,
        defaultValue: number,
    ): ParamSpec {
        return new ParamSpec('double', name, nick, blurb, flags, defaultValue, minimum, maximum);
    }

    get_default_value(): unknown {
        return this.defaultValue;
    }
}

/** GJS's own symbols, so a class written in the field form (`static [GObject.properties] = …`) registers. */
export const META_SYMBOLS = {
    GTypeName: Symbol('GType name'),
    GTypeFlags: Symbol('GType flags'),
    interfaces: Symbol('GType interfaces'),
    properties: Symbol('GObject properties'),
    signals: Symbol('GObject signals'),
    requires: Symbol('GObject interface requires'),
    template: Symbol('GTK widget template'),
    cssName: Symbol('GTK widget CSS name'),
    children: Symbol('GTK widget template children'),
    internalChildren: Symbol('GTK widget template internal children'),
} as const;

const ACCEPTED_META: Readonly<Record<string, symbol>> = {
    GTypeName: META_SYMBOLS.GTypeName,
    Template: META_SYMBOLS.template,
    InternalChildren: META_SYMBOLS.internalChildren,
    Properties: META_SYMBOLS.properties,
    Signals: META_SYMBOLS.signals,
    CssName: META_SYMBOLS.cssName,
};

const REFUSED_META: Readonly<Record<string, symbol>> = {
    Children: META_SYMBOLS.children,
    Implements: META_SYMBOLS.interfaces,
    Requires: META_SYMBOLS.requires,
    GTypeFlags: META_SYMBOLS.GTypeFlags,
};

// --- The door --------------------------------------------------------------------------------

/** What a port's widget tree gives back for one built template. */
export interface BuiltTemplate {
    /** The children to attach to the host, in order. */
    readonly children: readonly object[];
    /** Every object the template names with an `id`, for `InternalChildren`. */
    readonly objects: Readonly<Record<string, object>>;
}

export type BindingFlag = 'bidirectional' | 'sync-create' | 'invert-boolean';

export interface Binding {
    unbind(): void;
}

/** What the builder of a port is handed: the instance, its handlers and the binding engine. */
export interface TemplateScope {
    /** The template instance — the scope of every handler and the `template` bind source. */
    readonly instance: object;
    /** `_createClosure`: looked up on the instance, bound to `options.object` or the instance. */
    handler(name: string, options?: { object?: object; flags?: readonly string[] }): (...args: unknown[]) => unknown;
    bind(
        source: GObjectInstance,
        sourceProperty: string,
        target: GObjectInstance,
        targetProperty: string,
        flags?: readonly BindingFlag[],
    ): Binding;
}

/** The one thing a port implements over its widget model (ADR 0096 § 1). */
export interface GObjectDoor {
    readonly name: string;
    /** Dispatches the named event on a widget that is not the core's to dispatch. */
    dispatch(target: object, event: string, args: readonly unknown[]): void;
    /** Listens for it; the handler is called `(target, ...args)`. Returns the disconnect. */
    listen(target: object, event: string, handler: (...args: unknown[]) => unknown): () => void;
    /** Creates the widgets of a template, wiring signals and binds through `scope`. */
    createFromTree(tree: BlueprintTemplate, scope: TemplateScope, host: object): BuiltTemplate;
    /** Gives the built children to the host. A port may defer the attach to its own lifecycle. */
    attach(host: object, built: BuiltTemplate): void;
    /** A class was registered: the port defines its element and its `$GTypeName` template entry. */
    register(klass: ClassLike, info: RegisteredClass): void;
}

// --- Registered classes ----------------------------------------------------------------------

export type ClassLike = abstract new (...args: never[]) => object;

export interface RegisteredClass {
    readonly klass: ClassLike;
    readonly typeName: string;
    readonly gtype: GType;
    readonly properties: readonly ParamSpec[];
    /** Signal name → its parameter types. */
    readonly signals: Readonly<Record<string, readonly GType[]>>;
    readonly template?: BlueprintTemplate;
    readonly internalChildren: readonly string[];
    readonly cssName?: string;
    readonly door: GObjectDoor;
}

const REGISTRY = new WeakMap<object, RegisteredClass>();

export function registeredClassOf(klass: object): RegisteredClass | undefined {
    return REGISTRY.get(klass);
}

/** The registered classes of a constructor's static chain, most derived first. */
function chainOf(klass: unknown): RegisteredClass[] {
    const found: RegisteredClass[] = [];
    for (let each = klass; typeof each === 'function'; each = Object.getPrototypeOf(each)) {
        const info = REGISTRY.get(each);
        if (info) found.push(info);
    }
    return found;
}

function chainOfInstance(instance: object): RegisteredClass[] {
    return chainOf((instance as { constructor: unknown }).constructor);
}

function typeNameOf(instance: object, chain: readonly RegisteredClass[]): string {
    return chain[0]?.typeName ?? (instance as { constructor: { name: string } }).constructor.name;
}

function aliasesOf(name: string): string[] {
    return [name, name.replace(/-/g, '_'), name.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase())];
}

function findProperty(chain: readonly RegisteredClass[], name: string): ParamSpec | undefined {
    for (const info of chain) {
        for (const spec of info.properties) {
            if (aliasesOf(spec.name).includes(name)) return spec;
        }
    }
    return undefined;
}

function findSignal(chain: readonly RegisteredClass[], name: string): readonly GType[] | undefined {
    for (const info of chain) {
        if (Object.prototype.hasOwnProperty.call(info.signals, name)) return info.signals[name];
    }
    return undefined;
}

// --- The instance: property store, signal registry -------------------------------------------

export type SignalHandler = (emitter: GObjectInstance, ...args: unknown[]) => unknown;

/** The instance surface of a registered class (ADR 0096 § 2, "instance API" row). */
export interface GObjectInstance {
    [key: string]: unknown;
    notify(name: string): void;
    connect(signal: string, handler: SignalHandler): number;
    disconnect(id: number): void;
    emit(signal: string, ...args: unknown[]): void;
}

interface InstanceState {
    readonly values: Map<string, unknown>;
    readonly handlers: Map<string, { id: number; handler: SignalHandler }[]>;
    readonly connections: Map<number, () => void>;
    /** The emissions in progress, innermost last: `signal_stop_emission_by_name` marks the last match. */
    readonly emissions: { readonly key: string; stopped: boolean }[];
}

const STATE = new WeakMap<object, InstanceState>();
let nextHandlerId = 0;

function stateOf(instance: object): InstanceState {
    let state = STATE.get(instance);
    if (!state) {
        state = {
            values: new Map(),
            handlers: new Map(),
            connections: new Map(),
            emissions: [],
        };
        STATE.set(instance, state);
    }
    return state;
}

function parseSignal(signal: string): { name: string; detail?: string } {
    const at = signal.indexOf('::');
    return at === -1 ? { name: signal } : { name: signal.slice(0, at), detail: signal.slice(at + 2) };
}

function addHandler(instance: object, key: string, handler: SignalHandler): number {
    const state = stateOf(instance);
    const id = ++nextHandlerId;
    const list = state.handlers.get(key) ?? [];
    list.push({ id, handler });
    state.handlers.set(key, list);
    state.connections.set(id, () => {
        list.splice(
            list.findIndex((each) => each.id === id),
            1,
        );
    });
    return id;
}

function runHandlers(instance: GObjectInstance, key: string, args: readonly unknown[]): void {
    const state = stateOf(instance);
    const emission = { key, stopped: false };
    state.emissions.push(emission);
    try {
        // A copy: a handler may connect or disconnect during the emission.
        for (const { id, handler } of (state.handlers.get(key) ?? []).slice()) {
            if (emission.stopped) break;
            // A handler disconnected by an earlier one of the same emission must not run.
            if (state.connections.has(id)) handler(instance, ...args);
        }
    } finally {
        state.emissions.pop();
    }
}

/**
 * How an object that is no registered class (the GtkSource buffer and view) takes part in
 * `signal_stop_emission_by_name`: it keeps its own emissions and stops the innermost one of the
 * named signal. A registered symbol, so a package that cannot depend on this one can still define it.
 */
export const STOP_EMISSION: unique symbol = Symbol.for('@gjsify/adwaita-core/stop-emission') as never;

export interface StoppableEmitter {
    [STOP_EMISSION](detailedSignal: string): void;
}

function isStoppable(instance: object): instance is StoppableEmitter {
    return typeof (instance as Partial<StoppableEmitter>)[STOP_EMISSION] === 'function';
}

/**
 * `GObject.signal_stop_emission_by_name`: stops the innermost emission in progress of the signal on the
 * instance, so the handlers after the current one do not run. With none in progress GLib warns and
 * does nothing (`g_signal_stop_emission`: "no emission of signal ... to stop").
 */
export function stopEmissionByName(instance: GObjectInstance, detailedSignal: string): void {
    if (typeof instance !== 'object' || instance === null) {
        throw new TypeError('GObject.signal_stop_emission_by_name: not a GObject instance');
    }
    if (isStoppable(instance)) {
        instance[STOP_EMISSION](detailedSignal);
        return;
    }
    const chain = chainOfInstance(instance);
    const typeName = typeNameOf(instance, chain);
    const { name, detail } = parseSignal(detailedSignal);
    let key: string | undefined;
    if (name === 'notify' && detail !== undefined) {
        const spec = findProperty(chain, detail);
        if (spec) key = `notify::${spec.name}`;
    } else if (detail === undefined && findSignal(chain, name)) key = name;
    if (key === undefined) {
        if (!chain[0])
            throw new UnsupportedGObjectError(
                'signal_stop_emission_by_name',
                `'${detailedSignal}' on '${typeName}' is not a signal of a registered class; only those can be stopped.`,
            );
        console.warn(`signal '${detailedSignal}' is invalid for instance of type '${typeName}'`);
        return;
    }
    const emissions = stateOf(instance).emissions;
    for (let index = emissions.length - 1; index >= 0; index--) {
        const emission = emissions[index]!;
        if (emission.key === key && !emission.stopped) {
            emission.stopped = true;
            return;
        }
    }
    console.warn(`no emission of signal "${detailedSignal}" to stop for instance of type '${typeName}'`);
}

export function connectInstance(instance: GObjectInstance, signal: string, handler: SignalHandler): number {
    const chain = chainOfInstance(instance);
    const typeName = typeNameOf(instance, chain);
    const { name, detail } = parseSignal(signal);
    const foreign = (): number => {
        const door = chain[0]?.door;
        if (!door) throw new Error(`No signal '${signal}' on object '${typeName}'`);
        const id = ++nextHandlerId;
        const unlisten = door.listen(instance, signal, handler as (...args: unknown[]) => unknown);
        stateOf(instance).connections.set(id, unlisten);
        return id;
    };
    if (name === 'notify') {
        if (detail === undefined) {
            throw new UnsupportedGObjectError(
                'connect("notify")',
                `connect('notify') without a property is outside the GObject subset; connect 'notify::<property>' on '${typeName}'.`,
            );
        }
        const spec = findProperty(chain, detail);
        return spec ? addHandler(instance, `notify::${spec.name}`, handler) : foreign();
    }
    if (findSignal(chain, name)) {
        if (detail !== undefined) throw new Error(`Signal '${name}' on object '${typeName}' has no detail`);
        return addHandler(instance, name, handler);
    }
    return foreign();
}

export function disconnectInstance(instance: GObjectInstance, id: number): void {
    const state = stateOf(instance);
    const disconnect = state.connections.get(id);
    if (!disconnect) throw new Error(`No handler with id ${id} is connected to ${String(instance)}`);
    state.connections.delete(id);
    disconnect();
}

export function emitInstance(instance: GObjectInstance, signal: string, ...args: unknown[]): void {
    const chain = chainOfInstance(instance);
    const typeName = typeNameOf(instance, chain);
    const types = findSignal(chain, signal);
    if (types) {
        if (args.length !== types.length) {
            throw new Error(`Signal '${signal}' on ${typeName} requires ${types.length} args got ${args.length}`);
        }
        runHandlers(instance, signal, args);
        return;
    }
    const door = chain[0]?.door;
    if (!door) throw new Error(`No signal '${signal}' on object '${typeName}'`);
    door.dispatch(instance, signal, args);
}

export function notifyInstance(instance: GObjectInstance, name: string): void {
    const chain = chainOfInstance(instance);
    const spec = findProperty(chain, name);
    if (spec) {
        runHandlers(instance, `notify::${spec.name}`, [spec]);
        return;
    }
    const door = chain[0]?.door;
    if (!door) throw new Error(`No property ${name} on ${typeNameOf(instance, chain)}`);
    door.dispatch(instance, `notify::${name}`, []);
}

// --- Accessors: GJS's `_checkAccessors` / `_generateAccessors` -------------------------------

function generateAccessors(spec: ParamSpec, existing: PropertyDescriptor | undefined): PropertyDescriptor {
    const { name, flags } = spec;
    const readable = flags & ParamFlags.READABLE;
    const writable = flags & ParamFlags.WRITABLE;
    const descriptor: PropertyDescriptor = existing ?? {
        configurable: true,
        enumerable: true,
    };

    if (readable && writable) {
        if (!descriptor.get && !descriptor.set) {
            descriptor.get = function (this: object) {
                const { values } = stateOf(this);
                if (!values.has(name)) values.set(name, spec.get_default_value());
                return values.get(name);
            };
            descriptor.set = function (this: GObjectInstance, value: unknown) {
                const { values } = stateOf(this);
                // An unset slot reads as `undefined`, so the first assignment of a property nobody
                // has read yet notifies even when it equals the default — as `_generateAccessors` does.
                if (value !== values.get(name)) {
                    values.set(name, value);
                    this.notify(name);
                }
            };
        } else if (!descriptor.get) {
            descriptor.get = function () {
                throw new Error(`setter defined without getter for property ${name}`);
            };
        } else if (!descriptor.set) {
            descriptor.set = function () {
                throw new Error(`getter defined without setter for property ${name}`);
            };
        }
    } else if (readable && !descriptor.get) {
        descriptor.get = function () {
            throw new Error(`missing getter for read-only property ${name}`);
        };
    } else if (writable && !descriptor.set) {
        descriptor.set = function () {
            throw new Error(`missing setter for write-only property ${name}`);
        };
    }
    return descriptor;
}

function checkAccessors(proto: object, spec: ParamSpec): void {
    const { name, flags } = spec;
    if (flags & ParamFlags.CONSTRUCT_ONLY) return;

    const [, underscoreName, camelName] = aliasesOf(name);
    const own = (key: string) => Object.getOwnPropertyDescriptor(proto, key);
    let descriptor = own(name);
    const dashDescriptor = descriptor;
    const isCompound = name.includes('-');
    let underscoreDescriptor: PropertyDescriptor | undefined;
    let camelDescriptor: PropertyDescriptor | undefined;
    if (isCompound) {
        underscoreDescriptor = own(underscoreName);
        camelDescriptor = own(camelName);
        descriptor ??= underscoreDescriptor;
        descriptor ??= camelDescriptor;
    }

    const readable = flags & ParamFlags.READABLE;
    const writable = flags & ParamFlags.WRITABLE;
    if (!descriptor || (readable && !descriptor.get) || (writable && !descriptor.set)) {
        descriptor = generateAccessors(spec, descriptor);
    }

    if (!dashDescriptor) Object.defineProperty(proto, name, descriptor);
    if (isCompound) {
        if (!underscoreDescriptor) Object.defineProperty(proto, underscoreName, descriptor);
        if (!camelDescriptor) Object.defineProperty(proto, camelName, descriptor);
    }
}

/** A construct-only property has no accessor on the class; the instance carries the value it was built with. */
function defineConstructOnly(instance: object, spec: ParamSpec, value: unknown): void {
    const { values } = stateOf(instance);
    values.set(spec.name, value);
    for (const alias of new Set(aliasesOf(spec.name))) {
        Object.defineProperty(instance, alias, {
            get: () => values.get(spec.name),
            enumerable: true,
            configurable: true,
        });
    }
}

// --- Binding engine --------------------------------------------------------------------------

/**
 * `g_object_bind_property` for the three flags the template builders need. The target follows the
 * source on every `notify::<source property>`; `bidirectional` makes the source follow the target
 * back, `invert-boolean` negates what crosses, `sync-create` transfers once at bind time.
 */
export function bindProperties(
    source: GObjectInstance,
    sourceProperty: string,
    target: GObjectInstance,
    targetProperty: string,
    flags: readonly BindingFlag[] = [],
): Binding {
    const invert = flags.includes('invert-boolean');
    let transferring = false;
    const transfer = (from: GObjectInstance, fromProperty: string, to: GObjectInstance, toProperty: string) => () => {
        // The follower's own notification would otherwise come straight back.
        if (transferring) return;
        transferring = true;
        try {
            const value = from[fromProperty];
            to[toProperty] = invert ? !value : value;
        } finally {
            transferring = false;
        }
    };

    const forward = transfer(source, sourceProperty, target, targetProperty);
    const connections: [GObjectInstance, number][] = [[source, source.connect(`notify::${sourceProperty}`, forward)]];
    if (flags.includes('bidirectional')) {
        const back = transfer(target, targetProperty, source, sourceProperty);
        connections.push([target, target.connect(`notify::${targetProperty}`, back)]);
    }
    if (flags.includes('sync-create')) forward();

    return {
        unbind() {
            for (const [instance, id] of connections.splice(0)) instance.disconnect(id);
        },
    };
}

// --- Handlers: GJS's `_createClosure` --------------------------------------------------------

export function createClosure(
    thisArg: object,
    handlerName: string,
    swapped: boolean,
    connectObject?: object,
): (...args: unknown[]) => unknown {
    const target = connectObject ?? thisArg;
    if (swapped) throw new UnsupportedGObjectError('swapped', 'Unsupported template signal flag "swapped"');
    const handler = (thisArg as Record<string, unknown>)[handlerName];
    if (typeof handler === 'undefined') {
        throw new Error(`A handler called ${handlerName} was not defined on ${String(thisArg)}`);
    }
    return (handler as (...args: unknown[]) => unknown).bind(target);
}

function scopeOf(instance: object): TemplateScope {
    return {
        instance,
        handler: (name, options) =>
            createClosure(instance, name, options?.flags?.includes('swapped') ?? false, options?.object),
        bind: bindProperties,
    };
}

// --- Construction: the order of `Gtk.Widget.prototype._init` ---------------------------------

/**
 * Runs ADR 0096 § 3 steps 4–5 for a registered instance, in GJS's order: every template of the
 * class chain is built first (base first), then the construct properties are set, and only then
 * is each `InternalChildren` id installed as `this._<id>`. So `this._x` is `undefined` inside a
 * property setter that runs during construction and defined once `super(params)` returns.
 *
 * Returns the params that are not declared properties, for the port's own construct bag.
 */
export function constructRegistered(
    instance: object,
    params: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
    const chain = chainOfInstance(instance);
    const rest: Record<string, unknown> = {};
    const given = new Map<ParamSpec, unknown>();
    for (const [key, value] of Object.entries(params)) {
        const spec = findProperty(chain, key);
        if (spec) given.set(spec, value);
        else rest[key] = value;
    }

    const built: [RegisteredClass, BuiltTemplate][] = [];
    for (const info of [...chain].reverse()) {
        if (info.template) {
            built.push([info, info.door.createFromTree(info.template, scopeOf(instance), instance)]);
        }
    }

    for (const info of chain) {
        for (const spec of info.properties) {
            if (spec.flags & ParamFlags.CONSTRUCT_ONLY) {
                defineConstructOnly(instance, spec, given.has(spec) ? given.get(spec) : spec.get_default_value());
            }
        }
    }
    for (const [spec, value] of given) {
        if (!(spec.flags & ParamFlags.CONSTRUCT_ONLY)) (instance as Record<string, unknown>)[spec.name] = value;
    }

    for (const [info, template] of built) {
        for (const id of info.internalChildren) {
            const child = template.objects[id];
            if (child === undefined) {
                throw new Error(`Template of ${info.typeName} has no child object '${id}' for InternalChildren`);
            }
            (instance as Record<string, unknown>)[`_${id.replace(/-/g, '_')}`] = child;
        }
        info.door.attach(instance, template);
    }
    return rest;
}

// --- registerClass: the meta reader ----------------------------------------------------------

export interface SignalMeta {
    param_types?: readonly GType[];
    [refused: string]: unknown;
}

export interface ClassMeta {
    GTypeName?: string;
    Template?: unknown;
    InternalChildren?: readonly string[];
    Properties?: Readonly<Record<string, ParamSpec>>;
    Signals?: Readonly<Record<string, SignalMeta>>;
    CssName?: string;
    [refused: string]: unknown;
}

export interface RegisterClass {
    <T extends ClassLike>(meta: ClassMeta, klass: T): T;
    <T extends ClassLike>(klass: T): T;
}

type Klass = { prototype: object; name: string } & Record<PropertyKey, unknown>;

const own = (target: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(target, key);

/** A core class declares the GIR type its `vfunc_*` are listed under in {@link UNLOCKED_VFUNCS}. */
export const GIR_TYPE = Symbol('GIR type');

/**
 * The `vfunc_*` a registered class may override (ADR 0098 § 1a), keyed by the GIR class that declares
 * them. Every other `vfunc_*` is refused by name. An entry needs a vector of `APPLICATION_VECTORS`
 * (`unlocks`) that holds on real GJS; `application.spec.ts` fails an entry without one.
 */
export const UNLOCKED_VFUNCS: Readonly<Record<string, readonly string[]>> = {
    'Gio.Application': ['vfunc_startup', 'vfunc_activate'],
    // Proven by the gutter paint vectors of `@gjsify/gtksource-core` (ADR 0103), against real GtkSource.
    'GtkSource.GutterRenderer': ['vfunc_query_data'],
};

/** The vfuncs unlocked for a class: the lists of every GIR type on its static chain, itself included. */
function unlockedVfuncsOf(klass: object): Set<string> {
    const found = new Set<string>();
    for (let each: unknown = klass; typeof each === 'function'; each = Object.getPrototypeOf(each)) {
        const girType = own(each, GIR_TYPE) ? (each as unknown as Record<symbol, unknown>)[GIR_TYPE] : undefined;
        if (typeof girType === 'string') for (const name of UNLOCKED_VFUNCS[girType] ?? []) found.add(name);
    }
    return found;
}

function refusal(className: string, feature: string, detail = ''): UnsupportedGObjectError {
    return new UnsupportedGObjectError(
        feature,
        `GObject.registerClass: ${className} uses '${feature}'${detail}, which is outside the GObject subset (ADR 0096 § 2).`,
    );
}

function describeType(type: unknown): string {
    return (type as { name?: unknown } | null | undefined)?.name?.toString() ?? String(type);
}

let anonymousClasses = 0;

function registerWith(door: GObjectDoor, args: readonly unknown[]): ClassLike {
    const given = args.length === 2 ? args[1] : args[0];
    if (typeof given !== 'function') throw new TypeError('GObject.registerClass() needs a class');
    const klass = given as unknown as Klass;
    const className = klass.name || 'anonymous class';

    if (args.length === 2) {
        const meta = args[0] as ClassMeta;
        for (const key of Object.keys(meta)) {
            if (!own(ACCEPTED_META, key)) throw refusal(className, key);
        }
        for (const [key, symbol] of Object.entries(ACCEPTED_META)) {
            if (key in meta) klass[symbol] = meta[key];
        }
    }
    for (const [feature, symbol] of Object.entries(REFUSED_META)) {
        if (own(klass, symbol)) throw refusal(className, feature);
    }
    const unlocked = unlockedVfuncsOf(klass);
    for (const target of [klass as object, klass.prototype]) {
        for (const key of Object.getOwnPropertyNames(target)) {
            if (
                key.startsWith('vfunc_') &&
                typeof Object.getOwnPropertyDescriptor(target, key)?.value === 'function' &&
                !unlocked.has(key)
            ) {
                throw refusal(
                    className,
                    key,
                    ' (a virtual function override that UNLOCKED_VFUNCS does not list, ADR 0098 § 1a)',
                );
            }
        }
    }

    const declared = (symbol: symbol) => (own(klass, symbol) ? klass[symbol] : undefined);

    const rawName = declared(META_SYMBOLS.GTypeName);
    const typeName = String(rawName ?? `Gjs_${klass.name || `anonymous_${++anonymousClasses}`}`).replace(
        /[^a-z0-9+_-]/gi,
        '_',
    );

    const properties = Object.values((declared(META_SYMBOLS.properties) ?? {}) as Record<string, unknown>).map(
        (spec) => {
            if (!(spec instanceof ParamSpec)) {
                throw new TypeError(`GObject.registerClass: ${className} declares a property that is not a ParamSpec`);
            }
            return spec;
        },
    );

    const signals: Record<string, readonly GType[]> = {};
    for (const [name, meta] of Object.entries((declared(META_SYMBOLS.signals) ?? {}) as Record<string, SignalMeta>)) {
        for (const key of Object.keys(meta)) {
            if (key !== 'param_types') throw refusal(className, `Signals.${name}.${key}`);
        }
        const types = meta.param_types ?? [];
        for (const type of types) {
            if (!SIGNAL_PARAM_TYPES.includes(type)) {
                throw refusal(
                    className,
                    `Signals.${name}.param_types`,
                    ` with the type '${describeType(type)}' (only TYPE_STRING, TYPE_BOOLEAN, TYPE_INT, TYPE_UINT and TYPE_DOUBLE)`,
                );
            }
        }
        signals[name] = types;
    }

    const template = declared(META_SYMBOLS.template);
    if (template !== undefined && (typeof template !== 'object' || template === null)) {
        throw new UnsupportedGObjectError(
            'Template',
            `GObject.registerClass: ${className} has a Template that is not a '?template' value; a string, URI or bytes stay GJS-only (ADR 0096 § 4).`,
        );
    }

    const gtype = makeType(typeName);
    const info: RegisteredClass = {
        klass: klass as unknown as ClassLike,
        typeName,
        gtype,
        properties,
        signals,
        template: template as BlueprintTemplate | undefined,
        internalChildren: (declared(META_SYMBOLS.internalChildren) ?? []) as readonly string[],
        cssName: declared(META_SYMBOLS.cssName) as string | undefined,
        door,
    };

    Object.defineProperty(klass, '$gtype', {
        get: () => gtype,
        enumerable: false,
        configurable: false,
    });
    for (const spec of properties) checkAccessors(klass.prototype, spec);
    installInstanceApi(klass.prototype);
    REGISTRY.set(klass, info);
    door.register(info.klass, info);
    return info.klass;
}

/**
 * Registers a core class that is no widget and has no template (`Gio.Application`), so its signals
 * resolve through the registry like a registered class's own. The door is one that names the
 * missing widget model: such a class has no event system to fall through to.
 */
export function registerBaseClass(
    klass: ClassLike,
    typeName: string,
    signals: Readonly<Record<string, readonly GType[]>>,
    properties: readonly ParamSpec[] = [],
): void {
    const missing = (event: string): never => {
        throw new Error(`No signal '${event}' on object '${typeName}'`);
    };
    const gtype = makeType(typeName);
    Object.defineProperty(klass, '$gtype', {
        get: () => gtype,
        enumerable: false,
        configurable: false,
    });
    for (const spec of properties) checkAccessors(klass.prototype, spec);
    REGISTRY.set(klass, {
        klass,
        typeName,
        gtype,
        properties,
        signals,
        internalChildren: [],
        door: {
            name: typeName,
            dispatch: (_target, event) => missing(event),
            listen: (_target, event) => missing(event),
            createFromTree: () => missing('template'),
            attach() {},
            register() {},
        },
    });
}

// --- The base class and the namespace --------------------------------------------------------

export type GObjectConstructor = new (params?: Record<string, unknown>) => GObjectInstance;

/** `GObject.Object` for a registered class with no widget model beneath it. */
export class GObjectObject {
    [key: string]: unknown;

    constructor(params?: Record<string, unknown>) {
        const rest = constructRegistered(this, params);
        const unknownKey = Object.keys(rest)[0];
        if (unknownKey !== undefined) {
            throw new Error(`No property ${unknownKey} on ${typeNameOf(this, chainOfInstance(this))}`);
        }
    }

    notify(name: string): void {
        notifyInstance(this as unknown as GObjectInstance, name);
    }

    connect(signal: string, handler: SignalHandler): number {
        return connectInstance(this as unknown as GObjectInstance, signal, handler);
    }

    disconnect(id: number): void {
        disconnectInstance(this as unknown as GObjectInstance, id);
    }

    emit(signal: string, ...args: unknown[]): void {
        emitInstance(this as unknown as GObjectInstance, signal, ...args);
    }
}

/** A port widget that has no `connect` of its own gets the registry's; one that has keeps it. */
function installInstanceApi(proto: object): void {
    for (const name of ['notify', 'connect', 'disconnect', 'emit'] as const) {
        if (typeof (proto as Record<string, unknown>)[name] === 'function') continue;
        Object.defineProperty(proto, name, {
            value: GObjectObject.prototype[name],
            writable: true,
            configurable: true,
            enumerable: false,
        });
    }
}

export interface GObjectNamespace {
    readonly Object: GObjectConstructor;
    readonly registerClass: RegisterClass;
    readonly ParamSpec: typeof ParamSpec;
    readonly ParamFlags: typeof ParamFlags;
    readonly TYPE_STRING: GType;
    readonly TYPE_BOOLEAN: GType;
    readonly TYPE_INT: GType;
    readonly TYPE_UINT: GType;
    readonly TYPE_DOUBLE: GType;
    readonly GTypeName: symbol;
    readonly GTypeFlags: symbol;
    readonly interfaces: symbol;
    readonly properties: symbol;
    readonly signals: symbol;
    readonly requires: symbol;
    readonly __gtkTemplate__: symbol;
    readonly __gtkCssName__: symbol;
    readonly __gtkChildren__: symbol;
    readonly __gtkInternalChildren__: symbol;
    type_ensure(gtype: GType): void;
    signal_stop_emission_by_name(instance: GObjectInstance, detailedSignal: string): void;
}

/**
 * The `GObject` namespace of a port: `registerClass` registers against `door`. There is no
 * `bind_property` here until a consumer calls it (ADR 0096 § 2); the engine is {@link bindProperties}.
 */
export function createGObject(door: GObjectDoor): GObjectNamespace {
    return {
        Object: GObjectObject as unknown as GObjectConstructor,
        registerClass: ((...args: unknown[]) => registerWith(door, args)) as RegisterClass,
        ParamSpec,
        ParamFlags,
        TYPE_STRING,
        TYPE_BOOLEAN,
        TYPE_INT,
        TYPE_UINT,
        TYPE_DOUBLE,
        GTypeName: META_SYMBOLS.GTypeName,
        GTypeFlags: META_SYMBOLS.GTypeFlags,
        interfaces: META_SYMBOLS.interfaces,
        properties: META_SYMBOLS.properties,
        signals: META_SYMBOLS.signals,
        requires: META_SYMBOLS.requires,
        __gtkTemplate__: META_SYMBOLS.template,
        __gtkCssName__: META_SYMBOLS.cssName,
        __gtkChildren__: META_SYMBOLS.children,
        __gtkInternalChildren__: META_SYMBOLS.internalChildren,
        // `$gtype` is a token; evaluating the class module is all `type_ensure` can prove here.
        type_ensure(gtype) {
            if (!KNOWN_TYPES.has(gtype)) throw new TypeError('GObject.type_ensure: not a GType of this GObject');
        },
        signal_stop_emission_by_name: stopEmissionByName,
    };
}
