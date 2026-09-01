// An unimplemented export must fail in a way that names itself.
//
// The failure this guards against is not "it throws" but "it returns undefined and
// something unrelated breaks three frames later" — the failure-attribution problem
// that costs the most to diagnose. So the vectors are mostly about ACCESS, not call.

import { describe, expect, it } from '@gjsify/unit';

import { UnsupportedError, unsupported } from './unsupported.js';

export default async () => {
    await describe('an unimplemented export', async () => {
        // `Modal`, because the fixture has to be a name the table really refuses and
        // `Animated` stopped being one: it is `partial` now, so its sentence reads
        // "is available" and every assertion below would pass for the wrong reason.
        // `Modal` is `planned` with a `gtk` field, which is what the last vector needs.
        const Refused = unsupported('Modal') as unknown as Record<string, unknown> & ((...a: unknown[]) => unknown);

        await it('throws when rendered or called', async () => {
            expect(() => (Refused as (...a: unknown[]) => unknown)()).toThrow(/UnsupportedError|Modal/);
        });

        await it('throws when constructed', async () => {
            const Ctor = Refused as unknown as new () => unknown;
            expect(() => new Ctor()).toThrow(/UnsupportedError|Modal/);
        });

        await it('throws on a property READ, not only on a call', async () => {
            // `NativeModules.Foo` and `Modal.propTypes` are reads. Answering
            // `undefined` here is what exports the failure into someone else's code.
            expect(() => Refused.propTypes).toThrow(/UnsupportedError|Modal/);
        });

        await it('throws on a property write', async () => {
            expect(() => {
                Refused.anything = 1;
            }).toThrow(/UnsupportedError|Modal/);
        });

        await it('carries the export name and the table sentence', async () => {
            let caught: unknown;
            try {
                (Refused as (...a: unknown[]) => unknown)();
            } catch (error) {
                caught = error;
            }
            expect(caught instanceof UnsupportedError).toBe(true);
            expect((caught as UnsupportedError).export).toBe('Modal');
            expect((caught as UnsupportedError).name).toBe('UnsupportedError');
            expect((caught as UnsupportedError).message).toContain('Adw.Dialog');
        });

        await it('still answers the reads feature detection makes', async () => {
            // A `typeof X === 'function'` guard must keep working, and so must the
            // three reads a bundler's interop and React's own element check make.
            // Throwing on these would break code that is behaving correctly.
            expect(typeof Refused).toBe('function');
            expect(Refused.name).toBe('Modal');
            expect(Refused.displayName).toBe('Modal');
            expect(Refused.$$typeof).toBe(undefined);
            expect(Refused.then).toBe(undefined);
        });
    });
};
