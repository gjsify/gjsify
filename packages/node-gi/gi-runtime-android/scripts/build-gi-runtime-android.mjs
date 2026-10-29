// SPDX-License-Identifier: MIT
// Build @gjsify/gi-runtime-android's payload: one AAR carrying `libnode_gi.so`, the
// GObject-Introspection libraries it actually needs, and their typelibs, for every
// requested ABI. docs/node-gi-platform-notes.md § "The NativeScript plugin".
//
// WHY AN AAR AND NOT A `prebuilds/` DIRECTORY. On Android nothing resolves a `.node`
// file or a `node_modules` path at runtime: the APK's `lib/<abi>/` is the only place
// `dlopen` looks without an absolute path, and only the Android build system puts
// anything there. NativeScript's gradle (see @nativescript/android's app/build.gradle)
// scans each dependency's `platforms/android` for `**/*.aar` and adds every hit as an
// `implementation` dependency; AGP then merges the AAR's `jni/<abi>/` into the APK's
// native libraries and its `assets/**` into the app assets. So the packaging envelope
// IS the delivery mechanism, and an app gets the whole GI runtime by adding one
// dependency — no jniLibs in App_Resources, no hand-copied `.so`.
//
// WHY THE ADDON AND THE GI STACK TRAVEL TOGETHER. `libnode_gi.so` names its GI libraries
// in DT_NEEDED entries, so the loader resolves them before a line of JavaScript runs. An
// addon built against one GLib and shipped beside another is a startup crash, not a
// version warning. One artifact, one linked unit, one sha256 in the manifest beside it.
//
// THE CLOSURE IS MEASURED, NEVER LISTED. The set of libraries is the transitive DT_NEEDED
// walk from `libnode_gi.so` through the GI prefix, so a dependency added upstream arrives
// on its own and one dropped upstream leaves. A hand-written list drifts into either a
// missing library (a crash on the device) or a dead one (megabytes in every APK), and both
// are invisible in a checkout. Anything the walk cannot resolve inside the prefix must be
// a library ANDROID or NATIVESCRIPT provides; the build asserts that by name
// (SYSTEM_PROVIDED) and fails on a fourth answer.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    existsSync,
    lstatSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    readlinkSync,
    realpathSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildZip } from '../../scripts/aar-zip.mjs';
import { planTypelibSet, readTypelibDir } from '../../scripts/typelib-backers.mjs';

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The ABIs this bundle can carry, and the NDK triple each one's tools are named after. */
const ABIS = {
    'arm64-v8a': 'aarch64-linux-android',
    x86_64: 'x86_64-linux-android',
};

/**
 * Libraries the closure walk is allowed to leave unresolved, with who supplies each.
 *
 * Bundling any of these would be a second copy of something already in the process:
 * the Bionic libraries come from the platform, and `libNativeScript.so` IS the host —
 * a second one would mean two V8 isolates and two Node-API registries. `libz.so` is a
 * platform library on every supported API level, which is why Android's own NDK lists
 * it as available for linking.
 *
 * A soname that is neither resolvable in the prefix nor listed here fails the build.
 * That is the point: it is either a library the APK must carry and does not, or a
 * dependency the GI stack grew that nobody decided about.
 */
const SYSTEM_PROVIDED = new Map([
    ['libc.so', 'Bionic (platform)'],
    ['libm.so', 'Bionic (platform)'],
    ['libdl.so', 'Bionic (platform)'],
    ['liblog.so', 'Android platform (NDK stable ABI)'],
    ['libandroid.so', 'Android platform (NDK stable ABI)'],
    ['libz.so', 'Android platform (NDK stable ABI)'],
    // Reached only once a `--gi-namespaces` selection seeds GTK: `libgdk` draws into an
    // `android.graphics.Bitmap` through `libjnigraphics` and `libgsk` has a Vulkan
    // renderer. Both are NDK stable-ABI platform libraries available from API 24, which
    // is this AAR's `minSdkVersion`, so bundling either would be a second copy of
    // something the device already has — and `libvulkan.so` in particular is the driver.
    ['libjnigraphics.so', 'Android platform (NDK stable ABI, API 24+)'],
    ['libvulkan.so', 'Android platform (NDK stable ABI, API 24+)'],
    ['libNativeScript.so', 'the NativeScript runtime AAR, already in the APK'],
]);

/**
 * Where the typelibs sit inside the AAR. NativeScript extracts the APK's `assets/app/**`
 * to `<filesDir>/app`, which makes this `<filesDir>/app/girepository-1.0` on the device —
 * exactly `host.nativescript.js`'s default for `__NODE_GI_TYPELIB_PATH`. The two agree on
 * purpose, so an app installing this plugin configures no paths at all.
 */
const TYPELIB_ASSET_DIR = 'assets/app/girepository-1.0';

/** The AAR's own identity. `minSdkVersion` matches build-android.mjs's default clang target. */
const AAR_PACKAGE = 'studio.artandcode.gjsify.gi_runtime';
const AAR_MIN_SDK = 24;

/**
 * Namespaces the bundle is pointless without, so their absence is a build failure and not a
 * smaller AAR. These three are what `@gjsify/adwaita-gobject-native`'s real-GObject engine
 * calls into; everything else the GI prefix offers is shipped if its backing library happens
 * to be in the closure and dropped if not.
 */
export const REQUIRED_NAMESPACES = ['GLib', 'GObject', 'Gio'];

