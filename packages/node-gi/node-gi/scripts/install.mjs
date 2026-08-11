#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// @gjsify/node-gi — the `install` lifecycle script. Use the SHIPPED PREBUILD when
// this package carries one for the host; the node-gyp source build is the FALLBACK.
//
// THE FAILURE THIS REPLACES. `package.json` used to declare
// `"install": "node-gyp rebuild"`, which npm/yarn/pnpm run on EVERY install — a
// shipped prebuild could not prevent it. So on any machine without the
// GTK/GObject-Introspection development toolchain (i.e. every end user)
// `npm install @gjsify/node-gi` FAILED even when the tarball carried the right
// prebuild, and it failed by npm rolling the install back rather than by degrading.
// The prebuild was reachable only through `gjsify install`, which deliberately runs
// no lifecycle scripts — which is why `gjsify showcase --runtime node` worked on
// Windows while a plain npm dependency on the same version could not be installed.
//
// WHY EXISTENCE, NOT LOADABILITY, IS THE GATE. The obvious-looking alternative
// (`node-gyp-build`) gates on a bin that `require()`s the addon and falls back to a
// source build if the load throws. On exactly the platforms whose whole point is the
// prebuild that is a FALSE NEGATIVE: the win32/darwin addon's DLL/dylib closure is
// only findable after `gtk-runtime.js` has wired the batteries-included GTK bundle
// into `PATH` / `DYLD_FALLBACK_LIBRARY_PATH`, which `index.js` does at import time
// and a bare install-time `require()` of the `.node` never does. A load-based gate
// would therefore call a perfectly good prebuild broken and rebuild. Existence of the
// file the loader actually probes is the honest question at install time; whether it
// LOADS is what release.yml's per-target load test answers, against a real GTK.
//
// WHY NOT DEPEND ON `node-gyp-build` (verified, not assumed): that false-negative
// load gate; its probe order is `build/` FIRST then the prebuild, the OPPOSITE of
// node-gi's deliberate consumer default (`native-paths.js` `nativeCandidates`), so
// the two would disagree about which binary matters; it propagates a bare node-gyp
// exit code instead of one actionable diagnosis; and it would add a runtime
// dependency to a package whose dep surface is otherwise just `node-addon-api`. (It
// WOULD match the `node_gi.node` filename — node-gyp-build 4.8.4's `matchTags` treats
// a missing runtime tag as permissive. The filename was never the blocker.)
//
// THE SOURCE BUILD MUST KEEP WORKING, and does. `prebuilds/` is gitignored, so a
// fresh checkout has none and this script builds exactly as before — which is what
// node-gi.yml's `npm install --foreground-scripts` steps and release.yml's
// `node-gi-prebuild-*` legs rely on to produce `build/Release/node_gi.node` for
// `scripts/stage-prebuild.mjs`. Depending on a directory being ABSENT is too implicit
// to be the only guarantee, so the build is also forceable:
// `NODE_GI_BUILD_FROM_SOURCE=1`, or npm's own `--build-from-source`.
//
// FAIL-SAFE DIRECTION: every uncertain branch builds. Only a positively confirmed
// prebuild file for this exact host skips the build, so a bug here degrades to the
// previous behaviour rather than to a package with no addon.
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { hostTarget, packageRoot, prebuildAddonPath } from '../native-paths.js';

const target = hostTarget();

const isEnabled = (value) => value === '1' || value === 'true';

/**
 * Did the user explicitly ask for a source build? `npm_config_build_from_source` is
 * what npm exports for `--build-from-source` (the flag every node-gyp-build package
 * honours), so CI or a maintainer can force the build without knowing node-gi's own
 * env var name.
 */
const buildFromSourceRequested = () =>
    isEnabled(process.env.NODE_GI_BUILD_FROM_SOURCE) || process.env.npm_config_build_from_source === 'true';

/** The `<os>-<arch>` targets this package PROMISES a prebuild for, from its own manifest. */
function declaredPlatforms() {
    try {
        const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
        const platforms = manifest?.gjsify?.platforms;
        return Array.isArray(platforms) ? platforms : [];
    } catch {
        // An unreadable own manifest is not worth failing an install over — the
        // diagnosis below just loses one line of context.
        return [];
    }
}

/**
 * Run `node-gyp rebuild` in the package root, inheriting stdio so the real compiler
 * output stays visible — it is the actual diagnosis; the framed message below only
 * tells the reader what to DO about it.
 *
 * node-gyp is resolved the way node-gyp-build's own bin does: prefer node-gyp's JS
 * entry if it happens to be resolvable, else the `node-gyp` shim that npm, yarn and
 * pnpm all put on `PATH` for lifecycle scripts (`node-gyp.cmd` on Windows, hence
 * `shell` there).
 */
function runNodeGyp() {
    const win32 = process.platform === 'win32';
    let command = win32 ? 'node-gyp.cmd' : 'node-gyp';
    let args = ['rebuild'];
    let shell = win32;
    try {
        // Only succeeds when node-gyp is genuinely resolvable from here; npm's bundled
        // copy lives in npm's own tree and is not, which is why the PATH shim above
        // stays the normal path. `createRequire().resolve` rather than
        // `import.meta.resolve` — the latter is only synchronous from Node 20.6, and
        // `engines.node` is `>=20`.
        const entry = createRequire(import.meta.url).resolve('node-gyp/bin/node-gyp.js');
        command = process.execPath;
        args = [entry, 'rebuild'];
        shell = false;
    } catch {
        // Not resolvable — use the PATH shim.
    }
    const res = spawnSync(command, args, { cwd: packageRoot, stdio: 'inherit', shell, windowsHide: true });
    return { status: res.status === null ? 1 : res.status, error: res.error };
}

