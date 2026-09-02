// SPDX-License-Identifier: MIT
// What the three launcher forms do with the project's own `execArgs`.
//
// The SHAPE of each launcher is asserted against a real staged tree in
// `tests/e2e/ship-layout` — a rendered string compared with a rendered string
// proves nothing about what got written. What that suite cannot see is the
// argument path: `gjsify.ship.execArgs` is empty in every fixture, and the two
// quoting rules disagree in a way that is silent rather than loud. A `%` reaches
// `cmd.exe` as an expansion and the argument arrives EMPTY; a `'` reaches
// `/bin/sh` unquoted and the argument splits.

import { describe, expect, it } from '@gjsify/unit';

import { appRuntimePaths } from './app-runtime.js';
import { renderLauncher } from './launcher.js';
import { LAYOUTS } from './layout.js';
import type { ShipSettings } from './types.js';

/** What `stageAppRuntime` hands the launcher when all three pieces were staged. */
const carried = (layout: (typeof LAYOUTS)[keyof typeof LAYOUTS], target: 'darwin-arm64' | 'win32-x64') => {
    const paths = appRuntimePaths(layout, { binaryName: 'hello', name: 'Hello' }, target);
    return { interpreter: paths.interpreterPath, gtkRuntimeDir: paths.gtkDir, nodeGiAddon: paths.addonPath };
};

const CARRIED = carried(LAYOUTS.darwin, 'darwin-arm64');
const CARRIED_WIN = carried(LAYOUTS.windows, 'win32-x64');

function settings(execArgs: string[]): ShipSettings {
    return {
        projectDir: '/project',
        appId: 'org.example.Hello',
        name: 'Hello',
        binaryName: 'hello',
        version: '1.0.0',
        release: '1',
        maintainer: 'Dev <dev@example.org>',
        summary: 'A demo',
        description: ['A demo'],
        license: 'MIT',
        section: 'gnome',
        group: 'Applications/System',
        kind: 'app',
        mimeTypes: [],
        extraDepends: { deb: [], rpm: [] },
        typelibPackages: {},
        bundlePath: '/project/dist/gjs.js',
        bundleDir: '/project/dist',
        iconFiles: [],
        schemaFiles: [],
        typelibFiles: [],
        localeFiles: [],
        extraFiles: {},
        execArgs,
        outDir: 'ship',
        arch: 'x64',
        layoutOs: 'linux',
        minGjsVersion: '1.86',
        flatpak: {
            runtime: 'org.gnome.Platform',
            runtimeVersion: '50',
            sdk: 'org.gnome.Sdk',
            branch: 'stable',
            sdkExtensions: [],
            appendPath: [],
            finishArgs: [],
            cleanup: [],
        },
    };
}

