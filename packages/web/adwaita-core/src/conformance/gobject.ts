// The GObject subset as observable behaviour — ADR 0096 § 5.
//
// A vector is a program written against the `GObject` namespace of ADR 0096 § 2 and the data it
// must leave behind. The SAME vectors run on three subjects: real `gi://GObject` (+ `Gtk` for the
// template rows), which is the ORACLE, the core with a test door, and each port's door. A vector
// that does not hold on GJS is a wrong vector, never a port bug: fix the vector.
//
// `holds: 'subset'` marks the one kind of vector GJS cannot hold: a REFUSAL. GJS accepts what the
// subset refuses (`Children`, `vfunc_*`, a `param_types` outside the list), so the oracle skips
// those and the subset subjects must throw naming the refused thing.

import type {
    BindingFlag,
    BlueprintTemplate,
    GObjectConstructor,
    GObjectInstance,
    GObjectNamespace,
    GType,
} from '../gobject.js';
import type { ConstructHarness } from './constructs.js';

/** The rows of ADR 0096 § 2 that carry a claim; every one needs a vector. */
export const GOBJECT_ROWS = [
    'registerClass',
    'field-form',
    'ParamSpec',
    'Signals',
    'instance API',
    'type_ensure',
    'vfunc',
    'binding engine',
    'template',
    'interface',
    'object property',
] as const;

export type GObjectRow = (typeof GOBJECT_ROWS)[number];

/** A template, in both spellings: GtkBuilder XML for GJS, the projected tree for a port. */
export interface GObjectTemplateSource {
    readonly className: string;
    readonly tree: BlueprintTemplate;
    readonly xml: string;
}

/** What a driver hands the vectors. */
export interface GObjectSubject {
    readonly name: string;
    /** True for real GJS: refusal vectors are the subset's own and are not run there. */
    readonly isOracle: boolean;
    readonly GObject: GObjectNamespace;
    /** The widget base a templated class extends (`Gtk.Box` on GJS); absent when there is no display. */
    readonly Widget?: GObjectConstructor;
    /** The value to put in `Template`. */
    template(source: GObjectTemplateSource): unknown;
    /**
     * The `Gio.ListModel` token a vector puts in `Implements` — the real interface on an oracle,
     * the core's token on the subset. Absent where no Gio is reachable, which skips those rows.
     */
    readonly ListModel?: unknown;
    /**
     * Something carrying a READ-WRITE object-kind property called `model` whose value type is
     * `Gio.ListModel`, and a value that property accepts.
     *
     * A REAL C object (`Gtk.DropDown` + `Gtk.StringList`) on the oracles, because a JS-registered
     * class is not one for this row: GJS's auto-accessors store without a GValue conversion, so a
     * JS class would accept every value the C property refuses and the refusal vectors would
     * measure nothing. It needs a display, so an oracle offers it only where Gtk initialised.
     */
    objectProperty?(): { readonly instance: GObjectInstance; readonly accepted: GObjectInstance };
    /** The binding engine; `bind_property` on GJS, which is not exported by the ports. */
    bind(
        source: GObjectInstance,
        sourceProperty: string,
        target: GObjectInstance,
        targetProperty: string,
        flags: readonly BindingFlag[],
    ): void;
}

export interface GObjectVector {
    readonly row: GObjectRow;
    readonly rule: string;
    readonly holds: 'oracle' | 'subset';
    readonly widget?: true;
    /** Needs {@link GObjectSubject.ListModel}; skipped where the subject has no Gio. */
    readonly iface?: true;
    /** Needs {@link GObjectSubject.objectProperty}; skipped where the subject cannot build one. */
    readonly objectProperty?: true;
    readonly observe: (subject: GObjectSubject) => unknown;
    readonly shows: unknown;
}