const USAGE = `Usage: node scripts/build-gi-runtime-android.mjs [options]

Stage libnode_gi.so, its measured GI dependency closure and the typelibs into one AAR.

Options (each also read from the env var in brackets):
  --abi <abi>            arm64-v8a | x86_64; repeatable. Default: both          [ANDROID_ABI]
  --ndk <dir>            Android NDK root, for llvm-readelf and llvm-strip      [ANDROID_NDK_HOME]
  --gi-sysroot <dir>     prefix with lib/<abi>/*.so — the same flag spelling and the same tree
                         as @gjsify/node-gi's scripts/build-android.mjs         [NODE_GI_ANDROID_SYSROOT]
  --node-gi-lib <dir>    directory holding <abi>/libnode_gi.so, i.e. build-android.mjs's --out
                                                                               [NODE_GI_ANDROID_LIB]
  --typelib-dir <spec>   where the typelibs are; repeatable, as <abi>=<dir>, or once without an
                         ABI to use one directory for all. Default: <gi-sysroot>/lib/<abi>/
                         girepository-1.0                                      [NODE_GI_ANDROID_TYPELIBS]
  --gi-namespaces <list> extra GI namespaces this AAR carries, comma- or space-separated, as
                         \`Ns\` or \`Ns-Version\` (ADR 0117 § 2). Their backing libraries seed the
                         closure walk, so the typelibs become shippable. Empty — the default —
                         is the measured core set and byte-identical to a build without the
                         flag                                                  [NODE_GI_ANDROID_NAMESPACES]
  --license-corpus <dir> optional: <project>/<file> licence texts to embed in the notice. The
                         Android GI prefix ships none, so without this the notice names each
                         project and its upstream and says the text is not embedded.
  --mtime <epoch>        one timestamp for every AAR entry (default: 315532800, 1980-01-01)
  --out <dir>            payload directory (default: <package>/platforms/android)
  --keep-stage           leave the unzipped staging tree beside the AAR for inspection
  --dry-run              report what would be staged, write nothing
  -h, --help             this text
`;

function fail(message) {
    console.error(`build-gi-runtime-android: ${message}`);
    process.exit(1);
}

function parseArgs(argv) {
    const env = process.env;
    const opts = {
        abis: [],
        ndk: env.ANDROID_NDK_HOME,
        giSysroot: env.NODE_GI_ANDROID_SYSROOT,
        nodeGiLib: env.NODE_GI_ANDROID_LIB,
        typelibDirs: env.NODE_GI_ANDROID_TYPELIBS ? [env.NODE_GI_ANDROID_TYPELIBS] : [],
        giNamespaces: splitNamespaces(env.NODE_GI_ANDROID_NAMESPACES),
        licenseCorpus: undefined,
        mtime: 315532800,
        out: undefined,
        keepStage: false,
        dryRun: false,
    };
    const valued = {
        '--ndk': 'ndk',
        '--gi-sysroot': 'giSysroot',
        '--node-gi-lib': 'nodeGiLib',
        '--license-corpus': 'licenseCorpus',
        '--out': 'out',
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '-h' || arg === '--help') {
            process.stdout.write(USAGE);
            process.exit(0);
        }
        if (arg === '--dry-run') {
            opts.dryRun = true;
            continue;
        }
        if (arg === '--keep-stage') {
            opts.keepStage = true;
            continue;
        }
        const [flag, inline] = arg.split(/=(.*)/s);
        const value = inline ?? argv[i + 1];
        if (flag === '--abi' || flag === '--typelib-dir' || flag === '--gi-namespaces' || flag === '--mtime') {
            if (inline === undefined) i++;
            if (value === undefined) fail(`${flag} needs a value`);
            if (flag === '--abi') opts.abis.push(value);
            else if (flag === '--typelib-dir') opts.typelibDirs.push(value);
            else if (flag === '--gi-namespaces') opts.giNamespaces.push(...splitNamespaces(value));
            else opts.mtime = Number(value);
            continue;
        }
        const key = valued[flag];
        if (!key) fail(`unknown argument ${arg}\n\n${USAGE}`);
        if (inline === undefined) i++;
        if (value === undefined) fail(`${flag} needs a value`);
        opts[key] = value;
    }
    if (opts.abis.length === 0) opts.abis = Object.keys(ABIS);
    for (const abi of opts.abis) {
        if (!(abi in ABIS)) fail(`--abi ${abi}: not one of ${Object.keys(ABIS).join(', ')}`);
    }
    if (!Number.isFinite(opts.mtime)) fail('--mtime must be a number of seconds since the epoch');
    opts.giNamespaces = [...new Set(opts.giNamespaces)].sort();
    return opts;
}

/**
 * `Gtk,Pango` or `Gtk Pango` → `['Gtk', 'Pango']`; an empty or absent value → `[]`.
 *
 * Both separators, because this flag is written by hand on a command line AND passed
 * through by `gjsify build`'s config, where a JSON array arrives joined.
 */
function splitNamespaces(value) {
    if (!value) return [];
    return value
        .split(/[,\s]+/)
        .map((entry) => entry.trim())
        .filter(Boolean);
}

/** An NDK tool, by name. Both tools used here are ABI-independent llvm binaries. */
function ndkTool(ndk, name) {
    const bin = join(ndk, 'toolchains', 'llvm', 'prebuilt', 'linux-x86_64', 'bin', name);
    if (!existsSync(bin)) fail(`${name} not found at ${bin} — is --ndk an NDK root?`);
    return bin;
}

function requireDir(label, dir, hint) {
    if (!dir) fail(`${label} is required (${hint})`);
    const abs = resolve(dir);
    if (!existsSync(abs) || !statSync(abs).isDirectory()) fail(`${label}: ${abs} is not a directory`);
    return abs;
}

function sha256(bytes) {
    return createHash('sha256').update(bytes).digest('hex');
}

// ---------------------------------------------------------------------------------------
// The decisions, as pure functions. Everything below this line is testable without an NDK,
// without an Android GI prefix and without writing a file — the same arrangement
// `androidLinkArgs` has in build-android.mjs, for the same reason: the interesting part of
// a build script is what it decides, and a decision that can only be checked by running the
// cross-compiler is a decision nothing checks. test/gi-runtime-android.test.mjs.
// ---------------------------------------------------------------------------------------