export default async () => {
    await describe('ship launcher interpreter', async () => {
        await it("execs the payload's own runtime on every layout", () => {
            // This fixture's target resolves to `gjs` (`resolveShipApp`), so `gjs -m`
            // is the only interpreter that can read what is staged. ADR 0024 § 4's
            // Node answer is about a SHIPPED ARTIFACT and arrives with #1354 M0's
            // bundled interpreter; naming it here put `exec node` in front of a
            // bundle whose first line is `import Gtk from 'gi://Gtk?version=4.0'`.
            const sh = renderLauncher(settings([]), 'gjs.js', LAYOUTS.darwin);
            expect(sh.includes('exec gjs -m "$contents/Resources/lib/gjs.js" "$@"')).toBe(true);
            const cmd = renderLauncher(settings([]), 'gjs.js', LAYOUTS.windows);
            expect(cmd.includes('gjs -m "%HERE%app\\gjs.js" %*')).toBe(true);
            const linux = renderLauncher(settings([]), 'gjs.js', LAYOUTS.linux);
            expect(linux.includes('exec gjs -m "$prefix"/lib/hello/gjs.js "$@"')).toBe(true);
        });
    });

    await describe('ship launcher: the runtime the bundle carries', async () => {
        await it('execs "$here/node" instead of a name macOS cannot resolve', () => {
            // `exec node` is true of a developer's machine and false of a `.app` a
            // stranger downloads: macOS ships no Node at all, so that launcher's
            // first act is `exec: node: not found`. `$here` is `Contents/MacOS`,
            // which the launcher already computes, and the interpreter is staged
            // beside the launcher — so the whole path expression is one segment.
            const node = { ...settings([]), app: 'node' } as ShipSettings;
            const rendered = renderLauncher(node, 'app.node.mjs', LAYOUTS.darwin, CARRIED);
            expect(rendered.includes('exec "$here/node" "$contents/Resources/lib/app.node.mjs" "$@"')).toBe(true);
            // And it is still the BARE NAME when nothing was staged — the M2a tree
            // stays byte-identical rather than becoming differently broken.
            expect(renderLauncher(node, 'app.node.mjs', LAYOUTS.darwin).includes('exec node "$contents/')).toBe(true);
        });

        await it('exports the two locators node-gi resolves the bundle with', () => {
            // `GJSIFY_GTK_RUNTIME` is candidate 1 of `resolveGtkRuntimeBundle()`'s
            // four; candidates 2–4 walk `@gjsify/node-gi`'s package directory or
            // `node_modules`, and a shipped `.app` has neither — its JavaScript is
            // one bundled file, so those probes land beside the bundle.
            // `NODE_GI_NATIVE` is the same problem for the addon, and an absolute
            // path is one of the three values `nativeCandidates()` accepts.
            const node = { ...settings([]), app: 'node' } as ShipSettings;
            const rendered = renderLauncher(node, 'app.node.mjs', LAYOUTS.darwin, CARRIED);
            expect(
                rendered.includes('GJSIFY_GTK_RUNTIME="$contents/Frameworks/node-gi/prebuilds/darwin-arm64/gtk"'),
            ).toBe(true);
            expect(rendered.includes('export GJSIFY_GTK_RUNTIME')).toBe(true);
            expect(
                rendered.includes('NODE_GI_NATIVE="$contents/Frameworks/node-gi/prebuilds/darwin-arm64/node_gi.node"'),
            ).toBe(true);
            expect(rendered.includes('export NODE_GI_NATIVE')).toBe(true);
        });

        await it('names NO DYLD variable, signed or unsigned', () => {
            // The rule and its CORRECT reason: under hardened runtime a
            // Developer-ID-signed main executable is restricted, so dyld strips
            // every `DYLD_*` — a launcher depending on one works unsigned and
            // breaks the day the bundle is signed (#1354 M6, ADR 0024 § A4/§ A16).
            // The variables above are read by node-gi in JS and handed to GI
            // through the binding, so dyld never sees them.
            const node = { ...settings([]), app: 'node' } as ShipSettings;
            expect(renderLauncher(node, 'app.node.mjs', LAYOUTS.darwin, CARRIED).includes('DYLD_')).toBe(false);
        });

        await it('points GI at the libraries the APP carries, not only its typelibs', () => {
            // The macOS half of #1410, which shipped the READER with no writer.
            // GI resolves the typelib and then `g_module_open`s the bare leaf it
            // records; `LD_LIBRARY_PATH` answers that on Linux and nothing dyld
            // reads can answer it in a signed bundle.
            const withTypelibs = { ...settings([]), app: 'node', typelibFiles: ['/p/gi/Foo-1.typelib'] };
            const rendered = renderLauncher(withTypelibs as ShipSettings, 'app.node.mjs', LAYOUTS.darwin, CARRIED);
            expect(rendered.includes('GJSIFY_GI_LIBRARY_PATH="$contents/Frameworks"')).toBe(true);
            expect(rendered.includes('export GJSIFY_GI_LIBRARY_PATH')).toBe(true);
            // Not emitted when the app carries no GI library of its own: an empty
            // entry makes GI search a directory that is not there, forever.
            expect(renderLauncher(settings([]), 'gjs.js', LAYOUTS.darwin).includes('GJSIFY_GI_LIBRARY_PATH')).toBe(
                false,
            );
        });

        await it('runs "%HERE%node.exe" instead of a name Windows cannot resolve', () => {
            // Same fact as the `.app`, harder: Windows ships no Node AND no GJS, so
            // a launcher naming either off `PATH` fails with `'node' is not
            // recognized as an internal or external command`. `%~dp0` already ends
            // in a separator, which is why the token concatenates with none — the
            // dialect difference `readLauncherInterpreters` has to know.
            const node = { ...settings([]), app: 'node' } as ShipSettings;
            const rendered = renderLauncher(node, 'app.node.mjs', LAYOUTS.windows, CARRIED_WIN);
            expect(rendered.includes('"%HERE%node.exe" "%HERE%app\\app.node.mjs" %*')).toBe(true);
            // `.exe`, not `node`: the file staged beside the launcher is the one
            // `@gjsify/node-runtime-win32-x64` carries, and a launcher naming the
            // extensionless spelling would find it only by PATHEXT — from `%HERE%`,
            // which is a path and not a search.
            expect(rendered.includes('"%HERE%node" ')).toBe(false);
        });

        await it('sets the two locators node-gi resolves the bundle with, quoted', () => {
            const node = { ...settings([]), app: 'node' } as ShipSettings;
            const rendered = renderLauncher(node, 'app.node.mjs', LAYOUTS.windows, CARRIED_WIN);
            expect(rendered.includes('set "GJSIFY_GTK_RUNTIME=%HERE%lib\\node-gi\\prebuilds\\win32-x64\\gtk"')).toBe(
                true,
            );
            expect(
                rendered.includes('set "NODE_GI_NATIVE=%HERE%lib\\node-gi\\prebuilds\\win32-x64\\node_gi.node"'),
            ).toBe(true);
        });

        await it('does NOT put the carried closure on PATH — node-gi does that itself', () => {
            // The Windows counterpart of the `.app` form's "no DYLD_*", with the
            // opposite reason and therefore worth a test of its own:
            // `maybePrependGtkRuntimeDllPath()` runs at node-gi's index.js top
            // level, ABOVE `loadNative()`, because Windows re-reads the DLL search
            // path at every `LoadLibrary`. A launcher-set `PATH` would be a second
            // copy of a directory node-gi already derives from `GJSIFY_GTK_RUNTIME`.
            const node = { ...settings([]), app: 'node' } as ShipSettings;
            const rendered = renderLauncher(node, 'app.node.mjs', LAYOUTS.windows, CARRIED_WIN);
            expect(rendered.includes('PATH=%HERE%lib\\node-gi')).toBe(false);
        });

        await it('CRLF, and only CRLF', () => {
            // `cmd.exe` re-seeks a batch file by byte OFFSET while it runs, which is
            // where the documented `goto` and block-parsing failures on LF-only
            // files come from. The runtime lines are new; a lone `\n` among them
            // would be invisible in every string assertion above.
            const node = { ...settings([]), app: 'node' } as ShipSettings;
            const rendered = renderLauncher(node, 'app.node.mjs', LAYOUTS.windows, CARRIED_WIN);
            // BOTH directions: a lone `\n` and a lone `\r`. Removing the pairs first
            // and then asserting only about `\n` would pass on `\r\r\n`, which is
            // the shape a second join would produce.
            const stripped = rendered.replace(/\r\n/g, '');
            expect(stripped.includes('\n')).toBe(false);
            expect(stripped.includes('\r')).toBe(false);
        });

        await it('leaves the Linux launcher byte-identical, runtime or not', () => {
            // A Linux package declares `Depends: nodejs` and takes the
            // distribution's. Carrying a second interpreter there would be a
            // private one no security update ever reaches — so the extra argument
            // has to be inert on that form, not merely unused by the caller.
            const node = { ...settings([]), app: 'node' } as ShipSettings;
            expect(renderLauncher(node, 'app.node.mjs', LAYOUTS.linux, CARRIED)).toBe(
                renderLauncher(node, 'app.node.mjs', LAYOUTS.linux),
            );
        });
    });

    await describe('ship launcher arguments', async () => {
        await it('single-quotes for /bin/sh, on both POSIX layouts', () => {
            const args = ["it's", '--flag=a b'];
            for (const layout of [LAYOUTS.linux, LAYOUTS.darwin]) {
                const rendered = renderLauncher(settings(args), 'gjs.js', layout);
                expect(rendered.includes(`'it'\\''s' '--flag=a b'`)).toBe(true);
            }
        });

        await it('double-quotes for cmd.exe', () => {
            const rendered = renderLauncher(settings(['--flag=a b']), 'gjs.js', LAYOUTS.windows);
            expect(rendered.includes('"--flag=a b"')).toBe(true);
        });

        await it('refuses an argument cmd.exe cannot carry, naming the config key', () => {
            // `%` expands at PARSE time, so `%PATH%` in an execArg does not reach
            // the app as those six characters — it reaches it as the machine's
            // PATH, or as nothing. `"` ends the quoted run with no escape that
            // reliably re-opens it. Both are wrong argv at exit 0, which is why
            // they are refused rather than escaped.
            for (const bad of ['100%', 'say "hi"', 'a!b']) {
                expect(() => renderLauncher(settings([bad]), 'gjs.js', LAYOUTS.windows)).toThrow(
                    'gjsify.ship.execArgs',
                );
            }
            // The same three are ordinary arguments on a POSIX layout.
            for (const bad of ['100%', 'say "hi"', 'a!b']) {
                expect(renderLauncher(settings([bad]), 'gjs.js', LAYOUTS.linux).includes(bad)).toBe(true);
            }
        });
    });
};