function attempt(fn: () => void): string | null {
    try {
        fn();
        return null;
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
}

function count(instance: GObjectInstance, signal: string): { n: number } {
    const counter = { n: 0 };
    instance.connect(signal, () => {
        counter.n++;
    });
    return counter;
}

function boxTemplate(className: string, handler = 'onClicked'): GObjectTemplateSource {
    return {
        className,
        tree: {
            tag: 'GtkBox',
            children: [
                {
                    tag: 'GtkSwitch',
                    id: 'sw',
                    bindings: { active: { source: 'template', property: 'enabled', flags: ['bidirectional'] } },
                },
                { tag: 'GtkButton', id: 'btn', signals: [{ name: 'clicked', handler }] },
            ],
        },
        xml:
            `<interface><template class="${className}" parent="GtkBox">` +
            `<child><object class="GtkSwitch" id="sw"><property name="active" bind-source="${className}" ` +
            `bind-property="enabled" bind-flags="bidirectional|sync-create"/></object></child>` +
            `<child><object class="GtkButton" id="btn"><signal name="clicked" handler="${handler}"/></object></child>` +
            `</template></interface>`,
    };
}

/**
 * The one shape every interface vector registers: a `Gio.ListModel` implementor of three items,
 * written with the vfunc names GJS wants (`vfunc_` + the C method). Each vector needs its OWN
 * `GTypeName` because a GType name may be registered once per process, hence the `name` argument.
 */
function listModelClass(subject: GObjectSubject, name: string): GObjectConstructor {
    const { GObject: G } = subject;
    return G.registerClass(
        { GTypeName: name, Implements: [subject.ListModel] },
        class extends G.Object {
            vfunc_get_item_type(): unknown {
                return G.TYPE_OBJECT;
            }
            vfunc_get_n_items(): number {
                return 3;
            }
            // An item is a GObject, not a string: `get_item` marshals its return through a
            // `GObject*`, so a JS string comes back as `null` on GJS. The implementor hands back
            // ITSELF, which is the one GObject every subject has to hand.
            vfunc_get_item(position: number): unknown {
                return position < 3 ? this : null;
            }
        },
    ) as GObjectConstructor;
}

/** Reads the object-kind `model` property of {@link GObjectSubject.objectProperty}'s instance. */
function read(instance: GObjectInstance): unknown {
    return (instance as unknown as Record<string, unknown>)['model'] ?? null;
}

/** Writes it. Separate from {@link read} so the refusal vectors can wrap one in {@link attempt}. */
function write(instance: GObjectInstance, value: unknown): void {
    (instance as unknown as Record<string, unknown>)['model'] = value;
}

export const GOBJECT_VECTORS: readonly GObjectVector[] = [
    {
        row: 'ParamSpec',
        rule: 'a generated accessor notifies once per change and not on an equal value (_generateAccessors)',
        holds: 'oracle',
        observe(s) {
            const { GObject: G } = s;
            const { ParamSpec: P, ParamFlags: F } = G;
            const K = G.registerClass(
                { GTypeName: 'GoVecNotify', Properties: { code: P.string('code', '', '', F.READWRITE, '') } },
                class extends G.Object {},
            );
            const o = new K();
            const notified = count(o, 'notify::code');
            const seen: number[] = [];
            o.code = 'x';
            seen.push(notified.n);
            o.code = 'x';
            seen.push(notified.n);
            o.code = 'y';
            seen.push(notified.n);
            return seen;
        },
        shows: [1, 1, 2],
    },
    {
        row: 'ParamSpec',
        rule: 'a property reads as its ParamSpec default until it is set, for all five kinds',
        holds: 'oracle',
        observe(s) {
            const { GObject: G } = s;
            const { ParamSpec: P, ParamFlags: F } = G;
            const K = G.registerClass(
                {
                    GTypeName: 'GoVecDefaults',
                    Properties: {
                        s: P.string('s', '', '', F.READWRITE, ''),
                        b: P.boolean('b', '', '', F.READWRITE, true),
                        n: P.int('n', '', '', F.READWRITE, 0, 10, 3),
                        d: P.double('d', '', '', F.READWRITE, 0, 1, 0.5),
                        u: P.uint('u', '', '', F.READWRITE, 0, 10, 2),
                    },
                },
                class extends G.Object {},
            );
            const o = new K();
            return { s: o.s, b: o.b, n: o.n, d: o.d, u: o.u };
        },
        shows: { s: '', b: true, n: 3, d: 0.5, u: 2 },
    },
    {
        row: 'ParamSpec',
        rule: 'an accessor the class defines is kept: its setter runs per assignment and decides when to notify',
        holds: 'oracle',
        observe(s) {
            const { GObject: G } = s;
            const { ParamSpec: P, ParamFlags: F } = G;
            let setterCalls = 0;
            const K = G.registerClass(
                { GTypeName: 'GoVecOwnAccessor', Properties: { label: P.string('label', '', '', F.READWRITE, '') } },
                class extends G.Object {
                    stored = 'initial';
                    get label(): string {
                        return this.stored;
                    }
                    set label(value: string) {
                        setterCalls++;
                        this.stored = value;
                        this.notify('label');
                    }
                },
            );
            const o = new K();
            const notified = count(o, 'notify::label');
            o.label = 'a';
            o.label = 'a';
            return { setterCalls, notifies: notified.n, value: o.label };
        },
        shows: { setterCalls: 2, notifies: 2, value: 'a' },
    },
    {
        row: 'ParamSpec',
        rule: 'a dashed name is reachable as dash-name, dash_name and dashName, and one notify::dash-name serves all three',
        holds: 'oracle',
        observe(s) {
            const { GObject: G } = s;
            const { ParamSpec: P, ParamFlags: F } = G;
            const K = G.registerClass(
                {
                    GTypeName: 'GoVecAliases',
                    Properties: { 'dash-name': P.string('dash-name', '', '', F.READWRITE, 'd') },
                },
                class extends G.Object {},
            );
            const o = new K();
            const read = [o['dash-name'], o.dash_name, o.dashName];
            const notified = count(o, 'notify::dash-name');
            o.dashName = 'q';
            o.dash_name = 'q';
            return { read, notifies: notified.n, value: o['dash-name'] };
        },
        shows: { read: ['d', 'd', 'd'], notifies: 1, value: 'q' },
    },
    {
        row: 'ParamSpec',
        rule: 'a CONSTRUCT_ONLY property gets no accessor on the class and keeps the value it was built with',
        holds: 'oracle',
        observe(s) {
            const { GObject: G } = s;
            const { ParamSpec: P, ParamFlags: F } = G;
            const K = G.registerClass(
                {
                    GTypeName: 'GoVecConstructOnly',
                    Properties: {
                        co: P.int('co', '', '', F.READWRITE | F.CONSTRUCT_ONLY, 0, 10, 3),
                    },
                },
                class extends G.Object {},
            );
            return {
                given: new K({ co: 7 }).co,
                dflt: new K().co,
                onPrototype: Object.getOwnPropertyDescriptor(K.prototype, 'co') !== undefined,
            };
        },
        shows: { given: 7, dflt: 3, onPrototype: false },
    },
    {
        row: 'ParamSpec',
        rule: 'a CONSTRUCT property runs its own setter once at construction: with the default, or the given value',
        holds: 'oracle',
        observe(s) {
            const { GObject: G } = s;
            const { ParamSpec: P, ParamFlags: F } = G;
            const calls: number[] = [];
            const K = G.registerClass(
                {
                    GTypeName: 'GoVecConstructSetter',
                    Properties: { size: P.int('size', '', '', F.READWRITE | F.CONSTRUCT, 0, 100, 32) },
                },
                // No field declaration: an initializer would run after `super()` and wipe the value.
                class extends G.Object {
                    get size(): number {
                        return this._size as number;
                    }
                    set size(value: number) {
                        calls.push(value);
                        this._size = value;
                        this.notify('size');
                    }
                },
            );
            const dflt = new K();
            const dfltCalls = calls.splice(0);
            const given = new K({ size: 5 });
            return { dfltCalls, givenCalls: calls, read: [dflt.size, given.size] };
        },
        shows: { dfltCalls: [32], givenCalls: [5], read: [32, 5] },
    },
    {
        row: 'ParamSpec',
        rule: 'construction sets a CONSTRUCT property, so writing its default afterwards is no change and notifies nothing',
        holds: 'oracle',
        observe(s) {
            const { GObject: G } = s;
            const { ParamSpec: P, ParamFlags: F } = G;
            const K = G.registerClass(
                {
                    GTypeName: 'GoVecConstructDefault',
                    Properties: {
                        c: P.int('c', '', '', F.READWRITE | F.CONSTRUCT, 0, 10, 7),
                        p: P.int('p', '', '', F.READWRITE, 0, 10, 4),
                    },
                },
                class extends G.Object {},
            );
            const o = new K();
            const notified: string[] = [];
            o.connect('notify::c', () => notified.push('c'));
            o.connect('notify::p', () => notified.push('p'));
            o.c = 7;
            o.p = 4;
            return { read: [o.c, new K({ c: 3 }).c], notified };
        },
        shows: { read: [7, 3], notified: ['p'] },
    },
    {
        row: 'Signals',
        rule: 'emit reaches a handler as (emitter, ...params); disconnect stops it; an undeclared name or wrong arity throws',
        holds: 'oracle',
        observe(s) {
            const { GObject: G } = s;
            const K = G.registerClass(
                { GTypeName: 'GoVecSignals', Signals: { changed: { param_types: [G.TYPE_STRING, G.TYPE_INT] } } },
                class extends G.Object {},
            );
            const o = new K();
            let got: unknown[] = [];
            let calls = 0;
            const id = o.connect('changed', (...args: unknown[]) => {
                calls++;
                got = args;
            });
            o.emit('changed', 's', 3);
            const first = { argc: got.length, emitter: got[0] === o, s: got[1], n: got[2] };
            o.disconnect(id);
            o.emit('changed', 't', 4);
            return {
                ...first,
                callsAfterDisconnect: calls,
                undeclaredThrows: attempt(() => o.emit('nope')) !== null,
                shortThrows: attempt(() => o.emit('changed', 's')) !== null,
            };
        },
        shows: {
            argc: 3,
            emitter: true,
            s: 's',
            n: 3,
            callsAfterDisconnect: 1,
            undeclaredThrows: true,
            shortThrows: true,
        },
    },
    {
        row: 'instance API',
        rule: 'signal_stop_emission_by_name stops the emission in progress: later handlers do not run, the next emission runs all',
        holds: 'oracle',
        observe(s) {
            const { GObject: G } = s;
            const { ParamSpec: P, ParamFlags: F } = G;
            const K = G.registerClass(
                {
                    GTypeName: 'GoVecStopEmission',
                    Properties: { code: P.string('code', '', '', F.READWRITE, '') },
                    Signals: { ping: { param_types: [] } },
                },
                class extends G.Object {},
            );
            const o = new K();
            const seen: string[] = [];
            let stop = true;
            o.connect('ping', () => {
                seen.push('a');
                if (stop) G.signal_stop_emission_by_name(o, 'ping');
            });
            o.connect('ping', () => seen.push('b'));
            o.emit('ping');
            const stopped = seen.join('');
            seen.length = 0;
            stop = false;
            o.emit('ping');
            const next = seen.join('');
            const notified: string[] = [];
            o.connect('notify::code', () => {
                notified.push('a');
                G.signal_stop_emission_by_name(o, 'notify::code');
            });
            o.connect('notify::code', () => notified.push('b'));
            o.code = 'x';
            return { stopped, next, notified: notified.join('') };
        },
        shows: { stopped: 'a', next: 'ab', notified: 'a' },
    },
    {
        row: 'instance API',
        rule: 'signal_stop_emission_by_name stops only the innermost emission of ITS signal; with none in progress it does nothing and leaves nothing behind',
        holds: 'oracle',
        observe(s) {
            const { GObject: G } = s;
            const K = G.registerClass(
                { GTypeName: 'GoVecStopNested', Signals: { ping: { param_types: [] }, pong: { param_types: [] } } },
                class extends G.Object {},
            );
            const o = new K();
            const idle = attempt(() => G.signal_stop_emission_by_name(o, 'ping'));
            const seen: string[] = [];
            let depth = 0;
            o.connect('ping', () => {
                seen.push(`a${depth}`);
                if (depth === 0) {
                    depth = 1;
                    o.emit('ping');
                    depth = 0;
                } else {
                    G.signal_stop_emission_by_name(o, 'ping');
                }
            });
            o.connect('ping', () => seen.push(`b${depth}`));
            o.emit('ping');
            const nested = seen.join(',');
            seen.length = 0;
            o.connect('pong', () => {
                seen.push('p');
                G.signal_stop_emission_by_name(o, 'ping');
            });
            o.connect('pong', () => seen.push('q'));
            o.emit('pong');
            return { idleThrows: idle !== null, nested, otherSignal: seen.join('') };
        },
        shows: { idleThrows: false, nested: 'a0,a1,b0', otherSignal: 'pq' },
    },
    {
        row: 'field-form',
        rule: 'meta given as static symbol fields registers like the meta object (GJS only copies the object onto them)',
        holds: 'oracle',
        observe(s) {
            const { GObject: G } = s;
            const { ParamSpec: P, ParamFlags: F } = G;
            class Field extends G.Object {}
            Object.assign(Field, {
                [G.GTypeName]: 'GoVecFieldForm',
                [G.properties]: { code: P.string('code', '', '', F.READWRITE, '') },
                [G.signals]: { ping: { param_types: [] } },
            });
            const K = G.registerClass(Field);
            const o = new K();
            const notified = count(o, 'notify::code');
            const pings = count(o, 'ping');
            o.code = 'x';
            o.emit('ping');
            return {
                typeName: (K as unknown as { $gtype: GType }).$gtype.name,
                notifies: notified.n,
                pings: pings.n,
            };
        },
        shows: { typeName: 'GoVecFieldForm', notifies: 1, pings: 1 },
    },
    {
        row: 'type_ensure',
        rule: '$gtype is a token and type_ensure accepts it',
        holds: 'oracle',
        observe(s) {
            const { GObject: G } = s;
            const K = G.registerClass({ GTypeName: 'GoVecToken' }, class extends G.Object {});
            const gtype = (K as unknown as { $gtype: GType }).$gtype;
            return { hasGtype: gtype !== undefined, ensured: attempt(() => G.type_ensure(gtype)) === null };
        },
        shows: { hasGtype: true, ensured: true },
    },
    {
        row: 'binding engine',
        rule: 'SYNC_CREATE transfers once at bind time; without it the target keeps its own value',
        holds: 'oracle',
        observe(s) {
            const { GObject: G } = s;
            const { ParamSpec: P, ParamFlags: F } = G;
            const K = G.registerClass(
                { GTypeName: 'GoVecBindSync', Properties: { on: P.boolean('on', '', '', F.READWRITE, false) } },
                class extends G.Object {},
            );
            const [a, b, c, d] = [new K(), new K(), new K(), new K()];
            a.on = true;
            c.on = true;
            s.bind(a, 'on', b, 'on', ['sync-create']);
            s.bind(c, 'on', d, 'on', []);
            return { withSync: b.on, withoutSync: d.on };
        },
        shows: { withSync: true, withoutSync: false },
    },
    {
        row: 'binding engine',
        rule: 'the target follows every change of the source',
        holds: 'oracle',
        observe(s) {
            const { GObject: G } = s;
            const { ParamSpec: P, ParamFlags: F } = G;
            const K = G.registerClass(
                { GTypeName: 'GoVecBindFollow', Properties: { on: P.boolean('on', '', '', F.READWRITE, false) } },
                class extends G.Object {},
            );
            const [source, target] = [new K(), new K()];
            s.bind(source, 'on', target, 'on', ['sync-create']);
            source.on = true;
            const afterOn = target.on;
            source.on = false;
            return { afterOn, afterOff: target.on };
        },
        shows: { afterOn: true, afterOff: false },
    },
    {
        row: 'binding engine',
        rule: 'BIDIRECTIONAL makes the source follow the target back, without echoing',
        holds: 'oracle',
        observe(s) {
            const { GObject: G } = s;
            const { ParamSpec: P, ParamFlags: F } = G;
            const K = G.registerClass(
                { GTypeName: 'GoVecBindBoth', Properties: { on: P.boolean('on', '', '', F.READWRITE, false) } },
                class extends G.Object {},
            );
            const [source, target] = [new K(), new K()];
            s.bind(source, 'on', target, 'on', ['bidirectional', 'sync-create']);
            target.on = true;
            const back = source.on;
            source.on = false;
            return { back, forward: target.on };
        },
        shows: { back: true, forward: false },
    },
    {
        row: 'binding engine',
        rule: 'INVERT_BOOLEAN negates what crosses, at creation and after',
        holds: 'oracle',
        observe(s) {
            const { GObject: G } = s;
            const { ParamSpec: P, ParamFlags: F } = G;
            const K = G.registerClass(
                {
                    GTypeName: 'GoVecBindInvert',
                    Properties: {
                        on: P.boolean('on', '', '', F.READWRITE, false),
                        off: P.boolean('off', '', '', F.READWRITE, true),
                    },
                },
                class extends G.Object {},
            );
            const [source, target] = [new K(), new K()];
            source.on = true;
            s.bind(source, 'on', target, 'off', ['sync-create', 'invert-boolean']);
            const created = target.off;
            source.on = false;
            return { created, after: target.off };
        },
        shows: { created: false, after: true },
    },
    {
        row: 'template',
        rule: 'construction order: the template is built, construct properties are set (this._x is undefined inside a setter), then this._x is installed',
        holds: 'oracle',
        widget: true,
        observe(s) {
            const { GObject: G } = s;
            const { ParamSpec: P, ParamFlags: F } = G;
            const log: string[] = [];
            const K = G.registerClass(
                {
                    GTypeName: 'GoVecOrder',
                    Template: s.template(boxTemplate('GoVecOrder')),
                    InternalChildren: ['sw', 'btn'],
                    Properties: {
                        code: P.string('code', '', '', F.READWRITE, ''),
                        enabled: P.boolean('enabled', '', '', F.READWRITE, false),
                    },
                },
                class extends (s.Widget as GObjectConstructor) {
                    declare stored: string;
                    get code(): string {
                        return this.stored;
                    }
                    set code(value: string) {
                        log.push(`setter:${typeof this._sw}`);
                        this.stored = value;
                    }
                    onClicked(): void {}
                    constructor(params?: Record<string, unknown>) {
                        super(params);
                        log.push(`after super:${typeof this._sw}`);
                    }
                },
            );
            const o = new K({ code: 'k' });
            return { log, code: o.code, child: typeof o._btn };
        },
        shows: { log: ['setter:undefined', 'after super:object'], code: 'k', child: 'object' },
    },
    {
        row: 'template',
        rule: 'a `bind template.x bidirectional` follows both ways between the template instance and its child',
        holds: 'oracle',
        widget: true,
        observe(s) {
            const { GObject: G } = s;
            const { ParamSpec: P, ParamFlags: F } = G;
            const K = G.registerClass(
                {
                    GTypeName: 'GoVecTemplateBind',
                    Template: s.template(boxTemplate('GoVecTemplateBind')),
                    InternalChildren: ['sw', 'btn'],
                    Properties: { enabled: P.boolean('enabled', '', '', F.READWRITE, false) },
                },
                class extends (s.Widget as GObjectConstructor) {
                    onClicked(): void {}
                },
            );
            const o = new K();
            const initial = (o._sw as GObjectInstance).active;
            o.enabled = true;
            const toChild = (o._sw as GObjectInstance).active;
            (o._sw as GObjectInstance).active = false;
            return { initial, toChild, back: o.enabled };
        },
        shows: { initial: false, toChild: true, back: false },
    },
    {
        row: 'template',
        rule: 'a handler on the template instance runs bound to that instance and receives the emitter',
        holds: 'oracle',
        widget: true,
        observe(s) {
            const { GObject: G } = s;
            const { ParamSpec: P, ParamFlags: F } = G;
            const calls: boolean[][] = [];
            let host: unknown;
            const K = G.registerClass(
                {
                    GTypeName: 'GoVecHandler',
                    Template: s.template(boxTemplate('GoVecHandler')),
                    InternalChildren: ['sw', 'btn'],
                    Properties: { enabled: P.boolean('enabled', '', '', F.READWRITE, false) },
                },
                class extends (s.Widget as GObjectConstructor) {
                    onClicked(button: unknown): void {
                        calls.push([this === host, button === this._btn]);
                    }
                },
            );
            const o = new K();
            host = o;
            (o._btn as GObjectInstance).emit('clicked');
            return calls;
        },
        shows: [[true, true]],
    },
    {
        row: 'template',
        rule: 'a handler the instance does not have throws `A handler called <name> was not defined` (GJS logs it as a Gtk-CRITICAL instead)',
        holds: 'subset',
        widget: true,
        observe(s) {
            const { GObject: G } = s;
            const { ParamSpec: P, ParamFlags: F } = G;
            const K = G.registerClass(
                {
                    GTypeName: 'GoVecNoHandler',
                    Template: s.template(boxTemplate('GoVecNoHandler', 'nope')),
                    InternalChildren: ['sw', 'btn'],
                    Properties: { enabled: P.boolean('enabled', '', '', F.READWRITE, false) },
                },
                class extends (s.Widget as GObjectConstructor) {},
            );
            return (attempt(() => new K()) ?? '').includes('A handler called nope was not defined');
        },
        shows: true,
    },
    // `Implements` LEFT this list in ADR 0122: it is now accepted as a key and judged by its
    // entries, which is the `interface` row below. The other three stay refused outright.
    ...(['Children', 'Requires', 'GTypeFlags'] as const).map(
        (key): GObjectVector => ({
            row: 'registerClass',
            rule: `the meta key ${key} is refused at registration, by name`,
            holds: 'subset',
            observe(s) {
                const { GObject: G } = s;
                const message = attempt(() =>
                    G.registerClass({ GTypeName: `GoVecRefuse${key}`, [key]: [] }, class extends G.Object {}),
                );
                return (message ?? '').includes(key);
            },
            shows: true,
        }),
    ),
    {
        row: 'vfunc',
        rule: 'a vfunc_* method is refused at registration, naming the method',
        holds: 'subset',
        observe(s) {
            const { GObject: G } = s;
            const message = attempt(() =>
                G.registerClass(
                    { GTypeName: 'GoVecVfunc' },
                    class extends G.Object {
                        vfunc_constructed(): void {}
                    },
                ),
            );
            return (message ?? '').includes('vfunc_constructed');
        },
        shows: true,
    },
    {
        row: 'Signals',
        rule: 'a param type outside STRING, BOOLEAN, INT, UINT and DOUBLE is refused at registration, naming the signal',
        holds: 'subset',
        observe(s) {
            const { GObject: G } = s;
            const outside = { name: 'gint64' } as unknown as GType;
            const message = attempt(() =>
                G.registerClass(
                    { GTypeName: 'GoVecWideSignal', Signals: { wide: { param_types: [outside] } } },
                    class extends G.Object {},
                ),
            );
            return (message ?? '').includes('Signals.wide.param_types');
        },
        shows: true,
    },

    // --- interface (ADR 0122 § 2) -------------------------------------------------------------
    //
    // `Gio.ListModel` is the WHOLE of the subset's interface support, so these rows describe one
    // interface rather than a mechanism. Everything but the last one holds on real GJS, which is
    // the point: the subset's `Implements` had to be measured against the real thing before a
    // `Gtk.StringList` could claim to be a model.
    {
        row: 'interface',
        rule: 'Implements installs the interface methods and the emitter on the prototype',
        holds: 'oracle',
        iface: true,
        observe(s) {
            const o = new (listModelClass(s, 'GoVecIfaceInstall'))() as unknown as Record<string, unknown>;
            return ['get_item', 'get_n_items', 'get_item_type', 'items_changed'].map((name) => typeof o[name]);
        },
        shows: ['function', 'function', 'function', 'function'],
    },
    {
        row: 'interface',
        rule: 'an implementor passes instanceof the interface, and a class without it does not',
        holds: 'oracle',
        iface: true,
        observe(s) {
            const { GObject: G } = s;
            const Plain = G.registerClass({ GTypeName: 'GoVecIfacePlain' }, class extends G.Object {});
            const iface = s.ListModel as unknown as abstract new () => object;
            return [new (listModelClass(s, 'GoVecIfaceInstanceof'))() instanceof iface, new Plain() instanceof iface];
        },
        shows: [true, false],
    },
    {
        row: 'interface',
        rule: 'the installed methods call through to the class’s own vfunc_*',
        holds: 'oracle',
        iface: true,
        observe(s) {
            const o = new (listModelClass(s, 'GoVecIfaceRoute'))() as unknown as {
                get_n_items(): number;
                get_item(position: number): unknown;
            };
            return [o.get_n_items(), o.get_item(0) === o, o.get_item(9)];
        },
        shows: [3, true, null],
    },
    {
        row: 'interface',
        rule: 'the interface’s PROPERTIES are NOT installed — a JS implementor has no n_items',
        holds: 'oracle',
        iface: true,
        observe(s) {
            const o = new (listModelClass(s, 'GoVecIfaceNoProps'))() as unknown as Record<string, unknown>;
            return [o['n_items'], o['item_type']];
        },
        shows: [undefined, undefined],
    },
    {
        row: 'interface',
        rule: 'an implementor is not iterable — a list model is read by position, not by spread',
        holds: 'oracle',
        iface: true,
        observe(s) {
            const o = new (listModelClass(s, 'GoVecIfaceSpread'))();
            return attempt(() => void [...(o as unknown as Iterable<unknown>)]) !== null;
        },
        shows: true,
    },
    {
        row: 'interface',
        rule: 'items_changed emits the interface’s signal, which an implementor can connect to',
        holds: 'oracle',
        iface: true,
        observe(s) {
            const o = new (listModelClass(s, 'GoVecIfaceEmit'))() as unknown as GObjectInstance & {
                items_changed(position: number, removed: number, added: number): void;
            };
            const seen: unknown[][] = [];
            o.connect('items-changed', (_source: unknown, ...args: unknown[]) => void seen.push(args));
            o.items_changed(1, 2, 3);
            return seen;
        },
        shows: [[1, 2, 3]],
    },
    {
        row: 'interface',
        rule: 'a short items_changed call names the interface method and the arity it wanted',
        holds: 'oracle',
        iface: true,
        observe(s) {
            const o = new (listModelClass(s, 'GoVecIfaceArity'))() as unknown as Record<string, unknown>;
            const message = attempt(() => (o['items_changed'] as (...args: number[]) => void)(0, 0));
            return (message ?? '').includes(
                'method Gio.ListModel.items_changed: At least 3 arguments required, but only 2 passed',
            );
        },
        shows: true,
    },
    {
        // The one interface row GJS does NOT hold, and the reason it cannot: measured on GJS
        // 1.88.01 / GTK 4.22.5, this class REGISTERS, and the first `get_n_items()` call
        // segfaults the process through the null vtable slot. A crash is not behaviour to copy,
        // so the subset refuses at registration — see `requireInterfaceVfuncs`.
        row: 'interface',
        rule: 'an implementor that does not define every vfunc is refused, naming it and the interface',
        holds: 'subset',
        iface: true,
        observe(s) {
            const { GObject: G } = s;
            const message = attempt(() =>
                G.registerClass(
                    { GTypeName: 'GoVecIfaceNoVfunc', Implements: [s.ListModel] },
                    class extends G.Object {
                        vfunc_get_item_type(): unknown {
                            return G.TYPE_OBJECT;
                        }
                        vfunc_get_item(): unknown {
                            return null;
                        }
                    },
                ),
            );
            return [(message ?? '').includes('vfunc_get_n_items'), (message ?? '').includes('Gio.ListModel')];
        },
        shows: [true, true],
    },
    {
        row: 'interface',
        rule: 'an interface outside the subset is refused at registration, by name',
        holds: 'subset',
        observe(s) {
            const { GObject: G } = s;
            const outside = { name: 'Gtk.Buildable' };
            const message = attempt(() =>
                G.registerClass({ GTypeName: 'GoVecIfaceOutside', Implements: [outside] }, class extends G.Object {}),
            );
            return [(message ?? '').includes('Gtk.Buildable'), (message ?? '').includes('Gio.ListModel')];
        },
        shows: [true, true],
    },
    {
        row: 'interface',
        rule: 'an Implements that is not an array is refused, naming the key',
        holds: 'subset',
        observe(s) {
            const { GObject: G } = s;
            const message = attempt(() =>
                G.registerClass(
                    { GTypeName: 'GoVecIfaceNotArray', Implements: 'Gio.ListModel' as unknown as unknown[] },
                    class extends G.Object {},
                ),
            );
            return (message ?? '').includes('Implements');
        },
        shows: true,
    },

    // --- object property (ADR 0122 § 6) -------------------------------------------------------
    //
    // What `Adw.ComboRow:model` does with a value, measured on the C property that already does
    // it — `Gtk.DropDown:model`. These are the rows that say a plain array is a TypeError rather
    // than a second shape the setter branches on, so the messages are quoted exactly, minus the
    // pointer GJS prints and nothing can match.
    {
        row: 'object property',
        rule: 'the default is null, which is the only default g_param_spec_object has',
        holds: 'oracle',
        objectProperty: true,
        observe(s) {
            return read(s.objectProperty!().instance);
        },
        shows: null,
    },
    {
        row: 'object property',
        rule: 'a model is stored and notified once; writing the SAME one again notifies nothing',
        holds: 'oracle',
        objectProperty: true,
        observe(s) {
            const { instance, accepted } = s.objectProperty!();
            const notifies = count(instance, 'notify::model');
            write(instance, accepted);
            const first = notifies.n;
            write(instance, accepted);
            return [first, notifies.n, read(instance) === accepted];
        },
        shows: [1, 1, true],
    },
    {
        row: 'object property',
        rule: 'null clears it and notifies, because null is a value the property takes',
        holds: 'oracle',
        objectProperty: true,
        observe(s) {
            const { instance, accepted } = s.objectProperty!();
            write(instance, accepted);
            const notifies = count(instance, 'notify::model');
            write(instance, null);
            return [notifies.n, read(instance)];
        },
        shows: [1, null],
    },
    ...(
        [
            ['an array', ['Blue', 'Teal'], "is not a subclass of GObject_Object, it's a Array"],
            ['a plain object', {}, "is not a subclass of GObject_Object, it's a Object"],
            ['a function', () => undefined, "is not a subclass of GObject_Object, it's a Function"],
            ['a string', 'abc', 'Wrong type string; object GListModel expected'],
            ['a number', 7, 'Wrong type number; object GListModel expected'],
            ['a boolean', true, 'Wrong type boolean; object GListModel expected'],
            ['undefined', undefined, 'Wrong type undefined; object GListModel expected'],
        ] as const
    ).map(
        ([what, value, says]): GObjectVector => ({
            row: 'object property',
            rule: `${what} is refused, and the value stays what it was`,
            holds: 'oracle',
            objectProperty: true,
            observe(s) {
                const { instance, accepted } = s.objectProperty!();
                write(instance, accepted);
                const message = attempt(() => write(instance, value));
                return [(message ?? '').includes(says), read(instance) === accepted];
            },
            shows: [true, true],
        }),
    ),
    {
        row: 'object property',
        rule: 'a GObject that is not a list model is refused by the interface it does not implement',
        holds: 'oracle',
        objectProperty: true,
        observe(s) {
            const { GObject: G } = s;
            const Plain = G.registerClass({ GTypeName: 'GoVecObjPlain' }, class extends G.Object {});
            const { instance } = s.objectProperty!();
            const message = attempt(() => write(instance, new Plain()));
            return [
                (message ?? '').startsWith('Object is of type '),
                (message ?? '').includes('cannot convert to GListModel'),
            ];
        },
        shows: [true, true],
    },
];

/** Holds a subject to the vectors. Widget vectors need `subject.Widget`; the caller reports their absence. */
export async function driveGObjectVectors(
    subject: GObjectSubject,
    harness: ConstructHarness,
    vectors: readonly GObjectVector[] = GOBJECT_VECTORS,
): Promise<void> {
    const { describe, it, expect } = harness;
    await describe(`${subject.name}: GObject subset (ADR 0096)`, async () => {
        for (const vector of vectors) {
            if (vector.holds === 'subset' && subject.isOracle) continue;
            if (vector.widget && subject.Widget === undefined) continue;
            if (vector.iface && subject.ListModel === undefined) continue;
            if (vector.objectProperty && subject.objectProperty === undefined) continue;
            await it(`${vector.row}: ${vector.rule}`, () => {
                expect(JSON.stringify(vector.observe(subject))).toBe(JSON.stringify(vector.shows));
            });
        }
    });
}
