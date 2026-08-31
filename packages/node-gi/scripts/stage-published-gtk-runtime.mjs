#!/usr/bin/env node
// Stage the SHIPPED closure — the published `@gjsify/node-gi` prebuild plus the published
// `@gjsify/gtk-runtime-<target>` bundle — into the layout node-gi's loader reads, and prove the
// staged bytes carry GTK **and** libadwaita.
//
// WHY THIS EXISTS, AND WHY IT IS NOT node-gi.yml's ARTIFACT WIRING
//
// `node-gi.yml`'s `macos-gtk-windowing` / `windows-gtk-windowing` legs BUILD the bundle in the
// same run and hand it downstream as a GitHub artifact. That answers "does the bundle this commit
// would publish work". It cannot answer the question ADR 0024 § 4 actually rests on — *does the
// artifact a stranger downloads run this layer* — because nothing a stranger downloads was in
// that run. Those two are the same bytes only for as long as nobody looks; the published win32
// tarball spent every version up to 0.27.1 shipping `"windowing": false` while the in-run bundle
// was fine (`gtk-runtime-win32-x64/README.md`), and darwin-x64 0.27.1 shipped `Adw-1.typelib`
// with no libadwaita beside it (`typelib-backers.mjs`). So this script installs from npm.
//
// WHY A SCRIPT AND NOT TWO `run:` BLOCKS. The two consumers are a bash step on macOS and a
// cmd.exe step on Windows, and the last time this staging lived inline as two near-identical
// shell copies — `release.yml`'s bundle verify — both died on a quote the shell ate before node
// evaluated one assertion, failing all three publish legs of v0.28.0 while every bundle they
// gated was correct (`verify-bundle-manifest.mjs`'s header). One code path, no shell.
//
// WHAT IT STAGES, AND WHY EXACTLY THERE
//
//   <node-gi>/prebuilds/<target>/node_gi.node      candidate 2 of `nativeCandidates()`
//   <node-gi>/prebuilds/<target>/gtk/              candidate 2 of `resolveGtkRuntimeBundle()`
//
// One directory serves both because the published darwin addon's `LC_RPATH` list already names
// `@loader_path/gtk/lib` (`stage-prebuild.mjs`), so the addon finds the bundle's dylibs with no
// `DYLD_*` variable — which is the whole point of the relocation pass and the reason a
// source-built addon must NOT be substituted here: it keeps absolute Homebrew install names, and
// two GObject type registries in one process is ADR 0018's defect 3. `gtk-runtime.js`'s
// `decideGtkSource()` enforces the same thing from the other side — a `source` addon drops the
// bundle from consideration entirely — so the caller must run with `NODE_GI_NATIVE=prebuild`.
//
// WHAT IT PROVES ABOUT THE STAGED BYTES
//
// `verifyBundleTypelibs()` re-derives the typelib/library symmetry from the directories on disk,
// against the namespaces the bundle exists to provide PLUS the four `--windowing` adds. That is
// the discriminating check, and it is deliberately not a file count: a typelib whose backing
// library is absent RESOLVES, advertises constructible types, and dies in the constructor — worse
// than an absent one. `Adw` is in that required set, so a display-free tarball published by
// mistake fails here rather than four steps later as an inscrutable `g_module_open`.
//
// It does NOT prove the closure LOADS. Nothing on the staging host can: the check is a byte read.
// The load is what the caller's `check-batteries.mjs` and the suites that follow it answer.
//
// Usage:
//   node packages/node-gi/scripts/stage-published-gtk-runtime.mjs
//   node packages/node-gi/scripts/stage-published-gtk-runtime.mjs --target darwin-arm64 --version 0.45.0
//
// `--target` off the host is the TESTING mode and says so: npm refuses a foreign `os`/`cpu`
// without `--force`, and the addon it would stage cannot be loaded here, so that mode installs
// the bundle only and verifies it. It is how the three published bundles were checked from a
// Linux workstation before this ever ran on a runner.

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    REQUIRED_NAMESPACES,
    WINDOWING_REQUIRED_NAMESPACES,
    formatTypelibProblems,
    verifyBundleTypelibs,
} from './typelib-backers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// `resolve`, not `join`: this is the target of a Windows JUNCTION, which needs an absolute
// normalised path — a `..` segment left in it is accepted by `symlinkSync` and then resolves
// unpredictably for whoever reads the link.
const NODE_GI_DIR = resolve(HERE, '..', 'node-gi');
const ADDON_FILENAME = 'node_gi.node';

