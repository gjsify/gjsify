// SPDX-License-Identifier: MIT
// The runtime a `.app` carries: found by name, staged as a TREE.
//
// TWO CLAIMS, and the second is the one this milestone turns on.
//
//   1. A stranger's project finds all three pieces by NAME. Same contract
//      `node-runtime.spec.ts` holds up for the interpreter, and the same reason
//      every fixture below is a throwaway consumer holding one or two packages
//      and nothing of gjsify: a test run inside this monorepo cannot tell "the
//      resolution works" from "the files happened to be sitting next to it".
//
//   2. The staged closure keeps its shape. Every relation inside a relocated GTK
//      bundle is RELATIVE — `@loader_path/<leaf>` install names, the addon's
//      `@rpath` of `@loader_path/gtk/lib`, `loaders.cache` addressing each
//      decoder `@loader_path/../../..` from the bundle toplevel — so it survives
//      a copy exactly as long as the copy preserves the tree. The control for
//      that claim is in this file too: the SAME three inputs routed through
//      `gjsify.ship.bundledTypelibs` collapse into one directory. Without that
//      control, "the tree is preserved" is a sentence about code nobody compared
//      to the alternative it was written to avoid.
//
// Everything resolves a DARWIN target from whatever host runs this, and one case
// resolves `win32-x64`, for the reason ADR 0024 § A1 gives: assembly is not
// host-bound, so nothing here may key on `process.platform`.

import { describe, expect, it } from '@gjsify/unit';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    appRuntimePaths,
    gtkRuntimePackageName,
    resolveNodeGiPackage,
    isGtkRuntimeTarget,
    resolveGtkRuntime,
    resolveNodeGiAddon,
    stageAppRuntime,
    GTK_RUNTIME_TARGETS,
    NODE_GI_ADDON_FILENAME,
    type GtkRuntimeTarget,
} from './app-runtime.js';
import { LAYOUTS } from './layout.js';
import { planStage } from './plan.js';
import type { ShipSettings } from './types.js';

const IDENTITY = { binaryName: 'ship-demo', name: 'Ship Demo', appId: 'org.example.ShipDemo' };

/** A scratch directory that the caller is responsible for removing. */
function scratch(tag: string): string {
    return mkdtempSync(join(tmpdir(), `gjsify-app-runtime-${tag}-`));
}

/** Write a file, creating everything above it. */
function put(root: string, rel: string, text: string): string {
    const path = join(root, ...rel.split('/'));
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, text);
    return path;
}

/**
 * A relocated GTK closure, in miniature.
 *
 * The five files are not decoration — each is one of the relations the tree has
 * to preserve: a dylib in the loadable-code directory, a typelib in the directory
 * node-gi probes for, a pixbuf decoder four levels down beside the cache that
 * names it relatively, an extensionless program under `libexec/`, and a data file
 * under `share/`.
 */
const CLOSURE_FILES = [
    'lib/libgtk-4.1.dylib',
    'lib/gdk-pixbuf-2.0/2.10.0/loaders/libpixbufloader-svg.so',
    'lib/gdk-pixbuf-2.0/2.10.0/loaders.cache',
    'girepository-1.0/Gtk-4.0.typelib',
    'libexec/gstreamer-1.0/gst-plugin-scanner',
    'share/glib-2.0/schemas/gschemas.compiled',
    'manifest.json',
];

function writeClosure(dir: string, { complete = true } = {}): string {
    for (const rel of CLOSURE_FILES) {
        if (!complete && rel.startsWith('girepository-1.0/')) continue;
        put(dir, rel, `bytes of ${rel}`);
    }
    return dir;
}

