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
};