/** The DT_NEEDED sonames in `llvm-readelf -d` output, in order. */
export function parseNeeded(readelfOutput) {
    const out = [];
    for (const line of readelfOutput.split('\n')) {
        const match = /\(NEEDED\)\s+Shared library: \[(.+?)\]/.exec(line);
        if (match !== null) out.push(match[1]);
    }
    return out;
}

/**
 * The transitive DT_NEEDED closure of `roots`, resolved against one prefix.
 *
 * TWO KINDS OF STARTING POINT, and the difference is whether the payload carries them.
 * A ROOT is walked and not bundled — `libnode_gi.so` is staged by name elsewhere, so
 * bundling it again would put two copies in the AAR. A SEED is walked AND bundled: it is
 * a library nothing in the root's link graph reaches, which is the whole shape ADR 0117
 * § 2 selects by (`libgtk-4.so.1` is in the prefix and in nobody's DT_NEEDED) and the
 * same shape the desktop bundles established for librsvg and the GIO modules. Seeding a
 * library and then not shipping it would reproduce exactly the failure `planTypelibSet`
 * exists to prevent: a typelib whose backer is advertised and absent.
 *
 * @param {object} spec
 * @param {string[]} spec.roots sonames to start from (they are not themselves bundled)
 * @param {string[]} [spec.seeds] sonames to start from that ARE bundled (ADR 0117 § 2)
 * @param {(soname: string) => string[] | null} spec.needed DT_NEEDED of a soname in the
 *   prefix, or `null` when the prefix does not have it
 * @returns {{ bundle: string[], system: string[] }} `bundle` sorted, `system` sorted
 */
export function planClosure({ roots, seeds = [], needed }) {
    const bundle = new Set();
    const system = new Set();
    const unknown = new Set();
    const rootSet = new Set(roots);
    // A seed that is ALSO a root stays a root: the explicit "not bundled" wins, or
    // `--gi-namespaces` naming a namespace backed by `libnode_gi.so` itself would stage
    // the addon twice.
    for (const seed of seeds) if (!rootSet.has(seed)) bundle.add(seed);
    const queue = [...roots, ...bundle];

    while (queue.length > 0) {
        const soname = queue.shift();
        const deps = needed(soname);
        if (deps === null) {
            // A root that is not in the prefix is the caller's bug, not an unresolved dep.
            throw new Error(`planClosure: ${soname} is not readable in the prefix`);
        }
        for (const dep of deps) {
            if (rootSet.has(dep) || bundle.has(dep) || system.has(dep) || unknown.has(dep)) continue;
            if (needed(dep) !== null) {
                bundle.add(dep);
                queue.push(dep);
            } else if (SYSTEM_PROVIDED.has(dep)) {
                system.add(dep);
            } else {
                unknown.add(dep);
            }
        }
    }

    if (unknown.size > 0) {
        // The failure this exists for. Either the APK must carry these and would not, or
        // the GI stack grew a dependency nobody decided about — both produce the same
        // device symptom (`dlopen` fails before any JavaScript runs) and neither is
        // visible in a checkout. So it is a build error with the names in it.
        throw new Error(
            `planClosure: ${[...unknown].sort().join(', ')} ${unknown.size === 1 ? 'is' : 'are'} neither resolvable ` +
                'in the GI prefix nor known to be provided by Android or NativeScript. Either the prefix is ' +
                'incomplete, or this is a new dependency: bundle it, or add it to SYSTEM_PROVIDED with who ' +
                'supplies it.',
        );
    }

    return { bundle: [...bundle].sort(), system: [...system].sort() };
}

/**
 * The seed libraries a requested namespace set is backed by — ADR 0117 § 2 step 1.
 *
 * READ FROM THE TYPELIB, NEVER FROM A TABLE, which is `typelib-backers.mjs`'s rule and
 * the reason it survives three platforms' different leaf names: the `shared_library`
 * header field holds the exact string GI hands to `g_module_open`, so the leaves this
 * returns are the ones that have to be in `jni/<abi>/` for the namespace to resolve.
 *
 * A HEADER-ONLY NAMESPACE CONTRIBUTES NOTHING AND IS NOT AN ERROR. `GLibUnix-2.0` and
 * friends bind no library at all; asking for one is a legitimate declaration that the
 * typelib must ship, and `planTypelibSet` is what decides that — not this function.
 *
 * THE WALK FOLLOWS TYPELIB `dependencies`, and leaving that out is not an optimisation
 * but a build failure. Measured on this prefix with `--gi-namespaces Gtk`: seeding only
 * the libraries the REQUESTED namespace names reaches `libharfbuzz.so` (via libpango's
 * DT_NEEDED) and never `libharfbuzz-gobject.so`, which is what `HarfBuzz-0.0.typelib`
 * declares as its backer and which nothing in the prefix links. `Pango-1.0` depends on
 * `HarfBuzz-0.0`, so `planTypelibSet` cannot drop it — the build stopped with exactly the
 * `blocked` message that gate exists for. The repair is a seed, which is the same answer
 * the darwin bundle reached for `harfbuzz-gobject` and the win32 one for librsvg.
 *
 * A DEPENDENCY WITH NO TYPELIB IN THE PREFIX IS SKIPPED HERE, not reported. `Gdk-4.0`
 * depends on `cairo-1.0` and this prefix ships no `cairo-1.0.typelib` at all; that is a
 * gap in the sysroot, `planTypelibSet` already names it as "the source prefix does not
 * provide at all", and a second refusal in this function would be the second mechanism
 * ADR 0117 § 2 says the selection must not grow.
 *
 * @param {object} spec
 * @param {string[]} spec.namespaces `Ns` or `Ns-Version`, as `giNamespaces` declares them
 * @param {ReturnType<typeof readTypelibDir>} spec.typelibs the prefix's typelibs
 * @returns {{ seeds: string[], resolved: { requested: string, key: string }[] }}
 */