/** A consumer tree holding `@gjsify/gtk-runtime-<target>` and nothing else. */
function consumerWithGtkPackage(target: GtkRuntimeTarget, { populate = true } = {}): string {
    const root = scratch('gtk-pkg');
    const dir = join(root, 'node_modules', '@gjsify', `gtk-runtime-${target}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({ name: gtkRuntimePackageName(target), version: '0.44.0', type: 'module', main: './index.js' }),
    );
    writeFileSync(join(dir, 'index.js'), 'export default {};\n');
    if (populate) {
        const nativeSubdir = target.startsWith('win32-') ? 'bin' : 'lib';
        for (const rel of CLOSURE_FILES) {
            put(join(dir, 'gtk'), rel.startsWith('lib/') ? `${nativeSubdir}/${rel.slice(4)}` : rel, 'x');
        }
    }
    return root;
}

/**
 * A consumer tree holding `@gjsify/node-gi` with a staged prebuild.
 *
 * `prebuilds/<target>/{node_gi.node, gtk/}` is node-gi's OWN sibling layout, and
 * it is what `.github/workflows/node-gi.yml`'s macOS legs assemble by hand before
 * every conformance run — so a job that prepared node-gi for a conformance run has
 * by that act prepared it for a ship run.
 */
function consumerWithNodeGi(target: GtkRuntimeTarget, { addon = true, closure = true } = {}): string {
    const root = scratch('node-gi');
    const dir = join(root, 'node_modules', '@gjsify', 'node-gi');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({ name: '@gjsify/node-gi', version: '0.44.0', type: 'module', main: './index.js' }),
    );
    writeFileSync(join(dir, 'index.js'), 'export default {};\n');
    // The JAVASCRIPT half, in the shape the staging rule selects from: the root
    // `.js` every `exports` target is, `overrides/` which `gi.js` loads at runtime,
    // and the build inputs a `.app` never runs.
    writeFileSync(join(dir, 'gi.js'), 'export const requireGi = () => {};\n');
    writeFileSync(join(dir, 'index.d.ts'), 'export {};\n');
    writeFileSync(join(dir, 'binding.gyp'), '{}\n');
    put(dir, 'overrides/Gtk-4.0.js', 'export default {};');
    put(dir, 'src/node_gi.cc', '// C++');
    if (addon) put(dir, `prebuilds/${target}/${NODE_GI_ADDON_FILENAME}`, 'the addon');
    if (closure) writeClosure(join(dir, 'prebuilds', target, 'gtk'));
    return root;
}

/** The minimum `ShipSettings` `planStage` reads — the CONTROL for the flattening claim. */
function planSettings(typelibFiles: string[]): ShipSettings {
    return {
        binaryName: IDENTITY.binaryName,
        appId: IDENTITY.appId,
        name: IDENTITY.name,
        kind: 'cli',
        bundleDir: '/bundle',
        typelibFiles,
        schemaFiles: [],
        iconFiles: [],
        localeFiles: [],
        fontFiles: [],
        mimeTypes: [],
        extraFiles: {},
    } as unknown as ShipSettings;
}

export default async () => {
    await describe('GTK_RUNTIME_TARGETS', async () => {
        await it("is node-gi's own three, and linux is absent on purpose", async () => {
            // Linux takes GTK from the distribution — `DEFAULT_GTK_PREFERENCE` in
            // `gtk-runtime.js` states it per OS precisely so that a future Linux
            // bundle cannot silently flip an existing platform's behaviour.
            expect([...GTK_RUNTIME_TARGETS]).toStrictEqual(['darwin-arm64', 'darwin-x64', 'win32-x64']);
            expect(isGtkRuntimeTarget('linux-x64')).toBe(false);
            expect(gtkRuntimePackageName('darwin-arm64')).toBe('@gjsify/gtk-runtime-darwin-arm64');
        });
    });

    await describe('resolveGtkRuntime', async () => {
        await it('finds the closure BY NAME in a project that declares no gjsify dependency', async () => {
            const cwd = consumerWithGtkPackage('darwin-arm64');
            try {
                const found = resolveGtkRuntime('darwin-arm64', { cwd, env: {} });
                expect(found?.source).toBe('@gjsify/gtk-runtime-darwin-arm64');
                expect(found?.libDir.endsWith(join('gtk', 'lib'))).toBe(true);
                expect(found?.typelibDir.endsWith(join('gtk', 'girepository-1.0'))).toBe(true);
            } finally {
                rmSync(cwd, { recursive: true, force: true });
            }
        });

        await it('probes `bin/` for a win32 target, from THIS host', async () => {
            // The loadable-code directory's NAME differs per target and its ROLE
            // does not (`gtk-runtime.js`'s `nativeSubdir`). Read off the TARGET:
            // a `process.platform` test here would make every Windows assembly on
            // Linux report a missing closure that is sitting right there.
            const cwd = consumerWithGtkPackage('win32-x64');
            try {
                const found = resolveGtkRuntime('win32-x64', { cwd, env: {} });
                expect(found?.libDir.endsWith(join('gtk', 'bin'))).toBe(true);
            } finally {
                rmSync(cwd, { recursive: true, force: true });
            }
        });

        await it("prefers node-gi's staged prebuild — the layout CI already assembles", async () => {
            const cwd = consumerWithNodeGi('darwin-arm64');
            try {
                const found = resolveGtkRuntime('darwin-arm64', { cwd, env: {} });
                expect(found?.source).toBe('@gjsify/node-gi/prebuilds/darwin-arm64');
            } finally {
                rmSync(cwd, { recursive: true, force: true });
            }
        });

        await it('refuses a directory with no typelibs, and keeps looking', async () => {
            // node-gi's own probe, restated rather than weakened. A directory that
            // passes here and fails there is a `.app` that ships the whole closure
            // and still cannot open a window — and it would pass every structural
            // check this pipeline has.
            const cwd = consumerWithGtkPackage('darwin-arm64');
            const half = writeClosure(scratch('half'), { complete: false });
            try {
                const found = resolveGtkRuntime('darwin-arm64', { cwd, env: { GJSIFY_GTK_RUNTIME: half } });
                expect(found?.source).toBe('@gjsify/gtk-runtime-darwin-arm64');
            } finally {
                rmSync(cwd, { recursive: true, force: true });
                rmSync(half, { recursive: true, force: true });
            }
        });

        await it('lets GJSIFY_GTK_RUNTIME win — the same precedence node-gi gives it', async () => {
            const cwd = consumerWithGtkPackage('darwin-arm64');
            const override = writeClosure(scratch('override'));
            try {
                const found = resolveGtkRuntime('darwin-arm64', { cwd, env: { GJSIFY_GTK_RUNTIME: override } });
                expect(found?.source).toBe('GJSIFY_GTK_RUNTIME');
                expect(found?.dir).toBe(override);
            } finally {
                rmSync(cwd, { recursive: true, force: true });
                rmSync(override, { recursive: true, force: true });
            }
        });

        await it('returns null, never throws, when nothing is installed', async () => {
            const cwd = scratch('empty');
            try {
                expect(resolveGtkRuntime('darwin-x64', { cwd, env: {} })).toBe(null);
            } finally {
                rmSync(cwd, { recursive: true, force: true });
            }
        });
    });

    await describe('resolveNodeGiAddon', async () => {
        await it("reaches a FOREIGN target's binary out of the one installed package", async () => {
            // `@gjsify/node-gi` publishes `prebuilds/` for all five of its
            // platforms in ONE package, which is why a Linux host can stage a
            // darwin addon at all — and why this needs no override of its own.
            const cwd = consumerWithNodeGi('darwin-arm64');
            try {
                const found = resolveNodeGiAddon('darwin-arm64', { cwd, env: {} });
                expect(found?.source).toBe('@gjsify/node-gi');
                expect(found?.addonPath.endsWith(join('darwin-arm64', 'node_gi.node'))).toBe(true);
                // The target it was NOT built for is absent, not silently the same file.
                expect(resolveNodeGiAddon('darwin-x64', { cwd, env: {} })).toBe(null);
            } finally {
                rmSync(cwd, { recursive: true, force: true });
            }
        });

        await it('returns null when the package is installed but its prebuilds are not', async () => {
            // What a checkout of this repository looks like: `prebuilds/` is
            // gitignored and staged by CI.
            const cwd = consumerWithNodeGi('darwin-arm64', { addon: false, closure: false });
            try {
                expect(resolveNodeGiAddon('darwin-arm64', { cwd, env: {} })).toBe(null);
            } finally {
                rmSync(cwd, { recursive: true, force: true });
            }
        });
    });

    await describe("the runtime's global cache is not the project", async () => {
        // THE DEFECT THIS FORECLOSES, measured rather than imagined. Under Bun,
        // `createRequire(<anchor>).resolve('@gjsify/node-gi')` falls back to the
        // global install cache instead of throwing, so a project with a
        // `package.json` and no `node_modules` — a fresh clone, or any project
        // using Bun's auto-install — resolves a package it never declared:
        //
        //   node 24.19.0  →  MODULE_NOT_FOUND
        //   bun 1.3.14    →  ~/.bun/install/cache/@gjsify/node-gi@0.44.0@@@1/index.js
        //
        // That answer would have been STAGED: `prebuilds/darwin-arm64/node_gi.node`
        // exists in the published tarball, so the addon lands in a redistributed
        // `.app` at whatever version that machine happened to cache, while the
        // "install `@gjsify/node-gi`" line that should have printed does not. It is
        // also #910's shape — an addon paired with a closure it was not built
        // against. Caught on this PR's own CI: `Test CLI on Bun` failed with
        // `Actual: Ship Demo.app/…/prebuilds/darwin-arm64/node_gi.node`.
        //
        // Simulated through the seam rather than by running Bun, so the guard reds
        // on every runtime instead of only on the one that has the defect.
        // A REAL directory, populated like the published tarball. The first cut of
        // this used a plausible-looking string (`/home/u/.bun/install/cache/…`) and
        // was VACUOUS on Node: `resolveNodeGiAddon` stats the addon before staging
        // it, a path that does not exist answers `null`, and the case passed with
        // the guard removed. Watched red on both runtimes now — see the PR body.
        const cache = () => {
            const dir = scratch('bun-cache-store');
            mkdirSync(join(dir, 'prebuilds', 'darwin-arm64'), { recursive: true });
            writeFileSync(join(dir, 'index.js'), 'export default {};\n');
            writeFileSync(join(dir, 'prebuilds', 'darwin-arm64', NODE_GI_ADDON_FILENAME), 'the cached addon');
            return dir;
        };

        await it('refuses a hit that a directory inside NO project answers identically', async () => {
            const cwd = scratch('bun-cache');
            const cached = cache();
            const cachePath = join(cached, 'index.js');
            try {
                const staged = stageAppRuntime({
                    layout: LAYOUTS.darwin,
                    identity: IDENTITY,
                    target: 'darwin-arm64',
                    cwd,
                    interpreter: null,
                    // Bun: the same path from the project and from nowhere.
                    resolve: (specifier) => (specifier === '@gjsify/node-gi' ? cachePath : null),
                });
                expect(staged.launcher.nodeGiAddon).toBe(undefined);
                expect(staged.files).toStrictEqual([]);
                // And the author is TOLD, which is the whole point of refusing it.
                expect(staged.missing.some((line) => line.includes('@gjsify/node-gi'))).toBe(true);
            } finally {
                rmSync(cwd, { recursive: true, force: true });
                rmSync(cached, { recursive: true, force: true });
            }
        });

        await it('keeps a hit the project answers differently from nowhere', async () => {
            // The other direction, so the guard cannot pass by refusing everything:
            // a package really installed under the project resolves to a path the
            // control anchor does not produce, and is used exactly as before.
            const cwd = consumerWithNodeGi('darwin-arm64');
            const installed = join(cwd, 'node_modules', '@gjsify', 'node-gi', 'index.js');
            const cached = cache();
            const cachePath = join(cached, 'index.js');
            try {
                const found = resolveNodeGiAddon('darwin-arm64', {
                    cwd,
                    env: {},
                    resolve: (specifier, anchor) =>
                        specifier === '@gjsify/node-gi' ? (anchor === 'project' ? installed : cachePath) : null,
                });
                expect(found?.addonPath.endsWith(join('darwin-arm64', 'node_gi.node'))).toBe(true);
                // From the PROJECT, not the cache — both hold a `node_gi.node`, so
                // the leaf name alone would not tell them apart.
                expect(found?.addonPath.startsWith(cwd)).toBe(true);
            } finally {
                rmSync(cwd, { recursive: true, force: true });
                rmSync(cached, { recursive: true, force: true });
            }
        });
    });

    await describe('appRuntimePaths', async () => {
        await it("reproduces node-gi's sibling layout inside Contents/Frameworks", async () => {
            const paths = appRuntimePaths(LAYOUTS.darwin, IDENTITY, 'darwin-arm64');
            expect(paths.gtkDir).toBe('Ship Demo.app/Contents/Frameworks/node-gi/prebuilds/darwin-arm64/gtk');
            // SIBLINGS, and that is the addon's `@rpath` — `@loader_path/gtk/lib`
            // resolves from the addon's own directory, so anything that separated
            // these two would break the link with both files present.
            expect(paths.addonPath).toBe(
                'Ship Demo.app/Contents/Frameworks/node-gi/prebuilds/darwin-arm64/node_gi.node',
            );
            expect(paths.interpreterPath).toBe('Ship Demo.app/Contents/MacOS/node');
            expect(paths.interpreterLicensePath).toBe('Ship Demo.app/Contents/Resources/share/licenses/node/LICENSE');
            // Where Node's own resolver looks FIRST from the staged bundle at
            // `Contents/Resources/lib/<bundle>.mjs`. A `--app node` bundle keeps
            // `@gjsify/node-gi/*` external, so this directory is what makes
            // `require('@gjsify/node-gi/gi')` resolve inside a downloaded `.app`.
            expect(paths.nodeGiPackageDir).toBe('Ship Demo.app/Contents/Resources/lib/node_modules/@gjsify/node-gi');
        });
    });

    await describe('resolveNodeGiPackage', async () => {
        await it('selects what a bundle can REACH, not what npm publishes', async () => {
            // `files` in node-gi's manifest also lists `src/`, `binding.gyp` and
            // `scripts/install.mjs` — inputs to `node-gyp`, which a `.app` never
            // runs — plus `.d.ts` declarations nothing inside a bundle compiles
            // against, plus `prebuilds/`, which is staged into `Contents/Frameworks`
            // where a `.app` keeps loadable code.
            const cwd = consumerWithNodeGi('darwin-arm64');
            try {
                const found = resolveNodeGiPackage({ cwd, env: {} });
                expect(found?.files).toStrictEqual(['gi.js', 'index.js', 'overrides/Gtk-4.0.js', 'package.json']);
            } finally {
                rmSync(cwd, { recursive: true, force: true });
            }
        });

        await it('returns null for a package root with no `.js` at all', async () => {
            // A directory that resolved and a runtime this rule cannot copy. Staging
            // it would produce a `.app` that fails at `require` with node-gi's name
            // in the message and nothing an author can act on; the `null` turns that
            // into a line naming the package before anything is written.
            //
            // The fixture's entry is `.mjs` ON PURPOSE, and not to be tidy: the
            // package has to RESOLVE for this branch to be reachable at all, and a
            // package that resolves through a `.js` main already has the one file the
            // floor tests for. `.mjs` is the shape that resolves and copies to
            // nothing — and it is the shape node-gi would have if it ever renamed its
            // entry points, which `tests/e2e/ship-macos`'s exports-map gate would
            // catch first and this would catch second.
            const root = scratch('js-less');
            const dir = join(root, 'node_modules', '@gjsify', 'node-gi');
            mkdirSync(dir, { recursive: true });
            writeFileSync(
                join(dir, 'package.json'),
                JSON.stringify({ name: '@gjsify/node-gi', version: '0.44.0', type: 'module', main: './index.mjs' }),
            );
            writeFileSync(join(dir, 'index.mjs'), 'export default {};\n');
            try {
                expect(resolveNodeGiPackage({ cwd: root, env: {} })).toBe(null);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });
    });

    await describe('stageAppRuntime', async () => {
        await it('preserves the closure tree — every path, at its own depth', async () => {
            const cwd = consumerWithNodeGi('darwin-arm64');
            const nodeBin = scratch('node-bin');
            try {
                writeFileSync(join(nodeBin, 'node'), 'the interpreter');
                writeFileSync(join(nodeBin, 'LICENSE'), 'Node.js is licensed for use as follows:\n');
                const staged = stageAppRuntime({
                    layout: LAYOUTS.darwin,
                    identity: IDENTITY,
                    target: 'darwin-arm64',
                    cwd,
                    interpreter: {
                        source: 'GJSIFY_NODE_RUNTIME',
                        nodePath: join(nodeBin, 'node'),
                        licensePath: join(nodeBin, 'LICENSE'),
                    },
                });
                const under = 'Ship Demo.app/Contents/Frameworks/node-gi/prebuilds/darwin-arm64/gtk';
                const paths = staged.files.map((file) => file.path);
                for (const rel of CLOSURE_FILES) expect(paths.includes(`${under}/${rel}`)).toBe(true);
                // The one whose depth is load-bearing, spelled out: `loaders.cache`
                // names this file `@loader_path/../../..`-relative, so three levels
                // of directory ARE the reference.
                expect(paths.includes(`${under}/lib/gdk-pixbuf-2.0/2.10.0/loaders/libpixbufloader-svg.so`)).toBe(true);
                expect(paths.includes('Ship Demo.app/Contents/MacOS/node')).toBe(true);
                expect(paths.includes('Ship Demo.app/Contents/Resources/share/licenses/node/LICENSE')).toBe(true);
                // The JavaScript the staged bundle `require`s by name, where Node's
                // own resolver looks for it.
                expect(paths.includes('Ship Demo.app/Contents/Resources/lib/node_modules/@gjsify/node-gi/gi.js')).toBe(
                    true,
                );
                expect(
                    paths.includes(
                        'Ship Demo.app/Contents/Resources/lib/node_modules/@gjsify/node-gi/overrides/Gtk-4.0.js',
                    ),
                ).toBe(true);
                expect(staged.missing).toStrictEqual([]);
            } finally {
                rmSync(cwd, { recursive: true, force: true });
                rmSync(nodeBin, { recursive: true, force: true });
            }
        });

        await it('CONTROL: the same three files through `bundledTypelibs` collapse into one directory', async () => {
            // The measurement that decided this module exists, kept as a test so
            // the decision cannot be "simplified" back into the bug. `plan.ts`
            // stages a bundled typelib as `posix.join(libDir, 'gi', basename(file))`
            // — the BASENAME — while `discoverTypelibs` walks its directory
            // recursively. So depth is discarded, `loaders.cache`'s relative entries
            // point three levels above where the decoders now are, and the result
            // has neither a `lib/` nor a `girepository-1.0/` for
            // `resolveGtkRuntimeBundle()`'s probe to find.
            const planned = planStage(
                planSettings([
                    '/src/gtk/lib/gdk-pixbuf-2.0/2.10.0/loaders/libpixbufloader-svg.so',
                    '/src/gtk/lib/gdk-pixbuf-2.0/2.10.0/loaders.cache',
                    '/src/gtk/girepository-1.0/Gtk-4.0.typelib',
                ]),
                { bundleFiles: [], launcher: '#!/bin/sh\n', metainfo: '<component/>' },
            );
            const gi = planned.map((file) => file.path).filter((path) => path.includes('/gi/'));
            expect(gi).toStrictEqual([
                'lib/ship-demo/gi/Gtk-4.0.typelib',
                'lib/ship-demo/gi/libpixbufloader-svg.so',
                'lib/ship-demo/gi/loaders.cache',
            ]);
        });

        await it("gives the two files that get EXEC'd their executable bit", async () => {
            // A dylib does not need `+x` to be `dlopen`'d, so this is not about
            // loadability. It is about `gst-plugin-scanner`, which GStreamer forks
            // out-of-process, and which has no extension for a name test to catch —
            // and which arrives 0644 whenever the closure crossed an
            // `actions/upload-artifact`, since that stores no POSIX mode at all.
            const cwd = consumerWithNodeGi('darwin-arm64');
            try {
                const staged = stageAppRuntime({
                    layout: LAYOUTS.darwin,
                    identity: IDENTITY,
                    target: 'darwin-arm64',
                    cwd,
                    interpreter: null,
                });
                const mode = (suffix: string) => staged.files.find((file) => file.path.endsWith(suffix))?.mode;
                expect(mode('libexec/gstreamer-1.0/gst-plugin-scanner')).toBe(0o755);
                expect(mode('lib/libgtk-4.1.dylib')).toBe(0o755);
                expect(mode('loaders/libpixbufloader-svg.so')).toBe(0o755);
                expect(mode('prebuilds/darwin-arm64/node_gi.node')).toBe(0o755);
                expect(mode('share/glib-2.0/schemas/gschemas.compiled')).toBe(0o644);
                expect(mode('gtk/manifest.json')).toBe(0o644);
            } finally {
                rmSync(cwd, { recursive: true, force: true });
            }
        });

        await it('stages what it found and NAMES what it did not', async () => {
            // Partial, deliberately. All-or-nothing would drop a closure that IS
            // present because an interpreter that is not shares the milestone with
            // it — at exit 0, over a bundle that is a real, useful intermediate on
            // any machine with a Node.
            const cwd = scratch('nothing');
            try {
                const staged = stageAppRuntime({
                    layout: LAYOUTS.darwin,
                    identity: IDENTITY,
                    target: 'darwin-arm64',
                    cwd,
                    interpreter: null,
                });
                // THE COUNT IS NOT ASSERTED, and that is a fact about the resolver
                // rather than caution. `resolveNpmPackage`'s LAST anchor is the CLI
                // bundle's own `node_modules` chain — which is what makes "only
                // `@gjsify/cli` installed, no gjsify checkout" work — so whether
                // `@gjsify/node-gi` resolves from here is a property of the MACHINE
                // running this suite: `node-gi.yml`'s consumer jobs link it at the
                // workspace root, `main.yml`'s do not. Measured: with that link
                // present this case failed on `missing.length` alone, which is a test
                // reporting on its environment rather than on its subject.
                //
                // What IS asserted is what the fixture controls. The two runtime
                // packages are published and installed nowhere in this tree, so their
                // lines are unconditional; `@gjsify/node-gi` is named either way,
                // because its `prebuilds/` are gitignored and the ADDON is missing
                // even where the JavaScript resolves.
                expect(staged.launcher.interpreter).toBe(undefined);
                expect(staged.launcher.gtkRuntimeDir).toBe(undefined);
                expect(staged.launcher.nodeGiAddon).toBe(undefined);
                expect(staged.files.some((file) => file.path.includes('/prebuilds/'))).toBe(false);
                // Each message names the package to install, because the author
                // reading it has no other way to know which piece is meant.
                expect(staged.missing.some((line) => line.includes('@gjsify/node-runtime-darwin-arm64'))).toBe(true);
                expect(staged.missing.some((line) => line.includes('@gjsify/gtk-runtime-darwin-arm64'))).toBe(true);
                expect(staged.missing.some((line) => line.includes('@gjsify/node-gi'))).toBe(true);
            } finally {
                rmSync(cwd, { recursive: true, force: true });
            }
        });

        await it('names the native subdirectory the RESOLVER probes, per target', async () => {
            // The hint told every reader to build a directory holding `lib/`, while
            // `resolveGtkRuntimeBundle()` probes `bin/` on win32. Measured: a stand-in
            // bundle built to the message's own instructions was refused for
            // `win32-x64` and accepted once `lib/` was renamed to `bin/`. A hint that
            // is wrong costs more than no hint, because the reader follows it first.
            const hint = (target) => {
                const cwd = scratch(`hint-${target}`);
                try {
                    const staged = stageAppRuntime({
                        layout: target.startsWith('win32-') ? LAYOUTS.windows : LAYOUTS.darwin,
                        identity: IDENTITY,
                        target,
                        cwd,
                        interpreter: null,
                    });
                    return staged.missing.find((line) => line.includes('GJSIFY_GTK_RUNTIME')) ?? '';
                } finally {
                    rmSync(cwd, { recursive: true, force: true });
                }
            };

            const windows = hint('win32-x64');
            expect(windows.includes('`bin/`')).toBe(true);
            expect(windows.includes('`lib/`')).toBe(false);

            // The control: the other targets keep `lib/`, so this asserts the value
            // is DERIVED rather than that one literal was swapped for another.
            const darwin = hint('darwin-arm64');
            expect(darwin.includes('`lib/`')).toBe(true);
            expect(darwin.includes('`bin/`')).toBe(false);
        });
    });
};
