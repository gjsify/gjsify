// EventEmitter — the two behaviours that are observable and not obvious.
//
// Everything else about it is ordinary. These two are pinned because a plausible
// implementation gets them wrong and no consumer notices until a listener silently
// stops firing.

import { describe, expect, it } from '@gjsify/unit';

import { EventEmitter } from './event-emitter.js';

export default async () => {
    await describe('EventEmitter', async () => {
        await it('removes by subscription, not by function identity', async () => {
            const emitter = new EventEmitter<{ tick: [number] }>();
            const seen: number[] = [];
            const listener = (n: number) => seen.push(n);
            // The SAME function twice: identity-based removal would drop both.
            const first = emitter.addListener('tick', listener);
            emitter.addListener('tick', listener);
            first.remove();
            emitter.emit('tick', 1);
            expect(seen).toStrictEqual([1]);
            expect(emitter.listenerCount('tick')).toBe(1);
        });

        await it('does not skip a listener when an earlier one removes itself', async () => {
            // Iterating the live array shifts it under the loop, and the listener
            // after a self-removing one is silently never called. Self-removal is
            // the common case, so this is not a corner.
            const emitter = new EventEmitter<{ go: [] }>();
            const seen: string[] = [];
            const a = emitter.addListener('go', () => {
                seen.push('a');
                a.remove();
            });
            emitter.addListener('go', () => seen.push('b'));
            emitter.emit('go');
            expect(seen).toStrictEqual(['a', 'b']);
        });

        await it('does not call a listener an earlier listener just removed', async () => {
            // The other half of the same problem: iterating a COPY would call it.
            const emitter = new EventEmitter<{ go: [] }>();
            const seen: string[] = [];
            emitter.addListener('go', () => {
                seen.push('a');
                second.remove();
            });
            const second = emitter.addListener('go', () => seen.push('b'));
            emitter.emit('go');
            expect(seen).toStrictEqual(['a']);
        });

        await it('is idempotent on a double remove', async () => {
            const emitter = new EventEmitter<{ go: [] }>();
            const subscription = emitter.addListener('go', () => {});
            emitter.addListener('go', () => {});
            subscription.remove();
            subscription.remove();
            expect(emitter.listenerCount('go')).toBe(1);
        });

        await it('clears one type or all of them', async () => {
            const emitter = new EventEmitter<{ a: []; b: [] }>();
            emitter.addListener('a', () => {});
            emitter.addListener('b', () => {});
            emitter.removeAllListeners('a');
            expect(emitter.listenerCount('a')).toBe(0);
            expect(emitter.listenerCount('b')).toBe(1);
            emitter.removeAllListeners();
            expect(emitter.listenerCount('b')).toBe(0);
        });
    });
};
