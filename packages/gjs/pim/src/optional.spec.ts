import { describe, expect, it } from '@gjsify/unit';
import { BackendUnavailableError } from './errors.js';
import { setPimTranslator } from './i18n.js';
import { optionalNamespace } from './optional.js';

async function rejection(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise;
    } catch (err) {
        return err;
    }
    return null;
}

export default async () => {
    await describe('optional GI namespaces', async () => {
        await it('does not load until first use, and loads once', async () => {
            let calls = 0;
            const ns = optionalNamespace('Fake', async () => {
                calls++;
                return { ok: true };
            });
            expect(calls).toBe(0);
            expect((await ns.get()).ok).toBe(true);
            await ns.get();
            expect(calls).toBe(1);
        });

        await it('reports a failing loader as BackendUnavailableError naming the namespace', async () => {
            const ns = optionalNamespace('ECal', async () => {
                throw new Error("Typelib file for namespace 'ECal' not found");
            });
            const err = await rejection(ns.get());
            expect(err instanceof BackendUnavailableError).toBe(true);
            expect((err as Error).message).toContain('ECal typelib not available');
        });

        await it('translates its message through the pim translator', async () => {
            setPimTranslator({
                gettext: (msgid) => (msgid === '{label} typelib not available: {message}' ? 'X {label}' : msgid),
                ngettext: (s, p, n) => (n === 1 ? s : p),
            });
            try {
                const err = await rejection(
                    optionalNamespace('ECal', async () => Promise.reject(new Error('gone'))).get(),
                );
                expect((err as Error).message).toBe('X ECal');
            } finally {
                setPimTranslator(null);
            }
        });

        await it('caches the failure', async () => {
            let calls = 0;
            const ns = optionalNamespace('EDataServer', async () => {
                calls++;
                throw new Error('missing');
            });
            await rejection(ns.get());
            await rejection(ns.get());
            expect(calls).toBe(1);
        });
    });
};