const args = process.argv.slice(2);

function flag(name) {
    const i = args.indexOf(name);
    if (i === -1) return undefined;
    const value = args[i + 1];
    if (value === undefined || value.startsWith('--')) fail(`${name} requires a value`);
    return value;
}

function fail(message) {
    console.error(`stage-published-gtk-runtime: ${message}`);
    process.exit(1);
}

/** Every occurrence of a repeatable flag, in order. */
function flags(name) {
    const out = [];
    for (let i = 0; i < args.length; i++) {
        if (args[i] !== name) continue;
        const value = args[i + 1];
        if (value === undefined || value.startsWith('--')) fail(`${name} requires a value`);
        out.push(value);
    }
    return out;
}

/**
 * Make `@gjsify/node-gi` resolvable from a consumer package — the trap ADR 0031 sets and every
 * caller has so far paid for separately.
 *
 * node-gi is deliberately NOT a workspace member, so `gjsify install` never materialises it, and
 * `@gjsify/react-native` does not even DECLARE it (it reaches the bridge through `@gjsify/gtk-host`).
 * A `--app node` test bundle resolves `@gjsify/node-gi/gi` at RUNTIME through `createRequire` from
 * its own `dist/`, so a missing link surfaces as `ERR_MODULE_NOT_FOUND` for
 * `@gjsify/node-gi/system` — which reads exactly like "this layer does not run under Node" and is
 * nothing of the kind. `node-gi.yml`'s Linux leg does this with a hand-written `ln -sfn` and calls
 * it belt-and-suspenders; that spelling has no cmd.exe equivalent, which is why it lives here.
 *
 * `'junction'` on win32: a directory junction needs no privilege, where a symlink does. Elsewhere
 * the type argument is ignored.
 */
function linkNodeGiInto(pkgDir) {
    if (!existsSync(pkgDir)) fail(`--link-into ${pkgDir} does not exist`);
    const scope = join(pkgDir, 'node_modules', '@gjsify');
    mkdirSync(scope, { recursive: true });
    const link = join(scope, 'node-gi');
    // Unconditional: `force` makes an absent path a no-op, and this must also clear a BROKEN
    // symlink, which `existsSync` reports as absent. Replacing whatever the install materialised
    // is the intent, not a risk — `rmSync` on a link removes the link, never its target.
    rmSync(link, { recursive: true, force: true });
    symlinkSync(NODE_GI_DIR, link, 'junction');
    console.log(`linked ${link} -> ${NODE_GI_DIR}`);
}

const hostTarget = `${process.platform}-${process.arch}`;
const target = flag('--target') ?? hostTarget;
const foreign = target !== hostTarget;
const dest = flag('--dest') ?? join(NODE_GI_DIR, 'prebuilds', target);

// Refused BY NAME rather than left to npm's 404. There is no `@gjsify/gtk-runtime-linux-*` and
// there is not meant to be: `gtk-runtime.js`'s `DEFAULT_GTK_PREFERENCE` reads `system` on Linux,
// where every distribution ships GTK. Without this the fallback below reports "not fully on npm",
// which is the publish-window diagnosis and would send a reader to look at a release that is fine.
if (target.startsWith('linux-')) {
    fail(
        `there is no batteries-included bundle for ${target}, by design — Linux takes GTK from the ` +
            `system (DEFAULT_GTK_PREFERENCE in gtk-runtime.js). This script stages the darwin and ` +
            `win32 closures, which are the two ADR 0024 § 4 puts on Node + node-gi + a bundle.`,
    );
}

/**
 * The version to install. The one this checkout declares is preferred — it is what the layer
 * under test was written against — but it is NOT required to be on npm: between a release commit
 * and `release.yml`'s serial publish that version provably does not exist yet, and a leg that
 * hard-failed there would be red for minutes on a condition that resolves itself. The fallback is
 * reported as the compromise it is, the same way `.github/scripts/install-published-cli.sh` does.
 */
function declaredVersion() {
    try {
        return JSON.parse(readFileSync(join(NODE_GI_DIR, 'package.json'), 'utf8')).version;
    } catch (error) {
        fail(`cannot read node-gi's own version: ${error.message}`);
    }
}

