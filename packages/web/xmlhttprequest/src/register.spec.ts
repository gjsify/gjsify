// The `/register` wiring, kept out of `index.spec.ts` because importing it
// mutates globals for the whole run (tests/AGENTS.md § rule 7).
//
// TWO THINGS HERE ARE DELIBERATE AND BOTH LOOK LIKE MISTAKES.
//
// 1. The module is reached RELATIVELY, not as `@gjsify/xmlhttprequest/register`
//    the way every sibling register spec reaches its own. That subpath is
//    aliased to `@gjsify/fetch/register/xhr` on the gjs target, so the sibling
//    spelling would install `@gjsify/fetch`'s XHR and then measure it — a green
//    suite that never touched this package.
//
// 2. The import is DYNAMIC. `package.json#sideEffects` lists the BUILT
//    `./lib/esm/register.js`, which is the right declaration for the published
//    tarball but does not match the source path, so rolldown reads
//    `src/register.ts` as side-effect-free and drops a static bare
//    `import './register.js'` entirely. Measured: with the static form the
//    bundle contained no assignment at all and `globalThis.XMLHttpRequest` was
//    `undefined`. The siblings never meet this because the package subpath they
//    import DOES match the `sideEffects` entry. Turn this back into a static
//    import and the two tests below stop testing anything.

import { describe, expect, it } from '@gjsify/unit';

import { XMLHttpRequest } from './index.js';

interface RegisteredGlobals {
    XMLHttpRequest?: typeof XMLHttpRequest;
    URL: {
        createObjectURL?: (blob: unknown) => string;
        revokeObjectURL?: (url: string) => void;
        __gjsify_objecturl?: boolean;
    };
}
const registered = () => globalThis as unknown as RegisteredGlobals;

export default async () => {
    await import('./register.js');

    await describe('@gjsify/xmlhttprequest/register', async () => {
        await it("puts this package's XMLHttpRequest on globalThis", async () => {
            // Identity, not `typeof === 'function'`: `register.ts` only assigns when the
            // global is absent, and the weaker assertion would pass just as happily
            // against a global something else had already installed — which is exactly
            // the case worth knowing about.
            expect(registered().XMLHttpRequest).toBe(XMLHttpRequest);
        });

        await it('constructs an UNSENT request through the global', async () => {
            const Registered = registered().XMLHttpRequest as typeof XMLHttpRequest;
            expect(typeof Registered).toBe('function');
            const xhr = new Registered();
            expect(xhr.readyState).toBe(xhr.UNSENT);
        });

        await it('patches URL.createObjectURL and URL.revokeObjectURL', async () => {
            expect(typeof registered().URL.createObjectURL).toBe('function');
            expect(typeof registered().URL.revokeObjectURL).toBe('function');
            expect(registered().URL.__gjsify_objecturl).toBe(true);
        });
    });
};