export function planGiRoots({ namespaces, typelibs }) {
    const byKey = new Map(typelibs.map((t) => [t.key, t]));
    const byNamespace = new Map();
    for (const t of typelibs) {
        if (!byNamespace.has(t.namespace)) byNamespace.set(t.namespace, []);
        byNamespace.get(t.namespace).push(t);
    }

    const seeds = new Set();
    const seen = new Set();
    const resolved = [];
    const missing = [];
    const ambiguous = [];

    for (const requested of namespaces) {
        const pinned = byKey.get(requested);
        const candidates = pinned !== undefined ? [pinned] : (byNamespace.get(requested) ?? []);
        if (candidates.length === 0) {
            missing.push(requested);
            continue;
        }
        if (candidates.length > 1) {
            // Only reachable for a BARE request, since a key names one file. Guessing a
            // version here would pick an ABI for the app by sort order.
            ambiguous.push(
                `${requested} (${candidates
                    .map((t) => t.key)
                    .sort()
                    .join(', ')})`,
            );
            continue;
        }
        const typelib = candidates[0];
        resolved.push({ requested, key: typelib.key });
        // Breadth-first over the typelib dependency graph, seeding every backer on the
        // way. `seen` is keyed on the typelib key, so a diamond (Gtk and Pango both
        // reaching HarfBuzz) is walked once and a cycle terminates.
        const queue = [typelib];
        for (let i = 0; i < queue.length; i++) {
            const current = queue[i];
            if (seen.has(current.key)) continue;
            seen.add(current.key);
            for (const leaf of current.sharedLibraries) seeds.add(leaf);
            for (const dep of current.dependencies) {
                const next = byKey.get(dep);
                if (next !== undefined && !seen.has(next.key)) queue.push(next);
            }
        }
    }

    if (missing.length > 0) {
        // The prefix is pinned by sha256, so this is answerable in the checkout: either
        // the namespace is spelled wrong or the sysroot has to grow (ADR 0117 § 4).
        throw new Error(
            `planGiRoots: the GI prefix has no typelib for ${missing.sort().join(', ')}. ` +
                `It offers ${[...byNamespace.keys()].sort().join(', ')}. Either the namespace is misspelled, ` +
                'or it needs a new android-sysroot release (ADR 0117 § 4) before an app can select it.',
        );
    }
    if (ambiguous.length > 0) {
        throw new Error(
            `planGiRoots: ${ambiguous.sort().join('; ')} — the prefix has more than one version and the ` +
                'request does not say which. Declare it as `Ns-Version`.',
        );
    }

    return { seeds: [...seeds].sort(), resolved };
}

/**
 * One typelib set for every ABI, or a named failure.
 *
 * AN AAR HAS ONE `assets/` TREE and no per-ABI variant of it, so the typelibs are taken
 * from one declared source ABI and used by all of them. That is only sound while the
 * typelibs are ABI-neutral — and `.typelib` blobs are not neutral in general, because they
 * record struct sizes and field offsets. So every typelib is compared across every
 * requested ABI and an UNDECLARED divergence fails the build. The declared ones live in
 * typelib-abi-divergence.json with the measurement that justifies each.
 *
 * @param {object} spec
 * @param {Record<string, Map<string, Buffer>>} spec.perAbi typelib name -> bytes, per ABI
 * @param {{ sourceAbi: string, divergent: { typelib: string }[] }} spec.declared
 * @returns {{ sourceAbi: string, typelibs: string[], divergent: string[] }}
 */
export function planTypelibs({ perAbi, declared }) {
    const abis = Object.keys(perAbi);
    const source = declared.sourceAbi;
    if (!abis.includes(source)) {
        throw new Error(
            `planTypelibs: the typelibs are declared to come from ${source}, which is not among the ABIs being ` +
                `built (${abis.join(', ')}). The asset tree would then be taken from an ABI nothing in this run ` +
                'measured.',
        );
    }

    const names = [...perAbi[source].keys()].sort();
    const allowed = new Set(declared.divergent.map((entry) => entry.typelib));
    const problems = [];
    const divergent = [];

    for (const abi of abis) {
        const missing = names.filter((name) => !perAbi[abi].has(name));
        if (missing.length > 0) problems.push(`${abi} is missing ${missing.join(', ')}`);
        const extra = [...perAbi[abi].keys()].filter((name) => !perAbi[source].has(name)).sort();
        if (extra.length > 0) problems.push(`${abi} has ${extra.join(', ')}, which ${source} does not`);
    }

    for (const name of names) {
        for (const abi of abis) {
            if (abi === source || !perAbi[abi].has(name)) continue;
            if (perAbi[abi].get(name).equals(perAbi[source].get(name))) continue;
            if (!allowed.has(name)) {
                problems.push(
                    `${name} differs between ${source} (${perAbi[source].get(name).length} bytes) and ${abi} ` +
                        `(${perAbi[abi].get(name).length} bytes)`,
                );
            } else if (!divergent.includes(name)) {
                divergent.push(name);
            }
        }
    }

    if (problems.length > 0) {
        throw new Error(
            `planTypelibs: the typelib sets are not interchangeable across ABIs:\n  - ${problems.join('\n  - ')}\n` +
                'One `assets/` tree can only carry one of them. Measure the difference, and either fix the GI ' +
                'build or record it in typelib-abi-divergence.json with what the consequence is.',
        );
    }

    return { sourceAbi: source, typelibs: names, divergent };
}

