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

        await it('never states platform/arch as a literal', async () => {
            // The banner used to answer `platform:"linux",arch:"x64"` outright,
            // which is a WRONG answer on two of three OSes rather than a missing
            // one — a bundle that reads the field and never pulls
            // `@gjsify/process` in (its register replaces this whole object)
            // reported `linux` from a Mac. Both are now lazy, answered by the
            // same `uname -sm` probe `@gjsify/process` uses.
            //
            // Scoped to the `globalThis.process={…}` literal, not the whole
            // banner: "linux" and "x64" legitimately survive AHEAD of it, inside
            // the probe, as its fallback and its mapping table.
            const stubObject = GJS_PROCESS_STUB.slice(GJS_PROCESS_STUB.indexOf('globalThis.process={'));
            expect(stubObject.length > 0).toBe(true);
            expect(/platform\s*:\s*["'`]/.test(stubObject)).toBe(false);
            expect(/arch\s*:\s*["'`]/.test(stubObject)).toBe(false);
            expect(stubObject).toContain('get platform()');
            expect(stubObject).toContain('get arch()');
        });

        await it('answers them from uname, the way @gjsify/process does', async () => {
            // The mapping tables are `@gjsify/utils`' `platform-names.ts`,
            // inlined because a byte-1 banner has no module system to import
            // them from. Pinning the probe's shape here is what keeps the
            // inlined copy from drifting away from the canonical one silently.
            expect(GJS_PROCESS_STUB).toContain('"uname"');
            expect(GJS_PROCESS_STUB).toContain('SpawnFlags.SEARCH_PATH');
            // Windows has no `uname` on PATH, so it is answered from the
            // environment instead of spawning and recovering.
            expect(GJS_PROCESS_STUB).toContain('Windows_NT');
        });
    });
};
