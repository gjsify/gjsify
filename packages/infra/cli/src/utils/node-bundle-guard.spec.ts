// Unit coverage for the `--app node` ambient-globals gate. The regression it
// guards: `detectNodeGiGlobals` ran against a module graph that differed from
// the emitted one (the `--globals` register stub was resolved AFTER it, so
// `/register` subpaths were routed to `@gjsify/empty` during the analysis pass
// and resolved for real in the build). The `imports` reference inside
// `@gjsify/canvas2d-core`'s `_toDataURL` was therefore invisible, no
// `@gjsify/node-gi/globals` shim was injected, and the showcase died with
// `ReferenceError: imports is not defined` on node and bun while running fine
// on gjs.
//
// The distinction that has to hold: a BARE `imports` is a dependency, a
// `globalThis.imports` probe is a runtime check. Flagging the latter would
// force the native node-gi addon into every cross-platform package's node
// bundle and break its plain-Node loadability.

import { describe, expect, it } from '@gjsify/unit';
import { assertNodeBundleGlobalsShimmed, findUnshimmedGjsGlobals } from './node-bundle-guard.js';

export default async () => {
    await describe('node-bundle-guard: findUnshimmedGjsGlobals', async () => {
        await it('is empty for a bundle that touches no GJS ambient global', () => {
            expect(findUnshimmedGjsGlobals('export const x = 1; console.log(x);')).toStrictEqual([]);
        });

        await it('finds a bare `imports` — the _toDataURL shape', () => {
            const code = 'function toDataURL() { const Gio = imports.gi.Gio; return Gio; }\nexport { toDataURL };';
            expect(findUnshimmedGjsGlobals(code)).toStrictEqual(['imports']);
        });

        await it('finds bare print/ARGV and sorts the result', () => {
            expect(findUnshimmedGjsGlobals('print(ARGV[0]);')).toStrictEqual(['ARGV', 'print']);
        });

        await it('ignores the `globalThis.imports` isomorphic-guard shape', () => {
            // A cross-platform package probing the runtime must NOT drag the
            // native node-gi addon into its node bundle.
            const code = 'export const glib = globalThis.imports?.gi?.GLib;';
            expect(findUnshimmedGjsGlobals(code)).toStrictEqual([]);
        });

        await it('ignores a locally declared binding that shadows the global', () => {
            expect(findUnshimmedGjsGlobals('const imports = collect(); export default imports;')).toStrictEqual([]);
        });
    });

    await describe('node-bundle-guard: assertNodeBundleGlobalsShimmed', async () => {
        await it('passes a bundle that needs no shim', () => {
            assertNodeBundleGlobalsShimmed('console.log("hi");', 'dist/gjs.node.mjs');
        });

        await it('throws naming the globals, the file and the runtime error', () => {
            let message = '';
            try {
                assertNodeBundleGlobalsShimmed('const G = imports.gi.GLib; print(G);', 'dist/gjs.node.mjs');
            } catch (err) {
                message = (err as Error).message;
            }
            expect(message).toContain('dist/gjs.node.mjs');
            expect(message).toContain('imports');
            expect(message).toContain('print');
            expect(message).toContain('ReferenceError');
            expect(message).toContain('@gjsify/node-gi/globals');
        });
    });
};
