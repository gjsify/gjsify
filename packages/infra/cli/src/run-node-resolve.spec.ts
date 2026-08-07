// SPDX-License-Identifier: MIT
// Regression coverage for WHERE `@gjsify/node-gi` is resolved from when the CLI
// launches a `--app node` bundle (`runRuntimeBundle` / `runNodeBundle` /
// `gjsify storybook --watch`).
//
// The bug: the probe started at `process.cwd()`. `@gjsify/node-gi` is kept
// EXTERNAL by the bundler, so the thing that actually has to succeed is the
// RUNTIME's resolution of a bare specifier from inside the bundle — which Node
// performs relative to the importing FILE. A `gi://` showcase launched out of
// the dlx cache (`~/.cache/gjsify/dlx/<sha>/node_modules/<pkg>/dist/bundle.mjs`)
// has node-gi sitting right beside the bundle and nothing under the user's cwd,
// so the check refused a run that would have worked. It surfaced as an
// actionable message rather than a crash, which is why it survived.
//
// Fix: bundle dir first, cwd kept as a fallback (a project-local node_modules
// legitimately covers a bundle written outside the project, e.g.
// `--outfile /tmp/x.mjs`).

import { describe, expect, it } from '@gjsify/unit';
import { resolveNodeGi, resolveNodeGiForBundle } from './utils/run-node.js';
import { computeNativeEnvForBundle } from './utils/run-gjs.js';
import { libraryPathVar } from './utils/detect-native-packages.js';
import { systemGiLibraryDirs } from './utils/system-gi.js';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Lay down `<root>/node_modules/@gjsify/node-gi/package.json`. */
function installNodeGi(root: string): string {
    const dir = join(root, 'node_modules', '@gjsify', 'node-gi');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@gjsify/node-gi', version: '0.0.0' }));
    return dir;
}

/** Create `<root>/<relDir>/bundle.mjs` and return its path. */
function makeBundle(root: string, relDir: string): string {
    const dir = join(root, relDir);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'bundle.mjs');
    writeFileSync(file, "import 'gi://Gtk?version=4.0';\n");
    return file;
}

