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
    ...(['Children', 'Implements', 'Requires', 'GTypeFlags'] as const).map(
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
            await it(`${vector.row}: ${vector.rule}`, () => {
                expect(JSON.stringify(vector.observe(subject))).toBe(JSON.stringify(vector.shows));
            });
        }
    });
}
