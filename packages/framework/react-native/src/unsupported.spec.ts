// An unimplemented export must fail in a way that names itself.
//
// The failure this guards against is not "it throws" but "it returns undefined and
// something unrelated breaks three frames later" — the failure-attribution problem
// that costs the most to diagnose. So the vectors are mostly about ACCESS, not call.

import { describe, expect, it } from '@gjsify/unit';

import { UnsupportedError, unsupported } from './unsupported.js';

export default async () => {
    await describe('an unimplemented export', async () => {
        const FlatList = unsupported('FlatList') as unknown as Record<string, unknown> & ((...a: unknown[]) => unknown);

        await it('throws when rendered or called', async () => {
            expect(() => (FlatList as (...a: unknown[]) => unknown)()).toThrow(/UnsupportedError|FlatList/);
        });

        await it('throws when constructed', async () => {
            const Ctor = FlatList as unknown as new () => unknown;
            expect(() => new Ctor()).toThrow(/UnsupportedError|FlatList/);
        });

        await it('throws on a property READ, not only on a call', async () => {
            // `Animated.timing` and `NativeModules.Foo` are reads. Answering
            // `undefined` here is what exports the failure into someone else's code.
            expect(() => FlatList.timing).toThrow(/UnsupportedError|FlatList/);
        });

        await it('throws on a property write', async () => {
            expect(() => {
                FlatList.anything = 1;
            }).toThrow(/UnsupportedError|FlatList/);
        });

        await it('carries the export name and the table sentence', async () => {
            let caught: unknown;
            try {
                (FlatList as (...a: unknown[]) => unknown)();
            } catch (error) {
                caught = error;
            }
            expect(caught instanceof UnsupportedError).toBe(true);
            expect((caught as UnsupportedError).export).toBe('FlatList');
            expect((caught as UnsupportedError).name).toBe('UnsupportedError');
            expect((caught as UnsupportedError).message).toContain('Gtk.ListView');
        });

        await it('still answers the reads feature detection makes', async () => {
            // A `typeof X === 'function'` guard must keep working, and so must the
            // three reads a bundler's interop and React's own element check make.
            // Throwing on these would break code that is behaving correctly.
            expect(typeof FlatList).toBe('function');
            expect(FlatList.name).toBe('FlatList');
            expect(FlatList.displayName).toBe('FlatList');
            expect(FlatList.$$typeof).toBe(undefined);
            expect(FlatList.then).toBe(undefined);
        });
    });
};
