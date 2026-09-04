// E2E: a React Native application bootstrapped by `registerRootComponent` alone is
// reachable over `org.gjsify.Devtools` — and what reaches it is the RENDERED tree,
// not merely a service object (#1455, ADR 0043).
//
// WHY AN EXTERNAL OBSERVER IS THE WHOLE POINT. The application this layer was
// ported for verified 25 routes with an in-process screenshot, because there was no
// way to drive it from outside; on the macOS host the capture hook was measured
// firing BEFORE the route hook, so every route-targeted picture actually showed the
// start screen. An in-process capture photographs what the process believes it drew.
// This suite therefore asserts nothing from inside the fixture: every judgement is a
// DBus round trip made by another process.
//
// WHAT EACH VECTOR PINS, and each one was RED before the fix:
//
//   env    `GJSIFY_DEVTOOLS=1`, no devtools option in the entry file. The service
//          exported here even before the fix — and proved nothing, because the
//          first React commit threw `GtkHostError: No descriptor registered for
//          <GtkBox>` inside `createWindow`, GJS logged and SWALLOWED it (an
//          exception in a GObject handler skips the rest of the handler), so
//          `present()` never ran. One UNMAPPED toplevel, `DumpTree` without a
//          single rendered widget, and `Screenshot` answering `(@ay [],)`: a
//          successful call returning no picture. Hence `mapped`, the widget names
//          and the PNG signature are asserted, and "the interface is there" is not
//          accepted as the answer.
//   option `devtools: true` in `RunApplicationOptions` with `GJSIFY_DEVTOOLS`
//          UNSET, so an export can only have come from the option. `runApplication`
//          forwarded `applicationId` and `css` and dropped everything else, so this
//          vector could not export at all. It is also the only vector a bus-less
//          host (macOS, Windows) can be pointed at, since `devtools.address` rides
//          the same passthrough.
//   routed the SAME bootstrap rendering `<RouterRoot>` instead of a `<View>`, for
//          the one line the other two are structurally blind to:
//          `provideWindowChrome(chrome, …)` in `runApplication`'s render call
//          (#1460, #1540). The outermost navigator takes the window's header bar
//          only if that publish happened, and `useWindowChrome()` answering `null`
//          is an ORDINARY answer — a consumer with their own window publishes
//          nothing — so a lost publish throws nothing and logs nothing. It just
//          draws a second bar with a second set of window controls, of which one
//          close button does nothing.
//
//          MEASURED, by deleting that call and its now-dead import and rebuilding:
//          `oxfmt` clean, `oxlint` 0, `tsc` 0, and `@gjsify/react-native` 2345
//          completed / 0 failed — INCLUDING all ten of #1540's window-chrome
//          vectors, because `router.spec.ts` composes `buildWindowShell()` +
//          `provideWindowChrome()` itself and never runs the bootstrap. `env` and
//          `option` also stayed green: a non-routed tree never asks for the chrome,
//          so it counts one bar either way. Only this vector moved, 1 -> 2.
//
// The click-drive leg is the honest version of "did the screen change": find the
// button in `DumpTree`, `ActivateWidget` it, read the label back. Sequencing from
// outside is what an in-process hook cannot do.
//
// SKIP (no false failures off a capable host): non-Linux, no display, no `gjs`, no
// `dbus-run-session`/`gdbus`, no committed CLI bundle, no `@gjsify/rolldown-native`
// prebuild for the arch, the workspace `node_modules` isn't installed, the packages
// under test are not BUILT, or the host has no loadable `Adw-1` typelib.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prebuildDir } from '../helpers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const CLI_BUNDLE = join(REPO_ROOT, 'packages', 'infra', 'cli', 'dist', 'cli.gjs.mjs');
const ENTRY = join(__dirname, 'entry.ts');
const DRIVER = join(__dirname, 'driver.mjs');

/** The packages the fixture BUNDLES — present is not built (see the skip note). */
const BUILT = ['react-native', 'adwaita-app', 'devtools', 'gtk-host'].map((name) =>
    join(REPO_ROOT, 'packages', 'framework', name, 'lib'),
);

function archDir() {
    if (process.arch === 'x64') return 'linux-x64';
    if (process.arch === 'arm64') return 'linux-arm64';
    return null;
}

function hasCmd(cmd, args = ['--version']) {
    const r = spawnSync(cmd, args, { stdio: 'ignore' });
    return r.status === 0 && r.error === undefined;
}