export default async () => {
    await describe('run-node: resolveNodeGiForBundle', async () => {
        await it('finds node-gi next to the bundle when the CWD cannot see it', () => {
            // The dlx-cache shape: the bundle is nested inside a package under a
            // cache root that owns the node_modules; the user runs from anywhere.
            const cacheRoot = mkdtempSync(join(tmpdir(), 'gjsify-run-node-cache-'));
            const strangerCwd = mkdtempSync(join(tmpdir(), 'gjsify-run-node-cwd-'));
            installNodeGi(cacheRoot);
            const bundle = makeBundle(cacheRoot, join('node_modules', '@gjsify', 'example-x', 'dist'));

            expect(resolveNodeGi(strangerCwd)).toBe(null); // the pre-fix probe
            expect(resolveNodeGiForBundle(bundle, strangerCwd)).not.toBe(null);

            rmSync(cacheRoot, { recursive: true, force: true });
            rmSync(strangerCwd, { recursive: true, force: true });
        });

        await it('still honours the CWD when the bundle dir cannot see node-gi', () => {
            // `gjsify build … --outfile /tmp/out/bundle.mjs` run from a project
            // root: the project's node_modules is the only install there is.
            const projectRoot = mkdtempSync(join(tmpdir(), 'gjsify-run-node-project-'));
            const outsideRoot = mkdtempSync(join(tmpdir(), 'gjsify-run-node-outside-'));
            installNodeGi(projectRoot);
            const bundle = makeBundle(outsideRoot, 'out');

            expect(resolveNodeGiForBundle(bundle, projectRoot)).not.toBe(null);

            rmSync(projectRoot, { recursive: true, force: true });
            rmSync(outsideRoot, { recursive: true, force: true });
        });

        await it('returns null when neither base can see node-gi', () => {
            const a = mkdtempSync(join(tmpdir(), 'gjsify-run-node-a-'));
            const b = mkdtempSync(join(tmpdir(), 'gjsify-run-node-b-'));
            const bundle = makeBundle(a, 'dist');

            expect(resolveNodeGiForBundle(bundle, b)).toBe(null);

            rmSync(a, { recursive: true, force: true });
            rmSync(b, { recursive: true, force: true });
        });

        await it('accepts a relative bundle path (resolved against the process CWD)', () => {
            const root = mkdtempSync(join(tmpdir(), 'gjsify-run-node-rel-'));
            installNodeGi(root);
            makeBundle(root, 'dist');
            const previous = process.cwd();
            process.chdir(root);
            try {
                expect(resolveNodeGiForBundle('dist/bundle.mjs', root)).not.toBe(null);
            } finally {
                process.chdir(previous);
            }
            rmSync(root, { recursive: true, force: true });
        });
    });

    // The `$ …` echo both launchers print above the child. It exists so a user
    // can copy the line and reproduce the run without the wrapper, which only
    // works if the line is the command — plus whatever the CLI genuinely
    // changed, and nothing else.
    await describe('computeNativeEnvForBundle: the $ … echo', async () => {
        // The variable `buildNativeEnv` writes back is host-dependent, and on
        // win32 it is `PATH` — never empty, which is what made this visible
        // there and invisible on Linux.
        const libVar = libraryPathVar(process.platform).name;

        await it('reports NOTHING BUT what the CLI actually changed', () => {
            // Two directories with no node_modules at all, so no prebuild dir
            // is prepended to anything.
            //
            // "Nothing to prepend" is NOT the same as "nothing to report", and
            // spelling it that way was a Linux answer wearing a universal
            // one's clothes. `buildNativeEnv` also repairs the HOST's own GI
            // libdirs on darwin — deliberately, and deliberately even when the
            // package set is empty, because that gap is in dyld and not in a
            // gjsify prebuild. So on a Mac with a system GTK the echo has one
            // legitimate entry, and asserting an empty string there fails a
            // launcher that is doing exactly what it documents.
            //
            // Keyed on the CAPABILITY, never on `process.platform`: a Mac with
            // no GI stack installed produces an empty prefix and must still
            // pass, and if `systemGiLibraryDirs()` ever answers on another OS
            // this row follows without being edited.
            const a = mkdtempSync(join(tmpdir(), 'gjsify-env-echo-a-'));
            const b = mkdtempSync(join(tmpdir(), 'gjsify-env-echo-b-'));
            const bundle = makeBundle(a, 'dist');

            const inherited = {
                [libVar]: 'C:\\Windows\\system32;C:\\Program Files\\nodejs',
                GI_TYPELIB_PATH: '/usr/lib/girepository-1.0',
            };
            const { envPrefix } = computeNativeEnvForBundle(bundle, b, inherited);

            const systemDirs = systemGiLibraryDirs({ env: inherited });
            if (systemDirs.length === 0) {
                expect(envPrefix).toBe('');
                rmSync(a, { recursive: true, force: true });
                rmSync(b, { recursive: true, force: true });
                return;
            }

            // Asserted as PROPERTIES rather than as a literal, so this row
            // states the contract instead of restating the implementation —
            // a spec that recomputes `buildNativeEnv`'s join order passes for
            // whatever that function does, including for a bug.
            const assignments = envPrefix.trim().split(/\s+/).filter(Boolean);
            expect(assignments.length).toBe(1);

            const [name, value] = [
                assignments[0].slice(0, assignments[0].indexOf('=')),
                assignments[0].slice(assignments[0].indexOf('=') + 1),
            ];
            // The FALLBACK variable, never the override one: pointing the
            // override at a whole system libdir replaces libraries the host
            // already resolved correctly. `buildNativeEnv` documents why.
            expect(name).toBe('DYLD_FALLBACK_LIBRARY_PATH');

            const entries = value.split(':');
            // Every probed libdir is there, `/usr/lib` still terminates the
            // search (setting the variable REPLACES dyld's own default list),
            // and nothing appears twice.
            for (const dir of systemDirs) expect(entries.includes(dir)).toBe(true);
            expect(entries.includes('/usr/lib')).toBe(true);
            expect(entries.length).toBe(new Set(entries).size);
            // The "and nothing else" half: the inherited loader variable must
            // not come back, which is the win32 symptom the next row pins from
            // the other side.
            expect(envPrefix.includes('C:\\Windows')).toBe(false);

            rmSync(a, { recursive: true, force: true });
            rmSync(b, { recursive: true, force: true });
        });

        await it('does not print the host PATH back at the user', () => {
            // The measured win32 symptom: a ~2 kB `Path=…` dump in front of the
            // command, asserting a change the CLI never made. Kept as its own
            // row because the assertion is about the SYMPTOM, not the mechanism.
            const a = mkdtempSync(join(tmpdir(), 'gjsify-env-echo-path-'));
            const bundle = makeBundle(a, 'dist');
            const sentinel = 'SENTINEL-HOST-PATH-ENTRY';

            const { envPrefix } = computeNativeEnvForBundle(bundle, a, { [libVar]: sentinel });
            expect(envPrefix.includes(sentinel)).toBe(false);

            rmSync(a, { recursive: true, force: true });
        });
    });
};