/**
 * `THIRD-PARTY-NOTICES.md` for the bundled closure.
 *
 * THE SET IS DERIVED FROM WHAT IS BUNDLED, never hand-listed — same doctrine as
 * bundle-licenses.mjs, and the reason `licenses/bundled-projects.json` is a NAME MAP: it
 * says who to attribute, never what the terms are. A soname with no entry fails here, so a
 * library the closure grew cannot ship unattributed.
 *
 * AND THE LIMIT IS STATED RATHER THAN PAPERED OVER. The Android GI prefix is a meson build
 * tree and ships no licence corpus at all (measured: zero COPYING/LICENSE files under the
 * whole prefix), unlike the Homebrew kegs the darwin bundle reads terms from. Writing SPDX
 * expressions here from memory would make a specific false claim where an unspecific true
 * one is available — exactly what `bundled-license` refuses on win32. So each project is
 * named with its upstream, and the notice says plainly that the text is not embedded unless
 * `--license-corpus` supplied one.
 */
export function renderNotice({ bundled, system, table, corpus, abis }) {
    const unattributed = bundled.filter((soname) => !(soname in table.libraries)).sort();
    if (unattributed.length > 0) {
        throw new Error(
            `renderNotice: ${unattributed.join(', ')} ${unattributed.length === 1 ? 'is' : 'are'} in the bundled ` +
                'closure with no entry in licenses/bundled-projects.json, so the notice would ship a third-party ' +
                'binary it does not attribute. Add the soname with the project it belongs to.',
        );
    }

    const byProject = new Map();
    for (const soname of [...bundled].sort()) {
        const id = table.libraries[soname];
        if (!(id in table.projects)) {
            throw new Error(
                `renderNotice: ${soname} maps to project "${id}", which bundled-projects.json does not describe`,
            );
        }
        if (!byProject.has(id)) byProject.set(id, []);
        byProject.get(id).push(soname);
    }

    const lines = [
        '# Third-party notices — @gjsify/gi-runtime-android',
        '',
        'This package is an Android NativeScript plugin whose payload is an AAR of native',
        'libraries. The three source files in it are MIT (see `LICENSE`); the AAR is not.',
        '',
        `It carries, for ${abis.join(' and ')}:`,
        '',
        "- `libnode_gi.so` — @gjsify/node-gi's own addon, MIT, cross-compiled from this",
        '  repository against the GObject-Introspection stack below.',
        `- ${bundled.length} unmodified shared libraries from that stack, listed per project below.`,
        "- Their `.typelib` introspection data, generated by GLib's `g-ir-compiler` from the",
        '  same sources as the libraries it describes.',
        '',
        'The libraries are UNMODIFIED except that `llvm-strip --strip-unneeded` removes the',
        'symbols nothing in the APK resolves. No install name, rpath or soname is rewritten —',
        "unlike the darwin bundle, Android needs none, because the APK's `lib/<abi>/` is the",
        "loader's own search path.",
        '',
        '## What is NOT bundled',
        '',
        'The closure also resolves against libraries already present in the process, which this',
        'package therefore does not redistribute:',
        '',
    ];
    for (const soname of [...system].sort()) {
        lines.push(`- \`${soname}\` — ${SYSTEM_PROVIDED.get(soname)}`);
    }
    lines.push('', '## Bundled projects', '');

    if (corpus === null) {
        lines.push(
            'THE LICENCE TEXTS ARE NOT EMBEDDED, and this says so rather than guessing. The',
            'Android GI prefix this bundles from is a meson build tree, which ships no licence',
            'corpus — so unlike the darwin bundle, where every dylib resolves into a Homebrew keg',
            'whose formula states the terms, there is nothing here to read them off. An SPDX',
            'expression written from recollection would be a specific false claim in place of an',
            'unspecific true one. Each project is named with its upstream, where the terms that',
            'apply to the exact revision bundled are authoritative; pass `--license-corpus <dir>`',
            'to a build to embed texts instead.',
            '',
        );
    }

    for (const [id, sonames] of [...byProject].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
        const project = table.projects[id];
        lines.push(`### ${project.name}`, '', `Upstream: ${project.upstream}`, '');
        lines.push('Bundled as:', '');
        for (const soname of sonames) lines.push(`- \`${soname}\``);
        lines.push('');
        const texts = corpus?.get(id) ?? [];
        if (texts.length === 0) {
            lines.push(
                `Licence text: not embedded (see above). Upstream states the terms in ` +
                    `${project.licenseFiles.map((f) => `\`${f}\``).join(', ')}.`,
                '',
            );
        } else {
            for (const text of texts) {
                lines.push(
                    `<details><summary>${text.name}</summary>`,
                    '',
                    '```',
                    text.body.trimEnd(),
                    '```',
                    '',
                    '</details>',
                    '',
                );
            }
        }
    }

    return lines.join('\n');
}

/**
 * The AAR's `AndroidManifest.xml`. An AAR must have one; AGP reads the package name and the
 * SDK bounds from it and nothing else here needs to be in it — no permissions, no component,
 * no exported anything. The payload travels in `jni/` and `assets/`.
 */
export function renderAndroidManifest({ packageName, minSdk }) {
    return [
        '<?xml version="1.0" encoding="utf-8"?>',
        `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="${packageName}">`,
        `    <uses-sdk android:minSdkVersion="${minSdk}" />`,
        '</manifest>',
        '',
    ].join('\n');
}

/**
 * The AAR's entries, from the staged bytes. One place that knows the archive layout, so the
 * paths AGP keys on are asserted rather than spread across the writer.
 *
 * `classes.jar` IS INCLUDED AND IS EMPTY. An AAR has no required Java in it, but AGP's AAR
 * reader expects the entry to exist and a native-only AAR that omits it fails the app's
 * gradle run with a missing-file error rather than anything about this package. An empty ZIP
 * is 22 bytes and comes out of the same writer, so there is no second format here.
 *
 * @param {object} spec
 * @param {Record<string, { nodeGi: Buffer, libs: Map<string, Buffer> }>} spec.perAbi
 * @param {Map<string, Buffer>} spec.typelibs
 * @param {number} spec.mtime
 */