function hasAdw() {
    const r = spawnSync('gjs', ['-c', 'imports.gi.versions.Adw = "1"; imports.gi.Adw;'], { stdio: 'ignore' });
    return r.status === 0 && r.error === undefined;
}

const arch = archDir();
const PREBUILD = arch ? prebuildDir('infra', 'rolldown-native', arch) : null;

const SKIP =
    process.platform !== 'linux' ||
    !arch ||
    // A GTK window cannot MAP without a display, and `mapped` is the assertion that
    // separates this suite from one proving only that a service object exists. So a
    // display is a precondition — and its absence is why the suite is ledgered in
    // `scripts/e2e-unlisted-suites.mjs` rather than listed in `test:e2e`, where it
    // would be satisfied by going quiet.
    !(process.env.DISPLAY || process.env.WAYLAND_DISPLAY) ||
    !hasCmd('gjs') ||
    !hasCmd('dbus-run-session', ['--help']) ||
    !hasCmd('gdbus', ['--help']) ||
    !existsSync(CLI_BUNDLE) ||
    !PREBUILD ||
    !existsSync(join(PREBUILD, 'GjsifyRolldown-1.0.typelib')) ||
    !existsSync(join(REPO_ROOT, 'node_modules', '@gjsify')) ||
    !existsSync(join(REPO_ROOT, 'node_modules', 'react')) ||
    !existsSync(join(REPO_ROOT, 'node_modules', 'rolldown')) ||
    !BUILT.every((dir) => existsSync(dir)) ||
    !hasAdw();

/** One `dbus-run-session` per vector: the app claims a well-known name. */
function measure(bundle, mode) {
    const r = spawnSync('dbus-run-session', ['--', 'node', DRIVER, bundle, mode], {
        encoding: 'utf8',
        timeout: 5 * 60 * 1000,
        maxBuffer: 64 * 1024 * 1024,
    });
    const out = `${r.stdout ?? ''}`;
    const line = out.split('\n').find((l) => l.startsWith('RESULT='));
    assert.ok(line, `the driver must print a RESULT line.\n--- stdout ---\n${out}\n--- stderr ---\n${r.stderr ?? ''}`);
    return JSON.parse(line.slice('RESULT='.length));
}

