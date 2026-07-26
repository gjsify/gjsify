// The GJS bundle banner must reach every ambient global through `globalThis.`.
//
// The banner is prepended at byte 1 and shares the module's top-level scope
// with all bundled code. A BARE `imports` there therefore binds to any
// top-level `const imports` a bundled module declares — and at byte 1 that
// binding is still in its temporal dead zone, so the bundle dies at load with
// `ReferenceError: can't access lexical declaration 'imports' before
// initialization` before a single line of program code runs.
//
// This is not hypothetical and not specific to any one package: the generated
// `@girs/gjs` shim declares exactly that (`const imports = globalThis.imports
// || {}`), so ANY bundle whose graph retains it breaks. It stayed hidden only
// because tree-shaking happened to drop that module; making `@gjsify/utils`
// side-effect-free was enough to retain it and take the whole GJS test leg of
// `@gjsify/web-streams` down (374 → 187).
//
// Asserting on the banner string keeps the guard cheap and exact — no bundle
// build required, and it fails on the mistake itself rather than on one of its
// downstream symptoms.
import { describe, expect, it } from '@gjsify/unit';
import { GJS_PROCESS_STUB } from '@gjsify/rolldown-plugin-gjsify';

/** GJS ambient globals a bundled module could plausibly shadow at top level. */
const AMBIENT_GLOBALS = ['imports', 'print', 'printerr', 'log', 'logError', 'ARGV'];

export default async () => {
    await describe('GJS_PROCESS_STUB', async () => {
        await it('is a single line (zero source-map drift)', async () => {
            expect(GJS_PROCESS_STUB.includes('\n')).toBe(false);
        });

        for (const name of AMBIENT_GLOBALS) {
            await it(`never references \`${name}\` as a bare identifier`, async () => {
                // A bare reference is the identifier NOT preceded by `.` — i.e.
                // `imports.system` matches, `globalThis.imports.system` does not.
                const bare = new RegExp(`(^|[^.\\w$])${name}\\s*[.(]`);
                expect(bare.test(GJS_PROCESS_STUB)).toBe(false);
            });
        }

        await it('still reaches the globals it needs, via globalThis', async () => {
            expect(GJS_PROCESS_STUB).toContain('globalThis.imports.system');
            expect(GJS_PROCESS_STUB).toContain('globalThis.imports.gi.GLib');
            expect(GJS_PROCESS_STUB).toContain('globalThis.print');
            expect(GJS_PROCESS_STUB).toContain('globalThis.printerr');
        });
    });
};
