// Comlink, unmodified, over the Worker adapter on both ends. Ported from the
// spike in docs/poc/web-worker (case 05); the worker fixture is Comlink.expose()
// bundled by build:test:*, since a GJS child cannot resolve a bare specifier.

import { describe, it, expect } from '@gjsify/unit';
import * as Comlink from 'comlink';
import { Worker } from './index.js';

const FIXTURE = new URL('./fixtures/comlink.worker.bundle.mjs', import.meta.url);

interface Api {
    answer: Promise<number>;
    add(a: number, b: number): Promise<number>;
    slowAdd(a: number, b: number): Promise<number>;
    throws(): Promise<never>;
    withCallback(callback: (n: number) => number): Promise<string>;
    structured(): Promise<{ when: Date; set: Set<number>; map: Map<string, number>; big: bigint; bytes: Uint8Array }>;
    rows(n: number): Promise<unknown[]>;
    [Comlink.createEndpoint](): Promise<MessagePort>;
}

export default async () => {
    await describe('Comlink over Worker', async () => {
        const worker = new Worker(FIXTURE, { type: 'module' });
        const api = Comlink.wrap<Api>(worker as unknown as Comlink.Endpoint);

        await it('reads a plain property', async () => {
            expect(await api.answer).toBe(42);
        });

        await it('calls a sync and an async function', async () => {
            expect(await api.add(2, 3)).toBe(5);
            expect(await api.slowAdd(2, 3)).toBe(5);
        });

        await it('a throw in the worker rejects with the original error type', async () => {
            let caught: Error | undefined;
            try {
                await api.throws();
            } catch (error) {
                caught = error;
            }
            expect(caught?.message).toBe('from-the-worker');
        });

        await it('returns structured-clone-hard values', async () => {
            const value = await api.structured();
            expect(value.when instanceof Date).toBe(true);
            expect(value.set instanceof Set).toBe(true);
            expect(value.map instanceof Map).toBe(true);
            expect(value.big).toBe(1n);
            expect(value.bytes instanceof Uint8Array).toBe(true);
        });

        await it('returns 1000 rows', async () => {
            expect((await api.rows(1000)).length).toBe(1000);
        });

        await it('proxy() callback travels parent to worker as a MessagePort', async () => {
            expect(await api.withCallback(Comlink.proxy((n: number) => n * 2))).toBe('callback returned 14');
        });

        await it('createEndpoint travels worker to parent as a MessagePort', async () => {
            const second = Comlink.wrap<Api>(await api[Comlink.createEndpoint]());
            expect(await second.add(1, 1)).toBe(2);
        });

        await it('terminate() releases the worker', async () => {
            worker.terminate();
            expect(true).toBe(true);
        });
    });
};
