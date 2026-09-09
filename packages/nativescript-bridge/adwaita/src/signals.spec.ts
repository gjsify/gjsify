// GJS's `connect` / `disconnect` on a NativeScript observable, off-device.
//
// `signals.ts` imports nothing from `@nativescript/core` as a value, so this drives the
// SHIPPING mixin over a stand-in base with the `Observable` event surface the ambient
// slice declares — the widget classes themselves cannot be imported here at all
// (`extends GridLayout` evaluates the bare specifier at module-eval, and the workspace
// install has no `@nativescript/core`).
//
// The contract under test is GJS's, measured on this machine: `connect` returns a
// number, ids are process-unique and increase, `disconnect(id)` removes exactly that
// handler. The one place the port is STRICTER is pinned too — an unknown id throws
// where `g_signal_handler_disconnect` logs a critical and returns.

import { describe, expect, it } from '@gjsify/unit';
import type { EventData, Observable } from '@nativescript/core';

import { withSignals } from './widgets/signals.js';

/**
 * The event half of `Observable`, as `ns-core.d.ts` declares it: enough for the mixin
 * to subscribe, unsubscribe and be notified, and nothing the mixin does not touch.
 */
class ObservableShape {
    private readonly _listeners = new Map<string, Array<(data: EventData) => void>>();

    _emit(eventName: string): void {
        this.notify({ eventName, object: this as unknown as Observable });
    }

    addEventListener(eventName: string, callback: (data: EventData) => void): void {
        const list = this._listeners.get(eventName) ?? [];
        list.push(callback);
        this._listeners.set(eventName, list);
    }

    removeEventListener(eventName: string, callback?: (data: EventData) => void): void {
        const list = this._listeners.get(eventName) ?? [];
        this._listeners.set(eventName, callback === undefined ? [] : list.filter((listener) => listener !== callback));
    }

    notify<T extends EventData>(data: T): void {
        // `removeEventListener` replaces the array rather than splicing it, so iterating the
        // live one is safe even when a listener unsubscribes mid-dispatch.
        for (const listener of this._listeners.get(data.eventName) ?? []) listener(data);
    }

    notifyPropertyChange(name: string, value: unknown, oldValue?: unknown): void {
        this.notify({ eventName: 'propertyChange', object: this as unknown as Observable, name, value, oldValue });
    }

    set(name: string, value: unknown): void {
        (this as Record<string, unknown>)[name] = value;
    }

    get(name: string): unknown {
        return (this as Record<string, unknown>)[name];
    }

    /** How many listeners `eventName` has — what the mixin's bookkeeping is measured against. */
    listenerCount(eventName: string): number {
        return (this._listeners.get(eventName) ?? []).length;
    }
}

/** A widget-shaped class at the platform boundary: the ONE place the mixin is applied. */
class RowShape extends withSignals(ObservableShape as unknown as new () => Observable & ObservableShape) {
    active = false;
}

/** A subclass of a port class: inherits the door, applies nothing. */
class SwitchRowShape extends RowShape {}

export default async () => {
    await describe('withSignals — connect', async () => {
        await it('returns a numeric handler id, unique across instances and increasing', () => {
            const a = new RowShape();
            const b = new RowShape();
            const first = a.connect('notify::active', () => {});
            const second = b.connect('notify::active', () => {});
            const third = a.connect('tap', () => {});
            expect(typeof first).toBe('number');
            expect(first > 0).toBe(true);
            expect(second > first).toBe(true);
            expect(third > second).toBe(true);
        });

        await it('hands the callback the widget first, then the NativeScript payload', () => {
            const row = new RowShape();
            const seen: Array<[unknown, EventData]> = [];
            row.connect('notify::active', (self, data) => seen.push([self, data]));
            row.active = true;
            row.notify({ eventName: 'notify::active', object: row as unknown as Observable, active: true });
            expect(seen.length).toBe(1);
            expect(seen[0]?.[0] === row).toBe(true);
            expect(seen[0]?.[1].eventName).toBe('notify::active');
        });

        await it('keeps two handlers sharing one callback as two handlers', () => {
            const row = new RowShape();
            let calls = 0;
            const callback = () => {
                calls += 1;
            };
            const first = row.connect('tap', callback);
            row.connect('tap', callback);
            row._emit('tap');
            expect(calls).toBe(2);
            // `removeEventListener(name, callback)` would have dropped BOTH here; the
            // per-connect wrapper is what keeps the second one alive.
            row.disconnect(first);
            row._emit('tap');
            expect(calls).toBe(3);
        });

        await it('is inherited by a subclass of a port class without a second application', () => {
            const row = new SwitchRowShape();
            expect(typeof row.connect).toBe('function');
            expect(Object.hasOwn(SwitchRowShape.prototype, 'connect')).toBe(false);
            expect(Object.hasOwn(RowShape.prototype, 'connect')).toBe(false);
            // The mixin's own class sits between the two — that is where the door lives.
            expect(Object.hasOwn(Object.getPrototypeOf(RowShape.prototype), 'connect')).toBe(true);
            let fired = 0;
            const id = row.connect('tap', () => {
                fired += 1;
            });
            row._emit('tap');
            row.disconnect(id);
            row._emit('tap');
            expect(fired).toBe(1);
        });

        await it('adds no own property to the instance', () => {
            const row = new RowShape();
            row.connect('tap', () => {});
            // A field for the handler map would be a name that could collide with a base's,
            // and would appear in the construct-props bag's derived key set.
            expect(Object.keys(row).sort()).toStrictEqual(['_listeners', 'active']);
        });
    });

    await describe('withSignals — disconnect', async () => {
        await it('removes exactly the handler the id names', () => {
            const row = new RowShape();
            const fired: string[] = [];
            const keep = row.connect('notify::active', () => fired.push('keep'));
            const drop = row.connect('notify::active', () => fired.push('drop'));
            expect(row.listenerCount('notify::active')).toBe(2);
            row.disconnect(drop);
            expect(row.listenerCount('notify::active')).toBe(1);
            row._emit('notify::active');
            expect(fired).toStrictEqual(['keep']);
            row.disconnect(keep);
            expect(row.listenerCount('notify::active')).toBe(0);
        });

        await it('throws on an id nothing holds, and on the second disconnect of one id', () => {
            const row = new RowShape();
            const other = new RowShape();
            const id = row.connect('tap', () => {});
            expect(() => row.disconnect(999999)).toThrow();
            // An id another widget returned is not this widget's, as with GObject: the
            // counter is global, the bookkeeping is per instance.
            expect(() => other.disconnect(id)).toThrow();
            row.disconnect(id);
            expect(() => row.disconnect(id)).toThrow();
        });
    });
};
