// The DECLARED half of the seam — `withSignals(Base, meta)` (ADR 0105 § 2, route D), both legs.
//
// The seam builds a widget's properties one of two ways and promises the same consumer API from
// either: on Android with the real engine they belong to a GType registered over the
// `@nativescript/core` base, everywhere else they are the seam's own accessors over a JS store.
// This file holds both against the SAME vectors, because "the same API" is a claim only a shared
// assertion can carry — a pure-JS test and a device test that were written separately agree only
// by coincidence.
//
// THE REAL LEG IS DRIVEN BY A STUB ENGINE, and the stub is written to node-gi's observed
// behaviour rather than to what would be convenient: it installs `connect` / `disconnect` /
// `emit` / `notify` and the property accessors as OWN members of `klass.prototype`, it SKIPS any
// name the prototype chain already answers and records the skip in a frozen `$foreignSkipped`,
// and it roots `$gtype` on the class. Those four are exactly what the seam's `registerRouteD`
// depends on, which is why they are what gets imitated. What the stub cannot prove is that node-gi
// really does that — `tests/integration/nativescript-gi` is where the same vectors run against the
// real engine on a real device, and this file is what makes a device failure a narrow one.
//
// `resetRegisteredEngine()` before every test, and a FRESH class in every test: the seam realizes
// once per `withSignals(...)` call, so a class built under one engine would answer for the next
// test too and the suite would depend on its order.

import { describe, expect, it } from '@gjsify/unit';
import { PURE_JS_ENGINE, registerGObjectEngine, resetRegisteredEngine } from '@gjsify/adwaita-core';
import type { ClassLike, ForeignClassMeta, GObjectEngine } from '@gjsify/adwaita-core';
import type { Observable } from '@nativescript/core';

import { withSignals } from './widgets/signals.js';
import type { DeclaredClassMeta } from './widgets/signals.js';
import type { GObjectNotify } from './widgets/signals.js';
import { ObservableShape } from './signals.spec.js';

/** The meta both legs are measured against — one string property, and one signal with arguments. */
const META: ForeignClassMeta = {
    GTypeName: 'SpecWindowTitle',
    Properties: {
        title: { kind: 'string', default: '', blurb: 'The title to display' },
        'can-close': { kind: 'boolean', default: false },
    },
    Signals: { closed: { param_types: ['string'] } },
};

/** The platform boundary, as `signals.spec.ts` declares it, typed the way the mixin wants it. */
const Base = ObservableShape as unknown as new () => Observable & ObservableShape;

/** What the stub engine recorded, so a test can assert on the registration itself. */
interface Registration {
    klass: ClassLike;
    meta: ForeignClassMeta;
    skipped: string[];
}

/**
 * A `GObjectEngine` that registers over a foreign parent the way node-gi does.
 *
 * `install` is a hook rather than a constant so a test can take one thing away — the failure
 * vector is an engine whose registration installs NO `connect`, which is the one shape ADR 0105
 * refuses to let fall back.
 */
function stubEngine(
    registrations: Registration[],
    install: (prototype: Record<string, unknown>, meta: ForeignClassMeta) => string[] = installForeignSurface,
): GObjectEngine {
    return {
        ...PURE_JS_ENGINE,
        name: 'stub-foreign',
        supportsForeignParentClasses: true,
        registerForeignClass(klass: ClassLike, meta: ForeignClassMeta): void {
            const prototype = (klass as unknown as { prototype: Record<string, unknown> }).prototype;
            const skipped = install(prototype, meta);
            Object.defineProperty(klass, '$gtype', { value: Symbol(meta.GTypeName) });
            Object.defineProperty(klass, '$gtypeName', { value: meta.GTypeName });
            Object.defineProperty(klass, '$foreignSkipped', { value: Object.freeze(skipped) });
            registrations.push({ klass, meta, skipped });
        },
    };
}

const REAL_HANDLERS = new WeakMap<object, Map<number, { key: string; handler: (...args: unknown[]) => unknown }>>();
const REAL_VALUES = new WeakMap<object, Map<string, unknown>>();
let nextRealId = 1;

function handlersOf(instance: object): Map<number, { key: string; handler: (...args: unknown[]) => unknown }> {
    let found = REAL_HANDLERS.get(instance);
    if (found === undefined) REAL_HANDLERS.set(instance, (found = new Map()));
    return found;
}