const requested = flag('--version') ?? declaredVersion();

function npmInstall(prefix, specs) {
    const argv = ['install', '--prefix', prefix, '--no-audit', '--no-fund', '--no-save', ...specs];
    // `--force` ONLY off-host: `@gjsify/gtk-runtime-*` is `os`/`cpu`-gated on purpose, and letting
    // that gate work on a real runner is part of what this staging measures.
    if (foreign) argv.push('--force');
    const res = spawnSync('npm', argv, { stdio: 'inherit', shell: process.platform === 'win32' });
    return res.status === 0;
}

const bundlePkg = `@gjsify/gtk-runtime-${target}`;
const scratch = mkdtempSync(join(tmpdir(), 'gjsify-shipped-gtk-'));
let version = requested;

try {
    const specs = () =>
        foreign ? [`${bundlePkg}@${version}`] : [`@gjsify/node-gi@${version}`, `${bundlePkg}@${version}`];
    if (!npmInstall(scratch, specs())) {
        console.log(`::warning::${bundlePkg}@${requested} is not fully on npm — retrying at @latest.`);
        version = 'latest';
        if (!npmInstall(scratch, specs())) {
            fail(`neither @${requested} nor @latest resolved for ${bundlePkg} / @gjsify/node-gi on ${target}`);
        }
    }

    const installed = join(scratch, 'node_modules', '@gjsify');
    const bundleSrc = join(installed, `gtk-runtime-${target}`, 'gtk');
    if (!existsSync(bundleSrc)) {
        fail(`${bundlePkg} installed without a gtk/ payload — ${bundleSrc} does not exist`);
    }

    mkdirSync(dest, { recursive: true });
    const bundleDest = join(dest, 'gtk');
    rmSync(bundleDest, { recursive: true, force: true });
    cpSync(bundleSrc, bundleDest, { recursive: true });

    if (foreign) {
        console.log(`staged ${bundlePkg} bundle only (target ${target} is not this host ${hostTarget}).`);
    } else {
        const addonSrc = join(installed, 'node-gi', 'prebuilds', target, ADDON_FILENAME);
        if (!existsSync(addonSrc)) {
            fail(
                `@gjsify/node-gi ships no prebuild for ${target} — ${addonSrc} does not exist. ` +
                    `release.yml's node-gi-prebuild-* legs stage one per declared platform; a missing one is ` +
                    `that job's failure, not this script's, and building from source is NOT the repair here ` +
                    `(a source addon drops the bundle in decideGtkSource()).`,
            );
        }
        cpSync(addonSrc, join(dest, ADDON_FILENAME));
    }

    // Read back from the directories that will actually be loaded from, never from what was
    // copied: the symmetry claim is about the staged bytes.
    const caseInsensitive = target.startsWith('win32');
    const analysis = verifyBundleTypelibs({
        typelibDir: join(bundleDest, 'girepository-1.0'),
        nativeDir: join(bundleDest, caseInsensitive ? 'bin' : 'lib'),
        caseInsensitive,
        requiredNamespaces: [...REQUIRED_NAMESPACES, ...WINDOWING_REQUIRED_NAMESPACES],
    });
    if (analysis.problems.length) {
        console.error(
            formatTypelibProblems(analysis.problems, {
                stage: `published ${bundlePkg}@${version}, staged into ${dest}`,
                nativeDirLabel: caseInsensitive ? 'gtk/bin' : 'gtk/lib',
            }),
        );
        process.exit(1);
    }

    for (const pkgDir of flags('--link-into')) linkNodeGiInto(pkgDir);

    const manifest = JSON.parse(readFileSync(join(bundleDest, 'manifest.json'), 'utf8'));
    console.log(
        `stage-published-gtk-runtime: ${bundlePkg}@${version} → ${dest} — ` +
            `${analysis.backed.length} library-backed typelibs (Gtk + Adw among them), ` +
            `${analysis.headerOnly.length} header-only, windowing=${manifest.windowing}, ` +
            `${manifest.dataBytes} bytes of runtime data` +
            (foreign ? ' (bundle only)' : `, addon from @gjsify/node-gi@${version}`),
    );
} finally {
    rmSync(scratch, { recursive: true, force: true });
}
