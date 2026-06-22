// @gjsify/devtools-protocol — MethodRegistry tests.
// Cross-platform (pure TS): runs identically on Node and GJS.

import { describe, expect, it } from '@gjsify/unit';
import { MethodRegistry } from './registry.js';

export default async () => {
    await describe('MethodRegistry — dispatch', async () => {
        await it('dispatches a registered read-only method', async () => {
            const reg = new MethodRegistry();
            reg.register({ name: 'GetStatus', kind: 'read-only', handler: () => ({ value: 1 }) });
            const res = await reg.dispatch({ method: 'GetStatus' });
            expect(res.ok).toBe(true);
            if (res.ok) expect(res.result).toStrictEqual({ value: 1 });
        });

        await it('passes params through (defaulting to an empty object)', async () => {
            const reg = new MethodRegistry();
            reg.register({ name: 'Echo', kind: 'read-only', handler: (params) => params });
            const withParams = await reg.dispatch({ method: 'Echo', params: { a: 2 } });
            if (withParams.ok) expect(withParams.result).toStrictEqual({ a: 2 });
            const without = await reg.dispatch({ method: 'Echo' });
            if (without.ok) expect(without.result).toStrictEqual({});
        });

        await it('echoes the correlation id back on the response', async () => {
            const reg = new MethodRegistry();
            reg.register({ name: 'GetStatus', kind: 'read-only', handler: () => 'ok' });
            const res = await reg.dispatch({ method: 'GetStatus', id: 42 });
            expect(res.id).toBe(42);
        });

        await it('returns not-found for an unknown method', async () => {
            const reg = new MethodRegistry();
            const res = await reg.dispatch({ method: 'Nope' });
            expect(res.ok).toBe(false);
            if (!res.ok) expect(res.error.code).toBe('not-found');
        });
    });

    await describe('MethodRegistry — pause policy', async () => {
        await it('rejects a mutating method while paused but allows read-only', async () => {
            const reg = new MethodRegistry();
            reg.register({ name: 'ActivateAction', kind: 'mutating', handler: () => true });
            reg.register({ name: 'GetStatus', kind: 'read-only', handler: () => 'ok' });
            const blocked = await reg.dispatch({ method: 'ActivateAction' }, { paused: true });
            expect(blocked.ok).toBe(false);
            if (!blocked.ok) expect(blocked.error.code).toBe('paused');
            const allowed = await reg.dispatch({ method: 'GetStatus' }, { paused: true });
            expect(allowed.ok).toBe(true);
        });

        await it('allows a mutating method when not paused', async () => {
            const reg = new MethodRegistry();
            reg.register({ name: 'ActivateAction', kind: 'mutating', handler: () => true });
            const res = await reg.dispatch({ method: 'ActivateAction' });
            expect(res.ok).toBe(true);
        });
    });

    await describe('MethodRegistry — registration + errors', async () => {
        await it('refuses duplicate registration', async () => {
            const reg = new MethodRegistry();
            reg.register({ name: 'X', kind: 'read-only', handler: () => 0 });
            expect(() => reg.register({ name: 'X', kind: 'read-only', handler: () => 1 })).toThrow();
        });

        await it('lists registered methods with their kinds', async () => {
            const reg = new MethodRegistry();
            reg.register({ name: 'A', kind: 'read-only', handler: () => 0 });
            reg.register({ name: 'B', kind: 'mutating', handler: () => 0 });
            expect(reg.list()).toStrictEqual([
                { name: 'A', kind: 'read-only' },
                { name: 'B', kind: 'mutating' },
            ]);
        });

        await it('surfaces a thrown handler error as an internal error response', async () => {
            const reg = new MethodRegistry();
            reg.register({
                name: 'Boom',
                kind: 'read-only',
                handler: () => {
                    throw new Error('kaboom');
                },
            });
            const res = await reg.dispatch({ method: 'Boom' });
            expect(res.ok).toBe(false);
            if (!res.ok) {
                expect(res.error.code).toBe('internal');
                expect(res.error.message).toBe('kaboom');
            }
        });
    });
};