function valuesOf(instance: object): Map<string, unknown> {
    let found = REAL_VALUES.get(instance);
    if (found === undefined) REAL_VALUES.set(instance, (found = new Map()));
    return found;
}

/**
 * What node-gi installs on a foreign-parent class, imitated.
 *
 * `define` skips a name the chain already answers — the behaviour `registerRouteD` deletes the
 * mixin's four methods FOR, and the one that puts `get_property` / `set_property` in
 * `$foreignSkipped` rather than replacing this port's one-argument door with the introspected
 * two-argument form.
 */
function installForeignSurface(prototype: Record<string, unknown>, meta: ForeignClassMeta): string[] {
    const skipped: string[] = [];
    const define = (name: string, descriptor: PropertyDescriptor): void => {
        if (name in prototype) {
            skipped.push(name);
            return;
        }
        Object.defineProperty(prototype, name, { configurable: true, enumerable: false, ...descriptor });
    };
    const hostNotify = prototype.notify as ((this: object, ...args: unknown[]) => unknown) | undefined;

    const emitReal = (instance: object, key: string, args: readonly unknown[]): void => {
        for (const { key: each, handler } of handlersOf(instance).values()) {
            if (each === key) handler(instance, ...args);
        }
    };

    define('connect', {
        writable: true,
        value(this: object, key: string, handler: (...args: unknown[]) => unknown): number {
            const id = nextRealId++;
            handlersOf(this).set(id, { key, handler });
            return id;
        },
    });
    define('disconnect', {
        writable: true,
        value(this: object, id: number): void {
            handlersOf(this).delete(id);
        },
    });
    define('emit', {
        writable: true,
        value(this: object, key: string, ...args: unknown[]): void {
            emitReal(this, key, args);
        },
    });
    // `g_object_get_property` / `g_object_set_property`: the INTROSPECTED two-argument pair every
    // GObject class gets offered. This port's chain answers both already, with its own
    // one-argument door, so these are the two names the registration skips.
    define('get_property', {
        writable: true,
        value(this: object, name: string, value: { set(held: unknown): void }): void {
            value.set(valuesOf(this).get(name));
        },
    });
    define('set_property', {
        writable: true,
        value(this: object, name: string, value: { get(): unknown }): void {
            valuesOf(this).set(name, value.get());
        },
    });

    // UNCONDITIONAL in node-gi, which is why it is unconditional here: the chain's `notify` is
    // captured as the host half and a non-string argument goes back to it.
    Object.defineProperty(prototype, 'notify', {
        configurable: true,
        enumerable: false,
        writable: true,
        value(this: object, data: unknown, ...rest: unknown[]): unknown {
            if (typeof data !== 'string') return hostNotify?.call(this, data, ...rest);
            emitReal(this, `notify::${data}`, []);
            return undefined;
        },
    });

    for (const [name, property] of Object.entries(meta.Properties ?? {})) {
        const fallback =
            property.default ?? (property.kind === 'string' ? '' : property.kind === 'boolean' ? false : 0);
        for (const spelling of new Set([name, name.replace(/-/g, '_'), camel(name)])) {
            define(spelling, {
                get(this: object): unknown {
                    const values = valuesOf(this);
                    if (!values.has(name)) values.set(name, fallback);
                    return values.get(name);
                },
                set(this: object, value: unknown): void {
                    const values = valuesOf(this);
                    if (values.has(name) && values.get(name) === value) return;
                    values.set(name, value);
                    emitReal(this, `notify::${name}`, []);
                },
            });
        }
    }
    return skipped;
}