export function aarEntries({ perAbi, typelibs, mtime }) {
    const entries = [
        {
            path: 'AndroidManifest.xml',
            data: Buffer.from(renderAndroidManifest({ packageName: AAR_PACKAGE, minSdk: AAR_MIN_SDK }), 'utf8'),
        },
        { path: 'classes.jar', data: buildZip([], mtime) },
    ];
    for (const [abi, payload] of Object.entries(perAbi)) {
        // 0o755 on a shared library: the APK's own packaging sets the mode it needs, but an
        // AAR a human unzips to look at should produce something executable.
        entries.push({ path: `jni/${abi}/libnode_gi.so`, mode: 0o755, data: payload.nodeGi });
        for (const [soname, bytes] of payload.libs) {
            entries.push({ path: `jni/${abi}/${soname}`, mode: 0o755, data: bytes });
        }
    }
    for (const [name, bytes] of typelibs) {
        entries.push({ path: `${TYPELIB_ASSET_DIR}/${name}`, data: bytes });
    }
    return entries;
}

// ---------------------------------------------------------------------------------------
// The build itself: everything above decides, everything below reads and writes.
// ---------------------------------------------------------------------------------------

/**
 * The typelibs offered for one ABI, read from every directory given for it.
 *
 * REPEATABLE AND MERGED because a meson build tree does not have one directory: the x86_64
 * typelibs of the prefix this was developed against sit under
 * `bin-x86_64/subprojects/<project>/…`, one directory per project, while the arm64-v8a ones
 * are already collected into an install root. A flag that took a single directory would have
 * made the second ABI unbuildable, and the workaround would have been a hand-made copy of the
 * tree — which is the thing this script exists to replace.
 *
 * The same typelib from two directories with DIFFERENT bytes fails: that is two GI builds
 * being mixed, and whichever one won would be silent.
 */
function collectTypelibMetadata(abi, dirs) {
    const merged = new Map();
    for (const dir of dirs) {
        for (const typelib of readTypelibDir(dir)) {
            const seen = merged.get(typelib.name);
            if (seen !== undefined && !readFileSync(seen.file).equals(readFileSync(typelib.file))) {
                fail(
                    `${abi}: ${typelib.name} appears in both ${dirname(seen.file)} and ${dir} with different ` +
                        'contents. Those are two different GI builds; pick one tree.',
                );
            }
            merged.set(typelib.name, typelib);
        }
    }
    if (merged.size === 0) fail(`${abi}: no *.typelib found in ${dirs.join(', ')}`);
    return [...merged.values()];
}

/**
 * The typelibs this ABI may ship: the ones every one of whose backing libraries is in the
 * closure, plus the header-only ones, minus nothing that something shipped depends on.
 *
 * WHY THIS IS NOT "COPY THE TYPELIB DIRECTORY". The GI prefix offers 21 typelibs and the
 * closure bundles the libraries behind seven of them — GTK, Pango, HarfBuzz, graphene and
 * libadwaita are introspectable in the prefix and their `.so` files are not in
 * `libnode_gi.so`'s DT_NEEDED closure. Shipping `Gtk-4.0.typelib` anyway would make
 * `requireGi('Gtk', '4.0')` find a typelib, resolve its symbols against a `libgtk-4.so` that
 * is not in the APK, and die in `g_module_open` — a runtime failure that looks like a node-gi
 * bug, caused by a build that copied a directory.
 *
 * `planTypelibSet` is the same gate the darwin and win32 bundles use, and the reason this is
 * not re-derived here: its `blocked` case is the one worth having, where an unbacked typelib
 * CANNOT be silently dropped because a shipped namespace depends on it. That is a build
 * failure whose only correct repair is bundling the missing library.
 */
function planAbiTypelibs(abi, metadata, bundled) {
    const libraries = new Set(['libnode_gi.so', ...bundled]);
    // `caseInsensitive: false`: Android resolves a bare leaf through `dlopen`, which is
    // case-sensitive, like dyld and unlike `LoadLibrary`.
    const plan = planTypelibSet({
        typelibs: metadata,
        libraries,
        caseInsensitive: false,
        requiredNamespaces: REQUIRED_NAMESPACES,
    });
    if (plan.problems.length > 0) {
        fail(`${abi}: the typelib set is not self-contained:\n  - ${plan.problems.join('\n  - ')}`);
    }
    const out = new Map();
    for (const typelib of plan.copy) out.set(typelib.name, readFileSync(typelib.file));
    return { typelibs: out, dropped: plan.dropped.map((t) => t.name).sort() };
}

/** `--typelib-dir` values: `<abi>=<dir>` entries, or bare directories meaning "every ABI". */
function typelibDirsByAbi(specs, abis, giSysroot) {
    const byAbi = new Map(abis.map((abi) => [abi, []]));
    for (const spec of specs) {
        const match = /^([^=]+)=(.*)$/.exec(spec);
        if (match === null) {
            for (const abi of abis) byAbi.get(abi).push(requireDir('--typelib-dir', spec, 'a directory of *.typelib'));
            continue;
        }
        const [, abi, dir] = match;
        if (!byAbi.has(abi))
            fail(`--typelib-dir ${spec}: ${abi} is not among the ABIs being built (${abis.join(', ')})`);
        byAbi.get(abi).push(requireDir(`--typelib-dir ${abi}`, dir, 'a directory of *.typelib'));
    }
    for (const [abi, dirs] of byAbi) {
        if (dirs.length > 0) continue;
        byAbi.set(abi, [
            requireDir(
                `typelibs for ${abi}`,
                join(giSysroot, 'lib', abi, 'girepository-1.0'),
                'pass --typelib-dir <abi>=<dir> when the GI build keeps them elsewhere',
            ),
        ]);
    }
    return byAbi;
}