describe('a React Native root component is reachable over devtools', { skip: SKIP, timeout: 15 * 60 * 1000 }, () => {
    let tmpDir;
    let bundle;

    before(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-rn-devtools-'));
        bundle = join(tmpDir, 'entry.gjs.mjs');
        // The React target's own build flags, per this package's `build:test:gjs`:
        // without them `--globals auto` answers `navigator` and friends with the
        // GTK-backed DOM registers and the bundle grows Gdk/GdkPixbuf/Pango.
        const r = spawnSync(
            'gjs',
            [
                '-m',
                CLI_BUNDLE,
                'build',
                ENTRY,
                '--app',
                'gjs',
                '--outfile',
                bundle,
                '--no-minify',
                '--define',
                "process.env.NODE_ENV='production'",
                '--exclude-globals',
                'navigator',
            ],
            {
                cwd: __dirname,
                encoding: 'utf-8',
                timeout: 8 * 60 * 1000,
                env: {
                    ...process.env,
                    HOME: tmpDir,
                    XDG_CACHE_HOME: join(tmpDir, '.cache'),
                    GI_TYPELIB_PATH: PREBUILD,
                    LD_LIBRARY_PATH: PREBUILD,
                    GJSIFY_BUILD_CACHE: '0',
                },
            },
        );
        const log = `${r.stdout ?? ''}${r.stderr ?? ''}`;
        assert.equal(r.status, 0, `building the React Native fixture must succeed. Output:\n${log}`);
        assert.ok(existsSync(bundle), `fixture bundle must be written. Output:\n${log}`);
    });

    after(() => {
        if (!process.env.GJSIFY_E2E_KEEP_TEMP && tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    });

    for (const mode of ['env', 'option']) {
        it(`exports devtools over a rendered, mapped window (${mode})`, () => {
            const m = measure(bundle, mode);
            const ctx = `\n--- app output (${mode}) ---\n${m.log}`;

            assert.equal(m.onBus, true, `the fixture must register on the session bus.${ctx}`);
            // The export CONFIRMATION out of the app's own stderr: only reachable
            // with devtools enabled, so its absence is the diagnostic. For the
            // `option` vector it is the whole claim — `GJSIFY_DEVTOOLS` is unset.
            assert.match(
                m.log,
                /\[gjsify-devtools\] exported org\.gjsify\.Devtools/,
                `installDevtools must log the successful export.${ctx}`,
            );
            assert.equal(m.iface, true, `org.gjsify.Devtools must be present at the devtools object path.${ctx}`);

            // A window that never mapped is what a swallowed render exception looks
            // like from outside, and it is indistinguishable from a slow start
            // unless it is asserted.
            assert.equal(m.status?.activeWindow?.mapped, true, `the application window must be mapped.${ctx}`);

            // The rendered tree, by the names `testID` wrote onto Gtk.Widget:name.
            assert.ok(m.labelPath, `the <Text> must be in DumpTree.\n${JSON.stringify(m.tree)}${ctx}`);
            assert.ok(m.buttonPath, `the <Pressable> must be in DumpTree.\n${JSON.stringify(m.tree)}${ctx}`);

            // Real pixels of a real window. `Screenshot` on an unmapped window
            // succeeds and returns `(@ay [],)`, so the signature and the size are
            // the assertion, not the exit status of the call.
            assert.equal(m.screenshot?.png, true, `Screenshot must return PNG bytes.${ctx}`);
            // A floor rather than a size: how well a 900x700 Adwaita window
            // compresses depends on the host's theme, so the assertion is only that
            // this is a picture and not a header. An unmapped window answers 0.
            assert.ok(
                m.screenshot.bytes > 1000,
                `a PNG of a window must be more than a header; got ${m.screenshot.bytes} bytes.${ctx}`,
            );

            // Drive it from outside, then read the effect back: the sequencing an
            // in-process hook cannot do, which is why the in-process pictures lied.
            assert.equal(m.labelBefore, 'INITIAL', `the label must start at INITIAL.${ctx}`);
            assert.equal(m.activated, true, `ActivateWidget must activate the button.${ctx}`);
            assert.equal(m.labelAfter, 'PRESSED', `the press must reach React and update the label.${ctx}`);

            // The accessor, read from inside the component tree — the half of #1455
            // that has no DBus surface of its own.
            assert.match(
                m.log,
                /\[probe\] getApplication -> org\.gjsify\.RnDevtoolsProbe/,
                `AppRegistry.getApplication() must answer during render.${ctx}`,
            );
            assert.match(
                m.log,
                /\[probe\] getWindow -> RN Devtools Probe/,
                `AppRegistry.getWindow() must answer during render.${ctx}`,
            );

            // The descriptor class by name: the fixture registers no widget table,
            // so this is what `runApplication` owes it.
            assert.doesNotMatch(m.log, /GtkHostError/, `no GtkHostError may be logged.${ctx}`);
            assert.doesNotMatch(m.log, /JS ERROR/, `no swallowed exception may be logged.${ctx}`);

            // One bar for a NON-routed tree too, and it is the window's own. Stated
            // here so the routed vector's `1` is read as "the navigator took it over"
            // and not as "one is simply what this window has".
            assert.equal(m.headerBars, 1, `a plain root must draw exactly one header bar.${ctx}`);
        });
    }

    it('hands the window chrome to a routed navigator (routed)', () => {
        const m = measure(bundle, 'routed');
        const ctx = `\n--- app output (routed) ---\n${m.log}`;

        assert.equal(m.status?.activeWindow?.mapped, true, `the application window must be mapped.${ctx}`);
        assert.ok(m.labelPath, `the routed screen must render.\n${JSON.stringify(m.tree)}${ctx}`);

        // THE ASSERTION THIS VECTOR EXISTS FOR. Two mapped bars is #1460: the
        // window's own plus the navigation page's, two sets of window controls, and
        // only one of the two close buttons closes the window. Measured 2 with
        // `provideWindowChrome(chrome, …)` deleted from `runApplication`, while
        // format, lint, tsc and all 2345 unit assertions stayed green.
        assert.equal(
            m.headerBars,
            1,
            `a routed application must draw exactly ONE header bar; got ${m.headerBars}. ` +
                `Two means runApplication did not publish the window's chrome to the tree, so the ` +
                `outermost navigator never claimed it.\n${JSON.stringify(m.tree)}${ctx}`,
        );

        assert.equal(m.screenshot?.png, true, `Screenshot must return PNG bytes.${ctx}`);
        assert.doesNotMatch(m.log, /JS ERROR/, `no swallowed exception may be logged.${ctx}`);
    });
});
