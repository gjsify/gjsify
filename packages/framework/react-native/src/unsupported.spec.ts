// An unimplemented export must fail in a way that names itself.
//
// The failure this guards against is not "it throws" but "it returns undefined and
// something unrelated breaks three frames later" — the failure-attribution problem
// that costs the most to diagnose. So the vectors are mostly about ACCESS, not call.

import { describe, expect, it } from '@gjsify/unit';

import { SUPPORT_TABLE } from './support-table.js';
import { UnsupportedError, unsupported } from './unsupported.js';

export default async () => {
    await describe('an unimplemented export', async () => {
        // THE FIXTURE IS DERIVED, and that is the finding rather than the tidiness.
        // It was a literal twice and went stale twice: `Animated` first, because a
        // `partial` name's sentence reads "is available" and every assertion below
        // then passes for the wrong reason, and then `Modal`, which ADR 0045 made
        // `partial` too. What the vectors actually need is any name that is
        // `planned` AND carries a `gtk` field — the last one asserts the sentence
        // quotes it — so the table answers that itself and the next promotion moves
        // the fixture instead of breaking four tests.
        const found = Object.entries(SUPPORT_TABLE).find(
            ([, entry]) => entry.status === 'planned' && typeof entry.gtk === 'string',
        );
        const [name, entry] = found ?? ['', { gtk: '' }];
        const Refused = unsupported(name) as unknown as Record<string, unknown> & ((...a: unknown[]) => unknown);
        const matches = new RegExp(`UnsupportedError|${name}`);

        await it('has a planned name to be refused about', async () => {
            // Not vacuous: with no such entry the fixture above is the empty string
            // and every vector below passes against a name nobody asked for.
            expect(found === undefined).toBe(false);
            expect(name.length > 0).toBe(true);
        });

        await it('throws when rendered or called', async () => {
            expect(() => (Refused as (...a: unknown[]) => unknown)()).toThrow(matches);
        });

        await it('throws when constructed', async () => {
            const Ctor = Refused as unknown as new () => unknown;
            expect(() => new Ctor()).toThrow(matches);
        });

        await it('throws on a property READ, not only on a call', async () => {
            // `NativeModules.Foo` and `Component.propTypes` are reads. Answering
            // `undefined` here is what exports the failure into someone else's code.
            expect(() => Refused.propTypes).toThrow(matches);
        });

        await it('throws on a property write', async () => {
            expect(() => {
                Refused.anything = 1;
            }).toThrow(matches);
        });

        await it('carries the export name and the table sentence', async () => {
            let caught: unknown;
            try {
                (Refused as (...a: unknown[]) => unknown)();
            } catch (error) {
                caught = error;
            }
            expect(caught instanceof UnsupportedError).toBe(true);
            expect((caught as UnsupportedError).export).toBe(name);
            expect((caught as UnsupportedError).name).toBe('UnsupportedError');
            expect((caught as UnsupportedError).message).toContain(entry.gtk as string);
        });

        await it('still answers the reads feature detection makes', async () => {
            // A `typeof X === 'function'` guard must keep working, and so must the
            // three reads a bundler's interop and React's own element check make.
            // Throwing on these would break code that is behaving correctly.
            expect(typeof Refused).toBe('function');
            expect(Refused.name).toBe(name);
            expect(Refused.displayName).toBe(name);
            expect(Refused.$$typeof).toBe(undefined);
            expect(Refused.then).toBe(undefined);
        });
    });
};