/**
 * A licence file as a regular file, following symlinks. A link whose target is missing is
 * an error naming both ends: the prefix was packed with links that only resolved on the
 * machine that built it, and dropping the file would ship a notice without that text.
 */
function resolveLicenseFile(path) {
    try {
        const real = realpathSync(path);
        return statSync(real).isFile() ? real : null;
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        const target = lstatSync(path).isSymbolicLink() ? readlinkSync(path) : '(not a link)';
        throw new Error(
            `--license-corpus: ${path} is a dangling symlink -> ${target}. The prefix was packed with a link ` +
                'to a file that is not in the archive, so its licence text is missing. Repack the prefix with ' +
                'symlinks dereferenced (tar -h) in gjsify/android-sysroot and bump build-inputs.json.',
        );
    }
}

/** `<project>/<file>` licence texts, or `null` when no corpus was supplied. */
export function readLicenseCorpus(dir) {
    if (dir === undefined) return null;
    const root = requireDir('--license-corpus', dir, 'a directory of <project>/<licence file>');
    const out = new Map();
    for (const project of readdirSync(root).sort()) {
        const projectDir = join(root, project);
        if (!statSync(projectDir).isDirectory()) continue;
        const texts = [];
        for (const name of readdirSync(projectDir).sort()) {
            const real = resolveLicenseFile(join(projectDir, name));
            if (real !== null) texts.push({ name, body: readFileSync(real, 'utf8') });
        }
        if (texts.length > 0) out.set(project, texts);
    }
    if (out.size === 0) fail(`--license-corpus ${root}: no <project>/<file> texts found`);
    return out;
}

/**
 * The sysroot's `libintl.so` is proxy-libintl, which never opens a `.mo`: every dgettext
 * answers its msgid. The AAR carries this package's own reader instead (libintl/libintl.c,
 * same `g_libintl_*` surface), compiled here with the NDK so the sysroot pin need not move.
 */
export const LIBINTL_SONAME = 'libintl.so';
const LIBINTL_TARGETS = { 'arm64-v8a': 'aarch64-linux-android', x86_64: 'x86_64-linux-android' };

function buildLibintl(ndk, abi, abiStage) {
    const clang = ndkTool(ndk, 'clang');
    const strip = ndkTool(ndk, 'llvm-strip');
    const out = join(abiStage, 'libintl.built.so');
    execFileSync(clang, [
        `--target=${LIBINTL_TARGETS[abi]}24`, '-shared', '-fPIC', '-Os', '-fvisibility=hidden',
        '-Wl,-soname,libintl.so', '-Wl,--gc-sections', '-o', out, join(pkgDir, 'libintl', 'libintl.c'),
    ]);
    execFileSync(strip, ['--strip-unneeded', out]);
    const bytes = readFileSync(out);
    rmSync(out);
    return bytes;
}

