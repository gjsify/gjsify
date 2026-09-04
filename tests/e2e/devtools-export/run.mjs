// E2E: @gjsify/devtools exports `org.gjsify.Devtools` over DBus under the same
// app config the PixelRPG maker uses (`HANDLES_COMMAND_LINE` + an app-owned
// sibling object exported first).
//
// Backstory — why this test exists: the maker's running binary showed no
// `org.gjsify.Devtools` object, and it was first (mis)diagnosed as
// `DevtoolsService.export` silently failing under that config. That diagnosis
// rested on a FALSE-POSITIVE presence check: `gdbus introspect <path>/devtools`
// returns a phantom container node (exit 0) even when NOTHING is exported there,
// so "introspect succeeds" ≠ "interface exported". The real signal is (a) a real
// child node under the app's base path, (b) the `org.gjsify.Devtools` INTERFACE
// present at <base>/devtools, and (c) a method CALL returning data. Checked
// rigorously, devtools exports fine in every config — the maker symptom was a
// STALE app bundle (source called installDevtools(), the committed bundle
// predated it). This test locks in the correct export behaviour + the
// installDevtools "exported ..." confirmation log added alongside it.
//
// SKIP (no false failures off a capable host): non-Linux, no `gjs`, no
// `dbus-run-session`, no committed CLI bundle, no `@gjsify/rolldown-native`
// prebuild for the arch, the workspace `node_modules` isn't installed, or the
// host has no loadable `Adw-1` typelib (the fixture is a real Adwaita app).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prebuildDir, requireEnvironment } from '../helpers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const CLI_BUNDLE = join(REPO_ROOT, 'packages', 'infra', 'cli', 'dist', 'cli.gjs.mjs');
const WS_MODULES = join(REPO_ROOT, 'node_modules');
const REPRO_TS = join(__dirname, 'repro.ts');

const DEST = 'org.example.reprotest';
const BASE = '/org/example/reprotest';

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
    // The fixture is a real Adwaita app — RUN needs a loadable Adw-1 typelib.
    const r = spawnSync('gjs', ['-c', 'imports.gi.versions.Adw = "1"; imports.gi.Adw;'], { stdio: 'ignore' });
    return r.status === 0 && r.error === undefined;
}

const arch = archDir();
const PREBUILD = arch ? prebuildDir('infra', 'rolldown-native', arch) : null;

// NAMED, not chained, for `requireEnvironment`'s reason: under `GJSIFY_E2E_REQUIRE=1`
// a host that promised these must say WHICH one it does not have.
const SKIP = requireEnvironment('a session bus and a built workspace', [
    { need: 'linux', ok: process.platform === 'linux' },
    { need: 'a known arch (x64/arm64)', ok: arch !== null },
    { need: 'gjs', ok: () => hasCmd('gjs') },
    { need: 'dbus-run-session', ok: () => hasCmd('dbus-run-session', ['--help']) },
    { need: 'gdbus', ok: () => hasCmd('gdbus', ['--help']) },
    { need: `the committed CLI bundle (${CLI_BUNDLE})`, ok: () => existsSync(CLI_BUNDLE) },
    { need: '@gjsify/rolldown-native for this arch', ok: () => PREBUILD !== null },
    {
        need: 'the GjsifyRolldown typelib',
        ok: () => PREBUILD !== null && existsSync(join(PREBUILD, 'GjsifyRolldown-1.0.typelib')),
    },
    { need: 'node_modules/@gjsify', ok: () => existsSync(join(WS_MODULES, '@gjsify')) },
    { need: 'node_modules/rolldown', ok: () => existsSync(join(WS_MODULES, 'rolldown')) },
    {
        // The package the fixture BUNDLES, not merely one it resolves. Every gate above
        // asks whether the toolchain is present; none asked whether the thing under test
        // is BUILT, so on a tree with `node_modules` but no
        // `packages/framework/devtools/lib` the suite ran and died inside rolldown with
        // `gjsify-unresolved-workspace-import: NotFound("@gjsify/devtools")` — an
        // environment fact reported as a failed assertion about DBus.
        need: 'a built packages/framework/devtools/lib',
        ok: () => existsSync(join(REPO_ROOT, 'packages', 'framework', 'devtools', 'lib')),
    },
    { need: 'a loadable Adw-1 typelib', ok: () => hasAdw() },
]);