/**
 * Are we running inside a source CHECKOUT rather than an installed tarball? Keyed on
 * two paths `files` deliberately does not publish (`test/` and the staging tool),
 * because the distinction changes the advice: in a checkout `prebuilds/` is gitignored
 * so its absence is expected and the source build IS the path; in an installed copy a
 * missing prebuild for a PROMISED target is a packaging regression to report.
 */
function isRepoCheckout() {
    return existsSync(join(packageRoot, 'test')) || existsSync(join(packageRoot, 'scripts', 'stage-prebuild.mjs'));
}

/**
 * ONE actionable message for "no usable prebuild AND the source build did not
 * succeed" — the case that used to surface as nothing but a node-gyp stack. It
 * distinguishes the three reasons the prebuild was missing, because the reader's next
 * action differs each time: a checkout is SUPPOSED to build; an undeclared platform
 * means "build it yourself or use a supported target"; a DECLARED platform with no
 * artifact in an installed copy is a packaging regression to report, not to work
 * around (0.26.0 shipped `prebuilds/linux-*` only while promising four targets, and
 * nothing told the consumer).
 */
function reportFailure(status, spawnError) {
    const platforms = declaredPlatforms();
    const promised = platforms.includes(target);
    const checkout = isRepoCheckout();
    const bar = '─'.repeat(78);
    const lines = [
        '',
        bar,
        `@gjsify/node-gi: could not obtain the native addon for ${target}.`,
        '',
        checkout
            ? '  • This is a source checkout, where `prebuilds/` is gitignored — no staged prebuild\n' +
              '    for this host was expected, and the source build IS the path here.'
            : promised
              ? `  • This package PROMISES a prebuild for ${target} (package.json#gjsify.platforms) but\n` +
                `    the installed copy carries no prebuilds/${target}/node_gi.node. That is a packaging\n` +
                '    bug in this release, not a problem with your machine — please report it at\n' +
                '    https://github.com/gjsify/gjsify/issues.'
              : `  • No prebuild ships for ${target}.` +
                (platforms.length > 0 ? ` Prebuilds ship for: ${platforms.join(', ')}.` : ''),
        spawnError
            ? `  • The node-gyp source build could not even be STARTED: ${spawnError.message}\n` +
              '    (node-gyp is normally provided on PATH by npm/yarn/pnpm for install scripts.)'
            : `  • The node-gyp source build above exited ${status}. Its output is the actual diagnosis.`,
        '',
        'Building from source needs a C++ toolchain plus GLib >= 2.80 development headers',
        'exposing girepository-2.0, and cairo:',
        '  Fedora        dnf install gcc-c++ make python3 pkgconf-pkg-config glib2-devel \\',
        '                    gobject-introspection-devel cairo-devel',
        '  Debian/Ubuntu apt install g++ make python3 pkg-config libglib2.0-dev \\',
        '                    libgirepository-2.0-dev libcairo2-dev',
        '  macOS         brew install gobject-introspection cairo pkg-config',
        '  Windows       gvsbuild GTK4 (MSVC ABI), then PKG_CONFIG_PATH=<prefix>\\lib\\pkgconfig',
        '',
        'Escape hatches:',
        '  NODE_GI_SKIP_NATIVE_BUILD=1     install the JS without an addon (every gi:// import',
        '                                  then throws until you point NODE_GI_NATIVE at one)',
        '  NODE_GI_NATIVE=/abs/node_gi.node  load an addon you built or copied yourself',
        '  NODE_GI_BUILD_FROM_SOURCE=1     build from source even when a prebuild exists',
        bar,
        '',
    ];
    console.error(lines.join('\n'));
}

function main() {
    // Deliberately first: an explicit "do not build" wins over everything, so a
    // consumer on an unsupported platform can complete an install and supply an addon
    // via NODE_GI_NATIVE afterwards.
    if (isEnabled(process.env.NODE_GI_SKIP_NATIVE_BUILD)) {
        console.log(
            `@gjsify/node-gi: NODE_GI_SKIP_NATIVE_BUILD is set — skipping the native addon for ${target}. ` +
                'gi:// imports will throw until NODE_GI_NATIVE points at a node_gi.node.',
        );
        return 0;
    }

    const prebuild = prebuildAddonPath();
    if (!buildFromSourceRequested() && existsSync(prebuild)) {
        console.log(
            `@gjsify/node-gi: using the shipped prebuild for ${target} ` +
                `(prebuilds/${target}/node_gi.node) — no node-gyp, no C++ toolchain needed. ` +
                'Set NODE_GI_BUILD_FROM_SOURCE=1 to build from source anyway.',
        );
        return 0;
    }

    const { status, error } = runNodeGyp();
    if (status === 0 && !error) return 0;
    reportFailure(status, error);
    // Fail the install rather than half-install. This package IS its native addon: a
    // zero exit here would trade a clear install-time failure for a deferred `import`
    // failure in the consumer's own code. NODE_GI_SKIP_NATIVE_BUILD is the opt-in for
    // anyone who wants the other trade.
    return status === 0 ? 1 : status;
}

process.exit(main());
