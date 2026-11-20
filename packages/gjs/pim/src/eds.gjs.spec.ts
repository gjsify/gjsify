import { describe, expect, it } from '@gjsify/unit';
import { BackendError, BackendUnavailableError } from './errors.js';
import { createEdsBackend, edsError, unwrapList, unwrapResult } from './eds/index.js';

async function rejection(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise;
    } catch (err) {
        return err;
    }
    return null;
}

export default async () => {
    await describe('EDS result shapes', async () => {
        await it('unwraps [success, value] and a bare value alike', async () => {
            expect(unwrapResult<string>([true, 'uid-1'])).toBe('uid-1');
            expect(unwrapResult<string>('uid-2')).toBe('uid-2');
            expect(unwrapList<number>([true, [1, 2]])).toEqualArray([1, 2]);
            expect(unwrapList<number>(null)).toEqualArray([]);
        });

        await it('keeps a GError domain only when it is a name', async () => {
            const named = edsError('call', { message: 'boom', domain: 'e-client-error-quark', code: 3 });
            expect(named.domain).toBe('e-client-error-quark');
            expect(named.code).toBe(3);
            expect(named.message).toBe('call: boom');
            expect(edsError('call', { message: 'x', domain: 1234 }).domain).toBeUndefined();
        });
    });

    // No session bus here (the test script points DBUS_SESSION_BUS_ADDRESS at nothing): with the
    // typelibs present the registry cannot connect, without them they cannot load. Either way the
    // backend must answer with one of this package's own errors — a raw GLib.Error serialises to `{}`.
    await describe('EDS backend without a session', async () => {
        await it('fails with a classified error, never a raw one', async () => {
            const err = await rejection(createEdsBackend().listCalendars());
            expect(err instanceof BackendError || err instanceof BackendUnavailableError).toBe(true);
        });
    });
};