// A bash driver run INSIDE a fresh `dbus-run-session` (its own bus → no stale
// well-known-name owner from a prior run). Launches the built fixture, waits for
// it on the bus, then emits machine-readable KEY=value lines the test asserts on.
// $1 = fixture bundle path.
const DRIVER = String.raw`
set -u
BUNDLE="$1"
log="$(mktemp)"
env REPRO_CMDLINE=1 REPRO_SIBLING=1 gjs -m "$BUNDLE" >"$log" 2>&1 &
pid=$!
on_bus=""
for i in $(seq 1 80); do
  if gdbus introspect --session --dest ${DEST} --object-path ${BASE} >/dev/null 2>&1; then on_bus=1; break; fi
  sleep 0.25
done
if [ -z "$on_bus" ]; then
  echo "APP_ON_BUS=no"
  echo "APP_LOG_BEGIN"; cat "$log"; echo "APP_LOG_END"
  kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
  exit 0
fi
echo "APP_ON_BUS=yes"
# (a) real exported child object (NOT the phantom-node false positive)
if gdbus introspect --session --dest ${DEST} --object-path ${BASE} 2>&1 | grep -qE "node devtools"; then
  echo "CHILD_DEVTOOLS=yes"; else echo "CHILD_DEVTOOLS=no"; fi
# (b) the interface actually present at <base>/devtools
if gdbus introspect --session --dest ${DEST} --object-path ${BASE}/devtools 2>&1 | grep -qE "interface org.gjsify.Devtools"; then
  echo "IFACE=yes"; else echo "IFACE=no"; fi
# (c) a SYNC method call returns data
status="$(gdbus call --session --dest ${DEST} --object-path ${BASE}/devtools --method org.gjsify.Devtools.GetStatus 2>&1)"
echo "GETSTATUS_BEGIN"; echo "$status"; echo "GETSTATUS_END"
# (d) the ONLY ASYNC method — regression guard for the gjs 1.86.0 broken
# Promise-return marshaling (see ScreenshotAsync). Returns an (ay) tuple, empty
# here because the fixture maps no window; a plain async method would instead
# fail with org.gnome.gjs.JSError.ValueError "incorrect value type".
shot="$(gdbus call --session --dest ${DEST} --object-path ${BASE}/devtools --method org.gjsify.Devtools.Screenshot "" 2>&1)"
echo "SCREENSHOT_BEGIN"; echo "$shot"; echo "SCREENSHOT_END"
# the installDevtools confirmation log (observability)
if grep -q "gjsify-devtools] exported org.gjsify.Devtools" "$log"; then echo "EXPORT_LOG=yes"; else echo "EXPORT_LOG=no"; fi
grep -q "\[repro\] installDevtools -> service" "$log" && echo "INSTALL_RETURNED=service" || echo "INSTALL_RETURNED=null"
kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
exit 0
`;

function parse(out) {
    const kv = {};
    for (const line of out.split('\n')) {
        const m = line.match(/^([A-Z_]+)=(.*)$/);
        if (m) kv[m[1]] = m[2];
    }
    const status = out.match(/GETSTATUS_BEGIN\n([\s\S]*?)\nGETSTATUS_END/)?.[1] ?? '';
    const screenshot = out.match(/SCREENSHOT_BEGIN\n([\s\S]*?)\nSCREENSHOT_END/)?.[1] ?? '';
    return { kv, status, screenshot };
}

describe('@gjsify/devtools export over DBus', { skip: SKIP, timeout: 5 * 60 * 1000 }, () => {
    let tmpDir;
    let bundle;

    before(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-devtools-'));
        bundle = join(tmpDir, 'repro.gjs.mjs');
        // Build the fixture with the committed Node-free GJS CLI bundle, resolving
        // @gjsify/devtools + @girs/* from the workspace (cwd walks up to REPO_ROOT).
        const r = spawnSync(
            'gjs',
            ['-m', CLI_BUNDLE, 'build', REPRO_TS, '--app', 'gjs', '--outfile', bundle, '--no-minify'],
            {
                cwd: __dirname,
                encoding: 'utf-8',
                timeout: 4 * 60 * 1000,
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
        assert.equal(r.status, 0, `building the devtools fixture must succeed. Output:\n${log}`);
        assert.ok(existsSync(bundle), `fixture bundle must be written. Output:\n${log}`);
    });

    after(() => {
        if (!process.env.GJSIFY_E2E_KEEP_TEMP && tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    });

    it('exports org.gjsify.Devtools under HANDLES_COMMAND_LINE + an app-owned sibling object', () => {
        const r = spawnSync('dbus-run-session', ['--', 'bash', '-c', DRIVER, 'bash', bundle], {
            encoding: 'utf-8',
            timeout: 90 * 1000,
        });
        const out = `${r.stdout ?? ''}`;
        const err = `${r.stderr ?? ''}`;
        const { kv, status, screenshot } = parse(out);
        const ctx = `\n--- driver stdout ---\n${out}\n--- driver stderr (bus noise) ---\n${err}`;

        assert.equal(kv.APP_ON_BUS, 'yes', `the fixture must register on the session bus.${ctx}`);
        assert.equal(kv.INSTALL_RETURNED, 'service', `installDevtools must return a service (not null).${ctx}`);
        // The rigorous presence signals — each defeats the phantom-node false positive.
        assert.equal(kv.CHILD_DEVTOOLS, 'yes', `'devtools' must be a REAL exported child object of ${BASE}.${ctx}`);
        assert.equal(kv.IFACE, 'yes', `org.gjsify.Devtools interface must be present at ${BASE}/devtools.${ctx}`);
        assert.match(status, /"appId":"org\.example\.reprotest"/, `Devtools.GetStatus must return live JSON.${ctx}`);
        // The async method (Screenshot) must marshal its reply — the gjs 1.86.0
        // Promise-return path is broken, so it uses the <Name>Async manual-reply
        // convention. A plain `async` method fails here with JSError.ValueError.
        assert.doesNotMatch(
            screenshot,
            /ValueError|incorrect value type/,
            `Screenshot (async DBus method) must not hit the gjs Promise-return marshaling bug.${ctx}`,
        );
        assert.match(screenshot, /^\(/, `Screenshot must return an (ay) tuple reply.${ctx}`);
        // Observability: installDevtools confirms a successful export on stderr.
        assert.equal(kv.EXPORT_LOG, 'yes', `installDevtools must log the successful export.${ctx}`);
    });
});