function camel(name: string): string {
    return name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** A migrated widget, as a widget writes one: the meta at the `extends`, the type at `declare`. */
function declaredClass() {
    return class SpecWidget extends withSignals(Base, META) {
        declare title: string;
        declare canClose: boolean;
        declare notify: GObjectNotify;
    };
}

/**
 * Properties that are NOT strings — the first a widget declared (`AdwSpinner`). `size` carries a
 * normalizer, the other two take the seam's own coercion.
 */
const TYPED: DeclaredClassMeta = {
    GTypeName: 'SpecTyped',
    Properties: {
        spinning: { kind: 'boolean', default: true },
        size: { kind: 'double', default: 16, normalize: (value) => Math.max(Number.parseFloat(String(value)), 16) },
        'ring-count': { kind: 'int', default: 0 },
    },
};

function typedClass() {
    return class SpecTyped extends withSignals(Base, TYPED) {
        declare spinning: boolean;
        declare size: number;
        declare ringCount: number;
        declare notify: GObjectNotify;
    };
}

/**
 * The XML-string vectors, run once per leg. NativeScript's builder writes `instance[name] = value`
 * with the attribute's raw string, so BOTH legs have to hand the same typed value on — the pure
 * leg to its store, the real one to node-gi, which would otherwise read `'false'` as true.
 */
async function coercionVectors(leg: string, engineSetup: () => void): Promise<void> {
    await describe(`withSignals(Base, meta) — a string written to a typed property (${leg})`, async () => {
        await it('parses a boolean from its XML spelling, and notifies the typed value', () => {
            resetRegisteredEngine();
            engineSetup();
            const widget = new (typedClass())();
            const seen: boolean[] = [];
            widget.connect('notify::spinning', (self) => seen.push(self.spinning));
            expect(widget.spinning).toBe(true);
            (widget as unknown as Record<string, unknown>).spinning = 'false';
            expect(widget.spinning).toBe(false);
            (widget as unknown as Record<string, unknown>).spinning = ' TRUE ';
            expect(widget.spinning).toBe(true);
            expect(seen).toStrictEqual([false, true]);
        });

        await it('counts a string that parses to the held value as an equal write', () => {
            resetRegisteredEngine();
            engineSetup();
            const widget = new (typedClass())();
            const seen: boolean[] = [];
            // A read materialises the default, so the write below is measured against it.
            expect(widget.spinning).toBe(true);
            widget.connect('notify::spinning', (self) => seen.push(self.spinning));
            (widget as unknown as Record<string, unknown>).spinning = 'true';
            expect(seen.length).toBe(0);
        });

        await it('parses a number, and a typed number goes through untouched', () => {
            resetRegisteredEngine();
            engineSetup();
            const widget = new (typedClass())();
            (widget as unknown as Record<string, unknown>).ringCount = ' 3 ';
            expect(widget.ringCount).toBe(3);
            widget.ringCount = 4;
            expect(widget.ringCount).toBe(4);
            (widget as unknown as Record<string, unknown>)['ring-count'] = '5';
            expect(widget.ringCount).toBe(5);
        });

        await it('refuses a string that is not the declared type instead of defaulting', () => {
            resetRegisteredEngine();
            engineSetup();
            const widget = new (typedClass())();
            const loose = widget as unknown as Record<string, unknown>;
            expect(() => (loose.spinning = 'maybe')).toThrow();
            expect(() => (loose.ringCount = '')).toThrow();
            expect(() => (loose.ringCount = '24px')).toThrow();
            expect(widget.spinning).toBe(true);
            expect(widget.ringCount).toBe(0);
        });

        await it('lets a normalizer own every write: a floor, and a lenient length', () => {
            resetRegisteredEngine();
            engineSetup();
            const widget = new (typedClass())();
            const seen: number[] = [];
            expect(widget.size).toBe(16);
            widget.connect('notify::size', (self) => seen.push(self.size));
            widget.size = 4;
            expect(widget.size).toBe(16);
            (widget as unknown as Record<string, unknown>).size = '24px';
            expect(widget.size).toBe(24);
            widget.size = 24;
            expect(seen).toStrictEqual([24]);
        });
    });
}

export default async () => {
    await describe('withSignals(Base, meta) — the pure-JS leg', async () => {
        await it('answers a declared property in all three spellings, at its default', () => {
            resetRegisteredEngine();
            const widget = new (declaredClass())();
            expect(widget.title).toBe('');
            expect((widget as unknown as Record<string, unknown>)['can-close']).toBe(false);
            expect((widget as unknown as Record<string, unknown>).can_close).toBe(false);
            expect(widget.canClose).toBe(false);
        });

        await it('notifies on a real change and stays silent on an equal write', () => {
            resetRegisteredEngine();
            const widget = new (declaredClass())();
            const seen: string[] = [];
            widget.connect('notify::title', (self) => seen.push(self.title));
            widget.title = 'Inbox';
            widget.title = 'Inbox';
            widget.title = 'Drafts';
            expect(seen).toStrictEqual(['Inbox', 'Drafts']);
        });

        await it('reads a spelling and writes another as one property', () => {
            resetRegisteredEngine();
            const widget = new (declaredClass())();
            const seen: boolean[] = [];
            widget.connect('notify::can-close', (self) => seen.push(self.canClose));
            widget.canClose = true;
            expect((widget as unknown as Record<string, unknown>)['can-close']).toBe(true);
            expect((widget as unknown as Record<string, unknown>).can_close).toBe(true);
            expect(seen).toStrictEqual([true]);
        });

        await it('notifies under every spelling of the detail', () => {
            resetRegisteredEngine();
            const widget = new (declaredClass())();
            const seen: string[] = [];
            for (const detail of ['can-close', 'can_close', 'canClose']) {
                widget.connect(`notify::${detail}`, () => seen.push(detail));
            }
            widget.canClose = true;
            expect(seen).toStrictEqual(['can-close', 'can_close', 'canClose']);
        });

        await it("takes GJS's notify('<prop>') and NativeScript's notify({ eventName })", () => {
            resetRegisteredEngine();
            const widget = new (declaredClass())();
            const seen: string[] = [];
            widget.connect('notify::title', () => seen.push('gjs'));
            widget.connect('tap', () => seen.push('ns'));
            widget.notify('title');
            widget.notify({ eventName: 'tap', object: widget as unknown as Observable });
            expect(seen).toStrictEqual(['gjs', 'ns']);
        });

        await it('refuses notify() of a name the class does not declare', () => {
            resetRegisteredEngine();
            const widget = new (declaredClass())();
            expect(() => widget.notify('nope')).toThrow();
        });

        await it('still carries a NativeScript event, and the declared signal, through the store', () => {
            resetRegisteredEngine();
            const widget = new (declaredClass())();
            const seen: unknown[] = [];
            widget.connect('tap', (_self, data) => seen.push(data.eventName));
            widget.connect('closed', (_self, data) => seen.push((data as { args?: unknown[] }).args));
            widget._emit('tap');
            widget.emit('closed', 'by-user');
            expect(seen).toStrictEqual(['tap', ['by-user']]);
        });

        await it('lists the declared signal and every notify:: in emittedSignals', () => {
            resetRegisteredEngine();
            const emitted = (declaredClass() as unknown as { emittedSignals: readonly string[] }).emittedSignals;
            expect(emitted.includes('closed')).toBe(true);
            expect(emitted.includes('notify::title')).toBe(true);
            expect(emitted.includes('notify::can-close')).toBe(true);
        });

        await it('leaves a class with no meta exactly as it was', () => {
            resetRegisteredEngine();
            const Plain = class extends withSignals(Base) {};
            const widget = new Plain();
            // No accessor was generated and `notify` is the platform's: a bare name is not a
            // property here, so it reaches the host and dispatches nothing rather than throwing.
            expect('title' in widget).toBe(false);
            expect(() => widget.notify({ eventName: 'tap', object: widget as unknown as Observable })).not.toThrow();
        });
    });

    await describe('withSignals(Base, meta) — route D over a registered GType', async () => {
        await it('registers the mixin class once, with the declared GTypeName', () => {
            resetRegisteredEngine();
            const registrations: Registration[] = [];
            registerGObjectEngine(stubEngine(registrations));
            const Widget = declaredClass();
            new Widget();
            new Widget();
            expect(registrations.length).toBe(1);
            expect(registrations[0].meta.GTypeName).toBe('SpecWindowTitle');
            // The MIXIN class, not the widget and not `new.target`: one GType per widget class,
            // shared by every port subclass, as GObject inheritance is.
            expect(registrations[0].klass).toBe(Object.getPrototypeOf(Widget));
        });

        await it("leaves the port's one-argument property door in $foreignSkipped", () => {
            resetRegisteredEngine();
            const registrations: Registration[] = [];
            registerGObjectEngine(stubEngine(registrations));
            new (declaredClass())();
            // `$foreignSkipped` is frozen, as node-gi writes it — copy before sorting.
            expect([...registrations[0].skipped].sort()).toStrictEqual(['get_property', 'set_property']);
        });

        await it('puts a declared property on the GObject, in all three spellings', () => {
            resetRegisteredEngine();
            registerGObjectEngine(stubEngine([]));
            const widget = new (declaredClass())();
            expect(widget.title).toBe('');
            widget.canClose = true;
            expect((widget as unknown as Record<string, unknown>)['can-close']).toBe(true);
            expect((widget as unknown as Record<string, unknown>).can_close).toBe(true);
        });

        await it('routes notify:: of a declared property to the GObject, under every spelling', () => {
            resetRegisteredEngine();
            registerGObjectEngine(stubEngine([]));
            const widget = new (declaredClass())();
            const seen: string[] = [];
            for (const detail of ['can-close', 'can_close', 'canClose']) {
                widget.connect(`notify::${detail}`, () => seen.push(detail));
            }
            widget.canClose = true;
            widget.canClose = true;
            expect(seen).toStrictEqual(['can-close', 'can_close', 'canClose']);
        });

        await it('hands the callback the widget first, as the pure-JS leg does', () => {
            resetRegisteredEngine();
            registerGObjectEngine(stubEngine([]));
            const widget = new (declaredClass())();
            const seen: Array<[unknown, string]> = [];
            widget.connect('notify::title', (self, data) => seen.push([self, data.eventName]));
            widget.title = 'Inbox';
            expect(seen.length).toBe(1);
            expect(seen[0][0]).toBe(widget);
            expect(seen[0][1]).toBe('notify::title');
        });

        await it('carries a declared signal with its arguments', () => {
            resetRegisteredEngine();
            registerGObjectEngine(stubEngine([]));
            const widget = new (declaredClass())();
            const seen: unknown[] = [];
            widget.connect('closed', (_self, data) => seen.push((data as { args?: unknown[] }).args));
            widget.emit('closed', 'by-user');
            expect(seen).toStrictEqual([['by-user']]);
        });

        await it('leaves a NativeScript event on the pure-JS leg', () => {
            resetRegisteredEngine();
            registerGObjectEngine(stubEngine([]));
            const widget = new (declaredClass())();
            const seen: string[] = [];
            const id = widget.connect('tap', () => seen.push('tap'));
            // Below the offset, so it is this seam's own id and not a GObject handler's.
            expect(id < 0x4000_0000).toBe(true);
            expect(widget.listenerCount('tap')).toBe(1);
            widget._emit('tap');
            widget.disconnect(id);
            expect(widget.listenerCount('tap')).toBe(0);
            expect(seen).toStrictEqual(['tap']);
        });

        await it('hands back an offset id for a GObject handler and disconnects exactly it', () => {
            resetRegisteredEngine();
            registerGObjectEngine(stubEngine([]));
            const widget = new (declaredClass())();
            const seen: string[] = [];
            const keep = widget.connect('notify::title', () => seen.push('keep'));
            const drop = widget.connect('notify::title', () => seen.push('drop'));
            expect(keep >= 0x4000_0000).toBe(true);
            widget.disconnect(drop);
            widget.title = 'Inbox';
            expect(seen).toStrictEqual(['keep']);
        });

        await it('throws on a GObject id nothing holds, and on the second disconnect of one', () => {
            resetRegisteredEngine();
            registerGObjectEngine(stubEngine([]));
            const Widget = declaredClass();
            const widget = new Widget();
            const other = new Widget();
            const id = widget.connect('notify::title', () => {});
            expect(() => widget.disconnect(0x4000_0000 + 999999)).toThrow();
            // The port's contract, not GObject's: `g_signal_handler_disconnect` only logs here.
            expect(() => other.disconnect(id)).toThrow();
            widget.disconnect(id);
            expect(() => widget.disconnect(id)).toThrow();
        });

        await it('refuses to fall back when the registration installs nothing', () => {
            resetRegisteredEngine();
            registerGObjectEngine(stubEngine([], () => []));
            // ADR 0105's rule where it bites: a widget that asked for a real GObject and got a JS
            // store would be a wrong answer nothing downstream could see.
            expect(() => new (declaredClass())()).toThrow();
        });
    });

    await coercionVectors('pure-JS leg', () => {});
    await coercionVectors('route D', () => registerGObjectEngine(stubEngine([])));
};
