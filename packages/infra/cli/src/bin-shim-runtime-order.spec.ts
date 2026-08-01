// Which runtime the generated `node_modules/.bin/<name>` shim reaches for.
//
// `buildBinShim` takes `platform` as a parameter, so the darwin branch is
// exercised from a Linux host — the same reason `bin-shim.spec.ts` can assert
// the `DYLD_LIBRARY_PATH` export without a Mac.

import { describe, expect, it } from '@gjsify/unit';

import { buildBinShim } from './commands/install.js';

export default async () => {
    await describe('buildBinShim: runtime preference', async () => {
        await it('prefers the GJS bundle on linux', async () => {
            const sh = buildBinShim('/ws', 'lib/index.js', 'dist/cli.gjs.mjs', [], 'linux');
            // The gjs probe has to come first for the Node-free path to be the
            // default on the platform where it actually works.
            expect(sh.indexOf('command -v gjs') < sh.indexOf('exec node')).toBe(true);
        });

        await it('prefers the Node entry on darwin', async () => {
            const sh = buildBinShim('/ws', 'lib/index.js', 'dist/cli.gjs.mjs', [], 'darwin');
            // No `@gjsify/rolldown-native` prebuild targets darwin, so the gjs
            // branch cannot run `gjsify build` there at all. Preferring it made
            // a cold macOS `build:infra` die at the first `gjsify build
            // --library`; the Node entry has a working engine.
            expect(sh.indexOf('command -v node') < sh.indexOf('exec gjs')).toBe(true);
        });

        await it('prefers the Node entry on win32', async () => {
            const sh = buildBinShim('/ws', 'lib/index.js', 'dist/cli.gjs.mjs', [], 'win32');
            // No prebuilt libgjs exists for Windows, so the gjs probe is dead by
            // construction; leading with it made the git-bash `sh` entry point
            // disagree with the Node-only `.cmd`/`.ps1` companions.
            expect(sh.indexOf('command -v node') < sh.indexOf('exec gjs')).toBe(true);
        });

        await it('keeps a gjs fallback on darwin for a host with no Node', async () => {
            const sh = buildBinShim('/ws', 'lib/index.js', 'dist/cli.gjs.mjs', [], 'darwin');
            // The probe must test the HOST, not just the file, so a Mac with the
            // bundle but no Node still runs every non-build command under gjs
            // instead of exec'ing a binary that is not there.
            expect(sh).toContain('command -v node >/dev/null 2>&1');
            expect(sh).toContain('exec gjs -m "/ws/dist/cli.gjs.mjs"');
        });

        await it('still emits the GJS env preamble on whichever branch runs gjs', async () => {
            // The preamble is what puts a prebuild's typelib on GI_TYPELIB_PATH;
            // moving the gjs branch to the bottom must not drop it.
            const mac = buildBinShim('/ws', 'lib/index.js', 'dist/cli.gjs.mjs', [], 'darwin');
            expect(mac).toContain('GI_TYPELIB_PATH');
            expect(mac).toContain('DYLD_LIBRARY_PATH');
        });

        await it('is unchanged when only one runtime target exists', async () => {
            expect(buildBinShim('/ws', 'lib/index.js', undefined, [], 'darwin')).toBe(
                '#!/bin/sh\nexec node "/ws/lib/index.js" "$@"\n',
            );
            expect(buildBinShim('/ws', undefined, 'dist/cli.gjs.mjs', [], 'darwin')).toContain(
                'exec gjs -m "/ws/dist/cli.gjs.mjs"',
            );
        });
    });
};