function main() {
    const opts = parseArgs(process.argv.slice(2));
    const ndk = requireDir('--ndk', opts.ndk, 'set ANDROID_NDK_HOME or pass --ndk');
    const readelf = ndkTool(ndk, 'llvm-readelf');
    const strip = ndkTool(ndk, 'llvm-strip');
    const giSysroot = requireDir('--gi-sysroot', opts.giSysroot, 'the Android GI prefix, as in build-android.mjs');
    const nodeGiLib = requireDir('--node-gi-lib', opts.nodeGiLib, "build-android.mjs's --out directory");
    const outDir = opts.out ? resolve(opts.out) : join(pkgDir, 'platforms', 'android');
    const stageDir = join(pkgDir, 'stage');
    const table = JSON.parse(readFileSync(join(pkgDir, 'licenses', 'bundled-projects.json'), 'utf8'));
    const declared = JSON.parse(readFileSync(join(pkgDir, 'typelib-abi-divergence.json'), 'utf8'));
    const corpus = readLicenseCorpus(opts.licenseCorpus);
    const typelibDirs = typelibDirsByAbi(opts.typelibDirs, opts.abis, giSysroot);

    const perAbiPayload = {};
    const perAbiTypelibs = {};
    const report = {};

    for (const abi of opts.abis) {
        const libDir = requireDir(`--gi-sysroot lib/${abi}`, join(giSysroot, 'lib', abi), 'built for this ABI?');
        const addon = join(nodeGiLib, abi, 'libnode_gi.so');
        if (!existsSync(addon)) {
            fail(
                `${abi}: ${addon} does not exist — run @gjsify/node-gi's scripts/build-android.mjs --abi ${abi} first`,
            );
        }

        // The closure walk. `needed` answers for the prefix only; `null` means "not here",
        // which planClosure then holds against SYSTEM_PROVIDED.
        const cache = new Map();
        const needed = (soname) => {
            if (cache.has(soname)) return cache.get(soname);
            const path = soname === 'libnode_gi.so' ? addon : join(libDir, soname);
            const answer = existsSync(path)
                ? parseNeeded(execFileSync(readelf, ['-d', path], { encoding: 'utf8' }))
                : null;
            cache.set(soname, answer);
            return answer;
        };
        // ADR 0117 § 2: the selected namespaces' backing libraries enter the walk as
        // SEEDS. Nothing in `libnode_gi.so`'s link graph reaches libgtk-4 or libsoup —
        // that is the whole reason the payload needed a declaration rather than a
        // measurement — so without this they would be unreachable and their typelibs
        // would be dropped as unbacked. Read per ABI because the typelib dirs are.
        const metadata = collectTypelibMetadata(abi, typelibDirs.get(abi));
        const { seeds, resolved } = planGiRoots({ namespaces: opts.giNamespaces, typelibs: metadata });
        const { bundle, system } = planClosure({ roots: ['libnode_gi.so'], seeds, needed });

        // `--strip-unneeded` and not `--strip-all`: these are shared libraries, and
        // --strip-all on a .so removes the dynamic symbols the loader resolves through.
        const abiStage = join(stageDir, abi);
        const libs = new Map();
        let nodeGi = null;
        if (!opts.dryRun) {
            rmSync(abiStage, { recursive: true, force: true });
            mkdirSync(abiStage, { recursive: true });
            for (const soname of ['libnode_gi.so', ...bundle]) {
                const src = soname === 'libnode_gi.so' ? addon : join(libDir, soname);
                const dst = join(abiStage, soname);
                execFileSync(strip, ['--strip-unneeded', '-o', dst, src]);
                const bytes = readFileSync(dst);
                if (soname === 'libnode_gi.so') nodeGi = bytes;
                else if (soname === LIBINTL_SONAME) libs.set(soname, buildLibintl(ndk, abi, abiStage));
                else libs.set(soname, bytes);
            }
            perAbiPayload[abi] = { nodeGi, libs };
        }

        const plan = planAbiTypelibs(abi, metadata, bundle);
        perAbiTypelibs[abi] = plan.typelibs;
        report[abi] = {
            bundled: bundle,
            system: system.map((soname) => ({ soname, provider: SYSTEM_PROVIDED.get(soname) })),
            typelibs: [...plan.typelibs.keys()],
            droppedTypelibs: plan.dropped,
            selected: resolved.map((entry) => entry.key),
        };
        // A SELECTED namespace that still did not survive is reported here and not left to
        // the dropped list, where it would read as one of the 14 the core never wanted.
        // `planAbiTypelibs` already fails on the `blocked` case; this is the other one — a
        // namespace whose own backer the seed walk could not satisfy.
        const unshipped = resolved
            .filter((entry) => !plan.typelibs.has(`${entry.key}.typelib`))
            .map((entry) => entry.key);
        if (unshipped.length > 0) {
            fail(
                `${abi}: ${unshipped.join(', ')} ${unshipped.length === 1 ? 'was' : 'were'} selected but ` +
                    'did not survive the backer check, so the AAR would advertise a namespace it cannot load.',
            );
        }
        console.log(
            `${abi}: libnode_gi.so + ${bundle.length} bundled, ${system.length} system-provided, ` +
                `${plan.typelibs.size}/${metadata.length} typelibs (dropped, unbacked: ${plan.dropped.join(', ') || 'none'})` +
                (resolved.length > 0 ? `; selected: ${resolved.map((entry) => entry.key).join(', ')}` : ''),
        );
    }

    const typelibPlan = planTypelibs({ perAbi: perAbiTypelibs, declared });
    const typelibs = perAbiTypelibs[typelibPlan.sourceAbi];
    console.log(
        `typelibs: ${typelibPlan.typelibs.length} from ${typelibPlan.sourceAbi}` +
            (typelibPlan.divergent.length > 0
                ? `, ${typelibPlan.divergent.join(', ')} declared ABI-divergent`
                : ', all ABI-identical'),
    );

    const notice = renderNotice({
        bundled: [...new Set(opts.abis.flatMap((abi) => report[abi].bundled))],
        system: [...new Set(opts.abis.flatMap((abi) => report[abi].system.map((entry) => entry.soname)))],
        table,
        corpus,
        abis: opts.abis,
    });

    if (opts.dryRun) {
        console.log(`dry run: would write ${join(outDir, 'gi-runtime-android.aar')} and the notice; nothing written`);
        return;
    }

    const entries = aarEntries({ perAbi: perAbiPayload, typelibs, mtime: opts.mtime });
    const aar = buildZip(entries, opts.mtime);

    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'gi-runtime-android.aar'), aar);
    // The notice sits one level up, beside `platforms/android`, because `package.json`'s
    // `license` names `platforms/THIRD-PARTY-NOTICES.md` and `files` ships `platforms`.
    writeFileSync(join(dirname(outDir), 'THIRD-PARTY-NOTICES.md'), notice);
    writeFileSync(
        join(outDir, 'gi-runtime.json'),
        `${JSON.stringify(
            {
                builtAt: new Date().toISOString(),
                abis: opts.abis,
                giSysroot,
                libraries: Object.fromEntries(
                    opts.abis.map((abi) => [
                        abi,
                        [['libnode_gi.so', perAbiPayload[abi].nodeGi], ...perAbiPayload[abi].libs].map(
                            ([name, bytes]) => ({
                                name,
                                bytes: bytes.length,
                                sha256: sha256(bytes),
                            }),
                        ),
                    ]),
                ),
                systemProvided: report[opts.abis[0]].system,
                typelibSourceAbi: typelibPlan.sourceAbi,
                typelibDivergence: typelibPlan.divergent,
                typelibs: [...typelibs].map(([name, bytes]) => ({ name, bytes: bytes.length, sha256: sha256(bytes) })),
                aar: { bytes: aar.length, sha256: sha256(aar) },
            },
            null,
            4,
        )}\n`,
    );
    if (!opts.keepStage) rmSync(stageDir, { recursive: true, force: true });

    const payloadBytes = opts.abis.map(
        (abi) =>
            perAbiPayload[abi].nodeGi.length +
            [...perAbiPayload[abi].libs.values()].reduce((sum, b) => sum + b.length, 0),
    );
    console.log(`wrote ${join(outDir, 'gi-runtime-android.aar')} — ${aar.length} bytes`);
    for (const [i, abi] of opts.abis.entries()) {
        console.log(`  ${abi}: ${payloadBytes[i]} bytes of stripped native libraries`);
    }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
