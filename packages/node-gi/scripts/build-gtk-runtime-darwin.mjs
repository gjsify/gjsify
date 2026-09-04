// SPDX-License-Identifier: MIT
// Collect + relocate a standalone, batteries-included GTK/GObject-Introspection
// runtime bundle for macOS — so @gjsify/node-gi's conformance runs with NO
// Homebrew GTK on the host (Phase 2 of cross-platform node-gi).
//
//   node ../scripts/build-gtk-runtime-darwin.mjs [--out <dir>] [--windowing]
//                                               [--addon <node_gi.node>] [--stage <dir>]
//
// ONE script for EVERY darwin target. It serves both
// @gjsify/gtk-runtime-darwin-arm64 and @gjsify/gtk-runtime-darwin-x64, because the
// only arch-dependent thing about the whole pass was a hard `process.arch` gate and
// a hardcoded manifest stamp — the otool closure walk, the install_name_tool
// rewrite to @loader_path, the ad-hoc codesign (mandatory on Apple silicon,
// harmless on Intel) and the --windowing superset are arch-agnostic. Copying it per
// package would have been the THIRD near-duplicate of a 359-line relocation pass;
// it lives HERE — beside the packages, inside packages/node-gi/** — rather than in
// the repo-root scripts/ dir on purpose: packages/node-gi/** is the affected
// classifier's IGNORE list and node-gi.yml's `paths:` trigger, so an edit here runs
// node-gi's own CI and does NOT force a full main.yml run (which every scripts/**
// edit does, landing in `unmatched`).
//
// THE TARGET IS DERIVED, NEVER PASSED: `darwin-${process.arch}` comes from the
// running Node, exactly like scripts/stage-prebuild.mjs, so a leg structurally
// cannot stamp one arch's closure with another arch's name. `--out` is additionally
// cross-checked against the DESTINATION package's own `os`/`cpu` declaration, so an
// x64 runner cannot populate the arm64 package's `gtk/` (the shape that shipped
// x86-64 binaries into `prebuilds/linux-ppc64/` for weeks).
//
// Runs ONLY on darwin with a build-time Homebrew GTK stack installed (the closure
// SOURCE — not shipped). It:
//   1. Walks the dylib graph (`otool -L`, recursively) from the typelib-backing
//      libraries the conformance loads (glib/gobject/gio + girepository + cairo +
//      pango + graphene + gdk-pixbuf + gtk4), collecting every Homebrew dylib.
//   2. Copies them flat into <out>/lib and RELOCATES each: rewrites its own id +
//      every sibling reference to `@loader_path/<leaf>` (via install_name_tool),
//      leaving /usr/lib + /System refs untouched, then AD-HOC RE-SIGNS it
//      (`codesign -s -`) — mandatory on Apple silicon: install_name_tool
//      invalidates the code signature and dyld refuses an unsigned/mis-signed
//      dylib. On Intel the signature is not enforced, but re-signing keeps ONE
//      code path.
//   2b. (--windowing) Copies the gdk-pixbuf image LOADERS into their nested
//      lib/gdk-pixbuf-2.0/2.10.0/loaders/ and relocates them the same way, but with a
//      `@loader_path/../../..` dep prefix, then regenerates a bundle-relative
//      loaders.cache. They are the DECODERS for the icon theme § 4b ships.
//   3. VERIFIES the relocation of everything § 2 and § 2b produced (see
//      verifyRelocation) — the assertion is brew-prefix-DERIVED, because the prefix
//      is /opt/homebrew on Apple silicon and /usr/local on Intel: a hardcoded
//      `/opt/homebrew` grep passes vacuously on an Intel runner and would have
//      proven nothing about the arch this script exists to add.
//   4. Copies the typelib set into <out>/girepository-1.0 — but ONLY the typelibs
//      whose backing library the closure above actually bundled, and then ASSERTS
//      that symmetry over the finished bundle (see § 4/6 and typelib-backers.mjs).
//   5. Collects the license terms of every bundled dylib from the kegs it came from
//      and writes THIRD-PARTY-NOTICES.md, incl. the relocation/re-sign statement.
//   6. (optional) Relocates a COPY of the node-gi addon (--addon) so it loads the
//      BUNDLED libgirepository via `@rpath` (add_rpath @loader_path/gtk/lib) with
//      NO Homebrew — the env-free path the core conformance leg exercises.
//
// The result is portable: none of the bundled libraries reference the build host's
// Homebrew prefix. Reference: GJS ships no relocation; the technique mirrors macOS
// app-bundle dylib fix-up (install_name_tool + @loader_path + ad-hoc codesign).
import { execFileSync } from 'node:child_process';
import {
    copyFileSync,
    cpSync,
    existsSync,
    lstatSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    realpathSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    copyTreeDereferenced,
    duplicatedModuleLeaves,
    findSymlinks,
    formatDuplicatedModuleProblems,
    formatSymlinkProblems,
    formatWindowingDataProblems,
    verifyWindowingData,
} from './bundle-data.mjs';
import {
    assertLicenseCoverage,
    describeBrewKegs,
    formatLicenseProblems,
    renderThirdPartyNotice,
    writeLicensePayload,
} from './bundle-licenses.mjs';
import { decodeProbeProblems, spawnDecodeProbe } from './decode-probe.mjs';
import { isBundledGstPlugin, missingBundledGstPlugins, missingRequiredGstPlugins } from './gst-plugins.mjs';
import {
    REQUIRED_NAMESPACES,
    WINDOWING_REQUIRED_NAMESPACES,
    formatTypelibProblems,
    nativeLibraryIndex,
    planTypelibSet,
    readTypelibDir,
    verifyBundleTypelibs,
} from './typelib-backers.mjs';

const scriptsDir = dirname(fileURLToPath(import.meta.url)); // packages/node-gi/scripts
const pillarDir = dirname(scriptsDir); // packages/node-gi
// Repo-relative path recorded in the shipped manifest, so a consumer holding only
// the tarball can find the recipe that produced its bytes (the tarball no longer
// carries a per-package copy of it).
const BUILDER_ID = 'packages/node-gi/scripts/build-gtk-runtime-darwin.mjs';

if (process.platform !== 'darwin') {
    console.error(`build-gtk-runtime: only supported on darwin, not ${process.platform}`);
    process.exit(2);
}

/** The one true target: what the RUNNING machine is, never an argument. */
const TARGET = `darwin-${process.arch}`;

// --- args ------------------------------------------------------------------
function argValue(flag) {
    const i = process.argv.indexOf(flag);
    return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}
// Default destination = the sibling platform package for THIS arch. Derived, so
// `npm run build:bundle` from either package lands in the right place and cannot
// land in the wrong one.
const OUT = argValue('--out') ?? join(pillarDir, `gtk-runtime-${TARGET}`, 'gtk');
const ADDON = argValue('--addon'); // optional: a node_gi.node to relocate a copy of
const STAGE = argValue('--stage'); // optional: sibling layout <stage>/{node_gi.node,gtk/}

// Cross-check an explicit --out against the DESTINATION package's own platform
// declaration. `os`/`cpu` in that package.json is the npm-enforced truth about
// which machine may populate it, so this needs no second list to keep in sync. A
// destination that is not a package (a scratch dir, node-gi's prebuilds staging)
// is skipped — the derived TARGET above already fixes the manifest stamp.
function assertOutMatchesHost(outDir) {
    const manifestPath = join(dirname(outDir), 'package.json');
    if (!existsSync(manifestPath)) return;
    let pkg;
    try {
        pkg = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch {
        return; // not our concern — a malformed manifest fails elsewhere, loudly
    }
    const os = Array.isArray(pkg.os) ? pkg.os : null;
    const cpu = Array.isArray(pkg.cpu) ? pkg.cpu : null;
    if (!os && !cpu) return;
    const okOs = !os || os.includes(process.platform);
    const okCpu = !cpu || cpu.includes(process.arch);
    if (okOs && okCpu) return;
    console.error(
        `build-gtk-runtime: --out ${outDir} belongs to ${pkg.name ?? manifestPath}, which declares ` +
            `os=${JSON.stringify(os)} cpu=${JSON.stringify(cpu)} — this runner is ${process.platform}/${process.arch}. ` +
            `Refusing to write one arch's closure into another arch's package.`,
    );
    process.exit(1);
}
assertOutMatchesHost(OUT);

const sh = (bin, args) => execFileSync(bin, args, { encoding: 'utf8' });

const brewPrefix = sh('brew', ['--prefix']).trim();
const brewLib = join(brewPrefix, 'lib');
const brewTypelibs = join(brewLib, 'girepository-1.0');
if (!existsSync(brewLib)) {
    console.error(`build-gtk-runtime: ${brewLib} not found — install the GTK stack first (brew install gtk4 …)`);
    process.exit(1);
}

// The typelib-backing libraries the DISPLAY-FREE conformance closure loads.
// Version-agnostic base patterns matched against $(brew --prefix)/lib. The
// recursive otool walk pulls every transitive Homebrew dep (harfbuzz, fribidi,
// fontconfig, freetype, pixman, png, intl, pcre2, ffi, epoxy, …).
const SEED_PATTERNS = [
    /^libgirepository-2\.0\..*\.dylib$/, // GIRepository (merged into glib on modern brew)
    /^libglib-2\.0\..*\.dylib$/,
    /^libgobject-2\.0\..*\.dylib$/,
    /^libgio-2\.0\..*\.dylib$/,
    /^libgmodule-2\.0\..*\.dylib$/,
    /^libcairo(-gobject|-script-interpreter)?\.[\d.]*dylib$/,
    /^libpango-1\.0\..*\.dylib$/,
    /^libpangocairo-1\.0\..*\.dylib$/,
    /^libpangoft2-1\.0\..*\.dylib$/,
    /^libgraphene-1\.0\..*\.dylib$/,
    /^libgdk_pixbuf-2\.0\..*\.dylib$/,
    /^libgtk-4\..*\.dylib$/, // provides the Gdk typelib's backing library
    // harfbuzz's GObject binding, which is NOT in anyone's link closure (nothing
    // links libharfbuzz-gobject; harfbuzz proper arrives transitively via pango).
    // It is a BASE seed all the same, because `Pango-1.0` DEPENDS on the
    // `HarfBuzz-0.0` typelib: gi_repository_require('Pango') loads HarfBuzz first,
    // so the bundle needs HarfBuzz's backer or it needs to not ship Pango. Measured
    // on the published 0.27.1 darwin bundles: HarfBuzz-0.0.typelib shipped with
    // libharfbuzz-gobject.0.dylib absent — the win32 bundle bundles it only by
    // accident (its `^harfbuzz.*\.dll$` seed happens to match harfbuzz-gobject.dll).
    /^libharfbuzz-gobject\.[\d.]*dylib$/,
];

// WINDOWING superset (opt-in via --windowing): also bundle libadwaita, whose dylib
// backs the Adw-1 typelib, AND libgtksourceview-5, whose dylib backs the GtkSource-5
// typelib. libgtksourceview backs the Learn6502 editor (a GtkSource.View subclass) —
// the app-gnome node-gi port. This is what the macOS GTK-GUI proof
// (macos-gtk-windowing) needs; the recursive otool walk pulls each seed's transitive
// deps + relocates them like any other seed. Mirrors the win32 --windowing superset
// (WINDOWING_SEED_PATTERNS there), and its runtime DATA is § 2b (the gdk-pixbuf image
// loaders — native code, hence the early section) + § 4b (schemas, icon themes,
// GtkSource language-specs/styles).
//
// WHICH VARIANT SHIPS: since 0.27.2 release.yml publishes the --windowing SUPERSET,
// because that is the complete runtime a consumer of "batteries-included GTK" wants;
// the DISPLAY-FREE default is the CONFORMANCE variant node-gi.yml builds (its closure
// is the set the display-free conformance loads, nothing more). The published 0.27.1
// tarballs were the display-free variant — `"windowing": false, "dataBytes": 0` — so
// they carried Adw-1.typelib with NO libadwaita, no GSettings schemas and no icons.
// The typelib planner in § 4 makes the two variants HONEST rather than merely
// different: whichever seeds are in play, the bundle ships exactly the typelibs it
// can back.
const WINDOWING = process.argv.includes('--windowing');
const WINDOWING_SEED_PATTERNS = [
    /^libadwaita-1\..*\.dylib$/,
    /^libgtksourceview-5\..*\.dylib$/,
    // librsvg, which backs the SVG gdk-pixbuf loader § 2b bundles — the decoder for the
    // 715 symbolic SVGs of the Adwaita theme § 4b already ships. It needs its OWN seed
    // because nothing in the closure LINKS it (measured: neither libgtk-4 nor libadwaita
    // has an otool ref to it; it is a formula-level dep of gtk4/libadwaita/gtksourceview5/
    // adwaita-icon-theme, and gdk-pixbuf reaches it through g_module_open, not a link).
    // Seeding it is also what stops `Rsvg-2.0.typelib` being DROPPED by § 4's symmetry
    // rule: that drop was CORRECT while the library was absent, and it is the visible
    // trace of the missing decoder — a bundle that ships the icons but nothing to
    // rasterize them.
    /^librsvg-2\.\d+\.dylib$/,
    // GStreamer, backing the Gst + GstApp typelibs `@gjsify/webaudio` imports. Its
    // PLUGINS are § 2c — native modules in a nested dir, like the pixbuf loaders.
    //
    // TWO seeds, not one. The otool walk reaches libgstbase/audio/pbutils/tag/video
    // from libgstreamer, but `libgstapp` is NOT among them: it is a
    // gst-plugins-base library that only an appsrc/appsink user links, which is
    // precisely what the decode pipeline is. Seeding libgstreamer alone would leave
    // `GstApp-1.0.typelib` unbacked and § 4's symmetry rule would DROP it — a green
    // build with no audio and no message, the same trace librsvg left above.
    /^libgstreamer-1\.0\..*\.dylib$/,
    /^libgstapp-1\.0\..*\.dylib$/,
    // libsoup, which `libgstsoup` § 2c ships opens with g_module_open rather than
    // linking (its loader shim picks libsoup-3 or libsoup-2 at runtime) — so the
    // plugin's own otool deps are glib + gstreamer and the closure walk finds no soup
    // at all. Third seed of the librsvg kind, third time the reason is "a module the
    // walk cannot see"; gst-plugins.mjs § soup carries the measurement. It also backs
    // `Soup-3.0.typelib`, which § 4's symmetry rule was correctly dropping.
    /^libsoup-3\.0\..*\.dylib$/,
];

function isSystemPath(p) {
    return p.startsWith('/usr/lib/') || p.startsWith('/System/');
}

/** `realpathSync` that answers null instead of throwing, for refs like `@rpath/x`. */
function realpathOrNull(p) {
    try {
        return realpathSync(p);
    } catch {
        return null;
    }
}

/**
 * Record where a bundled binary really came from, for § 5's per-keg attribution: brew LINKS
 * a keg's files into its prefix, and only the RESOLVED path runs through
 * `…/Cellar/<formula>/<version>/`, which is the whole basis of the darwin licence mapping.
 * A path that is not a link is its own source, so an unresolvable one is recorded as given
 * rather than dropped. Every module list in § 2b–2d needs this and each used to spell the
 * same try/catch out again.
 * @param {Map<string, string>} sources leaf -> the path § 5 attributes through
 * @param {string} leaf the name the binary ships under
 * @param {string} src the path it was copied from
 */
function recordBinarySource(sources, leaf, src) {
    sources.set(leaf, realpathOrNull(src) ?? src);
}

// Parse an `otool -L <lib>` output into the list of dependency install paths
// (skipping the library's own id and system libraries).
//
// THE ID IS NOT DROPPED BY POSITION, and the difference is a shipped defect. `otool -L
// <file>` prints `<file>:` as its first line and then, FOR A DYLIB ONLY, the install
// name (LC_ID_DYLIB) before the real dependencies — a loadable BUNDLE (a GIO module, a
// gdk-pixbuf loader) carries no id at all, so `slice(1)` cannot mean "past the id" for
// both shapes and used to leave every dylib's own id in the list. That was inert only
// while § 1 resolved a LEAF against `<prefix>/lib`: a plugin's leaf is not there. Once
// § 1 began resolving whole REFERENCES (resolveBrewDep, for keg-only formulas), the id
// — an absolute path into the Cellar — resolved to the plugin itself, and all 24
// GStreamer plugins were copied into flat `lib/` beside the copies § 2c places, +3.4
// MiB of duplicates. Measured on the darwin-x64 artifact of the run that added `soup`.
// So the id is removed BY VALUE: nothing links itself, and the check costs one
// realpath per line.
function otoolDeps(libPath) {
    let out;
    try {
        out = sh('otool', ['-L', libPath]);
    } catch {
        return [];
    }
    const self = realpathOrNull(libPath);
    const lines = out.split('\n').slice(1); // line 0 is the `<file>:` header
    const deps = [];
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const path = trimmed.split(' (')[0];
        if (!path || isSystemPath(path)) continue;
        if (self && realpathOrNull(path) === self) continue; // the image's own id
        deps.push(path);
    }
    return deps;
}

// Resolve a dependency's leaf to the real Homebrew file (following symlinks),
// or null when it is not a Homebrew library we bundle.
function resolveInBrew(leaf) {
    const candidate = join(brewLib, leaf);
    return existsSync(candidate) ? realpathOrNull(candidate) : null;
}

/**
 * Resolve a dependency REFERENCE — the whole string in the Mach-O load command, not just its
 * leaf — to the real Homebrew file behind it.
 *
 * The leaf lookup above is the normal path and stays first: `<prefix>/lib` is where brew links
 * every non-keg-only formula, and a leaf is all a queued dependency used to carry. It is not
 * enough for a KEG-ONLY formula, which brew deliberately never links into `lib/` — and the
 * reference then names the keg directly. Measured while adding libsoup: it links
 * `/usr/local/opt/sqlite/lib/libsqlite3.dylib`, the leaf lookup found nothing, sqlite never
 * entered the closure, and § 3 refused the bundle for a reference into the build prefix. That
 * refusal was correct; resolving the reference where it points is the repair the message asked
 * for, and it is what makes any future keg-only dependency arrive instead of stopping a build.
 * Still prefix-scoped: an /opt/X11 or /usr/lib reference stays OS-provided, as § 3 requires.
 * @param {string} ref a load-command string, or a bare leaf for the seeds
 * @returns {string|null}
 */
function resolveBrewDep(ref) {
    const linked = resolveInBrew(basename(ref));
    if (linked) return linked;
    if (!ref.startsWith(`${brewPrefix}/`) || !existsSync(ref)) return null;
    return realpathOrNull(ref);
}

// --- 1. discover the closure ----------------------------------------------
console.log(
    `build-gtk-runtime: target ${TARGET}, brew prefix ${brewPrefix}` +
        `${WINDOWING ? ' (windowing superset — + libadwaita + libgtksourceview)' : ' (display-free)'}`,
);
const seedPatterns = WINDOWING ? [...SEED_PATTERNS, ...WINDOWING_SEED_PATTERNS] : SEED_PATTERNS;
const seeds = readdirSync(brewLib).filter((f) => seedPatterns.some((re) => re.test(f)));
if (seeds.length === 0) {
    console.error('build-gtk-runtime: no seed libraries found — is the GTK stack installed?');
    process.exit(1);
}
console.log(`build-gtk-runtime: ${seeds.length} seed libraries: ${seeds.join(', ')}`);

// The GStreamer plugins § 2c ships must SEED THIS WALK, not merely be copied after
// it. They live outside lib/, so nothing in the seed closure links them — and their
// own dependencies (libgstaudio/tag/riff/pbutils from the gstreamer keg, plus orc
// and libvorbis) therefore never entered it. Measured: every kept plugin came out
// referencing `/opt/homebrew/Cellar/gstreamer/<ver>/lib/…`, and § 3 refused the
// bundle — correctly, because those paths do not exist on a user's machine. Same
// shape the win32 builder already had for its plugins and its pixbuf loaders.
const gstPluginSeedPaths = [];
const gstPluginSkips = { nonAudio: 0, dangling: 0 };
if (WINDOWING) {
    const dir = join(brewLib, 'gstreamer-1.0');
    if (existsSync(dir)) {
        for (const f of readdirSync(dir)) {
            if (!f.endsWith('.dylib') && !f.endsWith('.so')) continue;
            // The AUDIO PATH only — gst-plugins.mjs says why "everything the prefix
            // has" is not an option and what the rule replaced it with.
            if (!isBundledGstPlugin(f)) {
                gstPluginSkips.nonAudio++;
                continue;
            }
            // A DANGLING LINK IS A PLUGIN THAT IS NOT INSTALLED. brew links every
            // plugin any formula ever provided into this one dir and leaves the link
            // when the keg goes — `libgstnice.dylib` on the arm64 runner points at a
            // libnice keg that is not there. `existsSync` FOLLOWS the link, so this
            // is the check, and the skips are COUNTED rather than swallowed: a plugin
            // quietly missing from the payload is the failure this area prevents.
            const src = join(dir, f);
            if (!existsSync(src)) {
                gstPluginSkips.dangling++;
                continue;
            }
            gstPluginSeedPaths.push(src);
        }
    }
}

// The GIO modules § 2d ships, seeding the walk for the same reason: nothing LINKS a
// module, so glib-networking's gnutls closure (gnutls, nettle, hogweed, gmp, p11-kit,
// libtasn1, libidn2, libunistring — 6.67 MiB measured on darwin-x64) enters only here.
// No filter: the module dir holds implementations of GIO extension points and the
// bundle wants whichever the prefix installed. `giomodule.cache` is skipped — it
// indexes the BUILD host's dir, and GIO rebuilds what it needs by scanning.
const gioModuleSeedPaths = [];
if (WINDOWING) {
    const dir = join(brewLib, 'gio', 'modules');
    if (existsSync(dir)) {
        for (const f of readdirSync(dir)) {
            // `.so` on darwin, not `.dylib`: GIO modules are loadable bundles.
            if (!f.endsWith('.so') && !f.endsWith('.dylib')) continue;
            const src = join(dir, f);
            if (!existsSync(src)) continue; // dangling brew link — the keg is gone
            gioModuleSeedPaths.push(src);
        }
    }
}

const bundled = new Map(); // leaf -> real source path
const queue = [...seeds];
// Walk the plugins' and modules' deps into the closure WITHOUT adding the plugins or
// modules themselves to `bundled` — they are not flat lib/ entries; § 2c and § 2d
// place and relocate them.
// The queue carries whole load-command strings, not leaves: a keg-only formula is
// reachable only through the path its dependent names (see resolveBrewDep). A seed is a
// bare leaf, which basename() leaves alone.
for (const pluginPath of [...gstPluginSeedPaths, ...gioModuleSeedPaths]) {
    for (const dep of otoolDeps(pluginPath)) queue.push(dep);
}
while (queue.length) {
    const ref = queue.shift();
    const leaf = basename(ref);
    if (bundled.has(leaf)) continue;
    const real = resolveBrewDep(ref);
    if (!real) continue; // system / non-brew dep — leave as-is
    bundled.set(leaf, real);
    for (const dep of otoolDeps(real)) {
        if (!bundled.has(basename(dep))) queue.push(dep);
    }
}
console.log(`build-gtk-runtime: closure = ${bundled.size} dylibs`);

// --- 2. copy + relocate + re-sign -----------------------------------------
const libOut = join(OUT, 'lib');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(libOut, { recursive: true });

for (const [leaf, src] of bundled) {
    copyFileSync(src, join(libOut, leaf));
}

const bundledLeaves = new Set(bundled.keys());
// depPrefix = where the BUNDLED dependencies live, seen from the image being rewritten.
// It is a parameter and not the hardcoded `@loader_path` it used to be, because
// @loader_path is the DEPENDENT's own directory: correct for the flat lib/ walk, wrong
// for anything nested. A gdk-pixbuf loader (§ 2b) sits at
// lib/gdk-pixbuf-2.0/2.10.0/loaders/, three levels below lib/, so its refs must climb
// back — the default keeps every existing call meaning exactly what it did.
function relocate(libPath, { id, depPrefix = '@loader_path' } = {}) {
    // Own id — a no-op on a Mach-O BUNDLE that carries no LC_ID_DYLIB (ten of the
    // thirteen pixbuf loaders), and load-bearing on the ones that do: librsvg's loader
    // ids itself as an absolute keg path, which § 3 rejects as a build-host leak.
    if (id) execFileSync('install_name_tool', ['-id', `@loader_path/${basename(libPath)}`, libPath]);
    // Rewrite every dependency that points at a library WE bundle → the bundle's lib/.
    // `-change` matches the old string VERBATIM, so this also catches the `@rpath/…`
    // form (librsvg's loader references `@rpath/librsvg-2.2.dylib`): basename() finds
    // the leaf in the bundled set and the result no longer depends on whatever LC_RPATH
    // the upstream build happened to bake in.
    for (const dep of otoolDeps(libPath)) {
        if (bundledLeaves.has(basename(dep))) {
            execFileSync('install_name_tool', ['-change', dep, `${depPrefix}/${basename(dep)}`, libPath]);
        }
    }
    // Ad-hoc re-sign — install_name_tool invalidated the signature (arm64 hard req).
    execFileSync('codesign', ['--force', '--sign', '-', libPath]);
}

for (const leaf of bundledLeaves) {
    relocate(join(libOut, leaf), { id: true });
}
console.log(`build-gtk-runtime: relocated + re-signed ${bundledLeaves.size} dylibs → @loader_path`);

/** A build tool from the source prefix, falling back to PATH. Used by § 2b and § 4b. */
const findTool = (leaf) => {
    const inBrew = join(brewPrefix, 'bin', leaf);
    return existsSync(inBrew) ? inBrew : leaf;
};

// --- 2b. WINDOWING: the gdk-pixbuf image LOADERS ---------------------------
// The decoders. Without them gdk-pixbuf decodes NOTHING and every SVG in the icon theme
// § 4b ships fails to load with no diagnostic at all — measured on a real macOS x64 host
// against the published @gjsify/gtk-runtime-darwin-x64@0.28.0:
// `GdkPixbuf.Pixbuf.new_from_file()` on that bundle's OWN
// share/icons/Adwaita/symbolic/actions/open-menu-symbolic.svg returned NULL, i.e. 22 MB
// of icon theme (715 SVGs) with no decoder for a single one of them. It looks like a
// theming bug and is a missing module.
//
// This lives HERE and not with the other windowing data in § 4b because it is NATIVE
// CODE, not plain files: the loaders are Mach-O images in a NESTED dir (unlike win32's
// § 4a, which just copies DLLs — Windows resolves those by search path), so they need
// the same copy → relocate → re-sign pass as § 2 with a ../../.. dep prefix, and § 3
// then VERIFIES them. That verification is the point: a ref this pass misses would load
// fine on the build host and resolve nothing on a machine without Homebrew.
const pixbufLoaderImages = []; // absolute paths in the bundle, for § 3
const pixbufLoaderSources = new Map(); // leaf -> keg realpath, for § 5's attribution
if (WINDOWING) {
    const loadersSrc = join(brewLib, 'gdk-pixbuf-2.0', '2.10.0', 'loaders');
    const loadersOut = join(OUT, 'lib', 'gdk-pixbuf-2.0', '2.10.0', 'loaders');
    if (existsSync(loadersSrc)) {
        mkdirSync(loadersOut, { recursive: true });
        for (const f of readdirSync(loadersSrc)) {
            const src = join(loadersSrc, f);
            const dest = join(loadersOut, f);
            // copyFileSync DEREFERENCES, which is required and not incidental: brew links
            // the svg loader in from librsvg's keg (twice — as .so AND .dylib, which is
            // why `Pixbuf.get_formats()` lists `svg` twice: the prefix registers both and
            // this ships what the prefix has), and a link into the Cellar is worthless in
            // a tarball. The realpath is also what § 5 attributes the binary through.
            copyFileSync(src, dest);
            pixbufLoaderImages.push(dest);
            recordBinarySource(pixbufLoaderSources, f, src);
        }
        for (const image of pixbufLoaderImages) {
            relocate(image, { id: true, depPrefix: '@loader_path/../../..' });
        }
        // The cache maps each decoder to its mime types/extensions/signature, and its
        // module paths are what gdk-pixbuf hands to g_module_open. Run the query tool
        // over the BUNDLE's own copies, so the cache describes the modules that ship,
        // then rewrite the absolute build paths it emits.
        //
        // REWRITTEN TO `@loader_path/…`, NOT to the bare leaf win32 § 4a uses. Measured on
        // macOS 15.7.8 with Homebrew's gdk-pixbuf 2.44.7, all four shapes, on a bundle
        // whose addon and dylibs come from the SAME tree: a bare leaf FAILS —
        // `dlopen("libpixbufloader_svg.so")` walks dyld's own paths and never looks in the
        // loaders dir, so the SVG icon still does not decode. The reason is not the cache
        // but the library: `GDK_PIXBUF_MODULEDIR` does not appear in that dylib's strings
        // at all — brew builds gdk-pixbuf NON-relocatable, so it honours only
        // `GDK_PIXBUF_MODULE_FILE` (the cache path) and passes each module path through
        // verbatim. gvsbuild's win32 build IS relocatable, which is why the leaf form
        // works there and does not transfer here.
        // dlopen DOES expand `@loader_path`, against the directory of the image that calls
        // it — libgmodule/libgdk_pixbuf, i.e. `<bundle>/lib` — so `@loader_path/` + the
        // path from lib/ to the module is install-location independent WITHOUT any env at
        // all. That matters beyond tidiness: it also holds for a consumer that wires
        // `GDK_PIXBUF_MODULE_FILE` itself, and under Bun/Deno, where node-gi deliberately
        // skips the darwin re-exec (so nothing would put this dir on a search path).
        const MODULE_PREFIX = '@loader_path/gdk-pixbuf-2.0/2.10.0/loaders/';
        const queryTool = findTool('gdk-pixbuf-query-loaders');
        let cache = '';
        try {
            cache = sh(queryTool, pixbufLoaderImages);
        } catch (error) {
            // The tool exits non-zero when a single module will not dlopen, but still
            // prints the ones that did — keep them (same tolerance as win32 § 4a).
            cache = typeof error?.stdout === 'string' ? error.stdout : '';
        }
        const rel = cache
            // A module header line is a quoted absolute path; re-anchor it at the bundle.
            .replace(/^"(.*\/)?([^"/]+\.(?:so|dylib))"\s*$/gim, `"${MODULE_PREFIX}$2"`)
            // And its `# LoaderDir = <prefix>` header when it stamps one. Measured: it
            // does NOT for an explicit path list (only when it scans its own default
            // dir), so this is belt-and-braces — the line is inert (gdk-pixbuf ignores
            // `#`), but it would be a build-host path inside a file whose entire claim
            // is that the bundle carries none.
            .replace(/^# LoaderDir = .*$/gim, '# LoaderDir = <bundle>/lib/gdk-pixbuf-2.0/2.10.0/loaders');
        writeFileSync(join(OUT, 'lib', 'gdk-pixbuf-2.0', '2.10.0', 'loaders.cache'), rel);
        // § 3's rule for the one shipped file that is NOT a Mach-O image: a module path the
        // consumer cannot resolve. Asserted in the builder — the single place both
        // workflows go through — and anchored on the MODULE SUFFIX, because a cache also
        // contains quoted signature lines and XPM's is literally `"/*" "" 50`; a naive
        // `^"/` test reads that as an absolute path and fails a correct bundle (it did).
        const moduleLines = rel
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => /^"[^"]+\.(?:so|dylib)"$/.test(line));
        const unresolvable = moduleLines.filter((line) => !line.startsWith('"@loader_path/'));
        if (unresolvable.length > 0) {
            console.error(
                `build-gtk-runtime: LOADER CACHE IS NOT PORTABLE — ${unresolvable.length} of ${moduleLines.length} ` +
                    `module path(s) in lib/gdk-pixbuf-2.0/2.10.0/loaders.cache are not @loader_path-relative:\n  ` +
                    `${unresolvable.join('\n  ')}\n` +
                    'gdk-pixbuf hands these to g_module_open VERBATIM (brew builds it non-relocatable, so ' +
                    'GDK_PIXBUF_MODULEDIR is never consulted), so an absolute build path resolves on this machine ' +
                    'only and a bare leaf resolves nowhere at all — the icons would silently fail to decode in ' +
                    'the consumer. Repair the rewrite above; do NOT relax this check.',
            );
            process.exit(1);
        }
        if (moduleLines.length === 0) {
            console.warn(
                `build-gtk-runtime: WARNING — ${queryTool} described no module; loaders.cache is EMPTY ` +
                    '(§ 4e will fail this build)',
            );
        } else {
            console.log(
                `build-gtk-runtime: gdk-pixbuf loaders — ${pixbufLoaderImages.length} module(s) relocated ` +
                    `(@loader_path/../../..), loaders.cache describes ${moduleLines.length} as ` +
                    `${MODULE_PREFIX}<leaf>`,
            );
        }
    } else {
        console.warn(
            `build-gtk-runtime: WARNING — ${loadersSrc} missing; no gdk-pixbuf loaders bundled ` +
                '(SVG/PNG icons would not decode — § 4e will fail this build)',
        );
    }
}

// --- 2c. WINDOWING: the GStreamer PLUGINS + scanner -------------------------
// The elements. `Gst.init()` succeeds against an EMPTY registry, so a bundle that
// ships libgstreamer and every Gst typelib and NO plugins reports itself perfectly
// healthy and then fails far away with "no element decodebin". Exactly the shape
// § 2b exists for: a complete-looking bundle missing the thing that does the work.
//
// EVERYTHING brew's prefix has, not a curated subset. A hand-picked element list is
// a guess about which codecs an app will meet — and the failure mode of guessing
// wrong is silence, not an error. The size it costs is printed below so the payload
// is a number somebody can act on rather than a surprise in a tarball.
//
// Here rather than in § 4b for § 2b's reason: these are Mach-O images in a nested
// dir, so they need the copy → relocate → re-sign pass, and § 3 then verifies them.
// One level below lib/, hence `@loader_path/..` (the loaders sit three levels down
// and take `../../..`).
const gstPluginImages = []; // absolute paths in the bundle, for § 3
const gstPluginSources = new Map(); // leaf -> keg realpath, for § 5's attribution
if (WINDOWING) {
    const pluginsSrc = join(brewLib, 'gstreamer-1.0');
    const pluginsOut = join(OUT, 'lib', 'gstreamer-1.0');
    if (existsSync(pluginsSrc)) {
        mkdirSync(pluginsOut, { recursive: true });
        let bytes = 0;
        // The SAME list that seeded the closure walk above — read once, so the set
        // that was walked and the set that ships cannot disagree.
        for (const src of gstPluginSeedPaths) {
            const f = basename(src);
            const dest = join(pluginsOut, f);
            // Dereferencing, like § 2b: brew links plugins in from their kegs, and a
            // link into the Cellar is worthless inside a tarball.
            copyFileSync(src, dest);
            bytes += statSync(dest).size;
            gstPluginImages.push(dest);
            recordBinarySource(gstPluginSources, f, src);
        }
        for (const image of gstPluginImages) {
            relocate(image, { id: true, depPrefix: '@loader_path/..' });
        }

        // The scanner, which GStreamer FORKS to inspect each plugin out of process so
        // a plugin that crashes on load cannot take the app down with it. Its
        // compiled-in path is the build machine's, so it has to be bundled AND
        // pointed at (`GST_PLUGIN_SCANNER`, wired in node-gi's gtk-runtime.js).
        // Two levels below the bundle root → `@loader_path/../../lib`.
        const scannerSrc = join(brewPrefix, 'libexec', 'gstreamer-1.0', 'gst-plugin-scanner');
        if (existsSync(scannerSrc)) {
            const scannerOut = join(OUT, 'libexec', 'gstreamer-1.0');
            mkdirSync(scannerOut, { recursive: true });
            const dest = join(scannerOut, 'gst-plugin-scanner');
            copyFileSync(scannerSrc, dest);
            gstPluginImages.push(dest);
            recordBinarySource(gstPluginSources, 'gst-plugin-scanner', scannerSrc);
            relocate(dest, { id: false, depPrefix: '@loader_path/../../lib' });
        } else {
            console.warn(
                `build-gtk-runtime: WARNING — ${scannerSrc} missing; GStreamer will scan plugins ` +
                    'IN-PROCESS (works, until the first plugin that crashes on load)',
            );
        }

        // ZERO IS NEVER RIGHT — see the win32 builder's note: a plugin-naming
        // mismatch shipped an element-free bundle there while every gate stayed
        // green, because nothing counts plugins.
        if (gstPluginImages.length === 0) {
            console.error(
                `build-gtk-runtime: ${pluginsSrc} holds plugins but NONE matched the audio-path ` +
                    'filter — a --windowing bundle with no GStreamer elements reports itself healthy ' +
                    'and then fails with "no element decodebin".',
            );
            process.exit(1);
        }
        // ZERO IS NEVER RIGHT, one element deeper. The count check above passed on every
        // published bundle while `souphttpsrc` was absent from all of them, because a
        // count cannot say WHICH plugin is gone — the same argument gst-elements.test.mjs
        // names each element for. This asks for the three whose absence is silent.
        const missingRequired = missingRequiredGstPlugins(gstPluginImages.map((p) => basename(p)));
        if (missingRequired.length > 0) {
            console.error(
                `build-gtk-runtime: ${pluginsSrc} produced no plugin for ${missingRequired.join(', ')} — ` +
                    'gst-plugins.mjs marks these required because a bundle without them reports a healthy ' +
                    'Gst.init() and then fails in the application (no appsrc / no decodebin / no source ' +
                    'element for an http(s) URI). Install the formula that provides it into the build ' +
                    'prefix; do NOT drop the name from GST_REQUIRED_PLUGINS to get a green build.',
            );
            process.exit(1);
        }
        // AND THE SEED THAT MATCHED NOTHING. The block above asks for three plugins by
        // name; this asks the whole DECLARATION against what was actually copied, which
        // is the only direction that can see a plugin the source archive never
        // contained. A builder logs what it SKIPPED out of what it WALKED, so four
        // plugins left the published win32 bundle without a single line about any of
        // them, and an application played nothing (#1544). A gap that is written down
        // stays; one nobody has written down fails here.
        const bundledGaps = missingBundledGstPlugins(
            gstPluginImages.map((p) => basename(p)),
            TARGET,
        );
        for (const gap of bundledGaps.declared) {
            console.warn(`build-gtk-runtime: DECLARED GAP — no ${gap.plugin} plugin: ${gap.why}`);
        }
        if (bundledGaps.retired.length > 0) {
            console.error(
                `build-gtk-runtime: ${bundledGaps.retired.join(', ')} IS in this prefix, and ` +
                    'gst-plugins.mjs still declares it as a gap. Delete the entry from ' +
                    'GST_PLUGIN_GAPS — a gap that outlives its cause is a promise this bundle now ' +
                    'keeps and still says it does not.',
            );
            process.exit(1);
        }
        if (bundledGaps.undeclared.length > 0) {
            console.error(
                `build-gtk-runtime: ${bundledGaps.undeclared.join(', ')} declared in GST_AUDIO_PLUGINS ` +
                    'and absent from the payload, with no entry in GST_PLUGIN_GAPS saying so. Either ' +
                    'the build prefix lost a formula, or the bundle is about to advertise a format it ' +
                    'cannot decode — which is what a silent skip looked like before this check existed.',
            );
            process.exit(1);
        }
        console.log(
            `build-gtk-runtime: GStreamer — ${gstPluginImages.length} plugin(s) relocated ` +
                `(@loader_path/..), ${(bytes / 1024 / 1024).toFixed(1)} MiB of plugins` +
                `, ${gstPluginSkips.nonAudio} non-audio plugin(s) skipped` +
                `${gstPluginSkips.dangling ? `, ${gstPluginSkips.dangling} dangling brew link(s)` : ''}`,
        );
    } else {
        console.error(
            `build-gtk-runtime: ${pluginsSrc} does not exist — a --windowing bundle with NO GStreamer ` +
                'plugin directory at all. `Gst.init()` then succeeds against an empty registry and the ' +
                'failure surfaces in the application as "no element decodebin".\n' +
                '    This used to be a warning, which is the same defect the per-plugin gap check ' +
                'below exists for, one level up: four missing files are caught and the whole directory ' +
                'missing was not (#1544). Install GStreamer into the build prefix; do NOT drop the ' +
                'windowing claim to get a green build.',
        );
        process.exit(1);
    }
}

// --- 2d. WINDOWING: the GIO modules (the TLS backend) -----------------------
// `GTlsConnection` has no implementation in GIO itself: glib-networking ships one as a
// module and GIO g_module_opens it out of its module dir. The bundle brings its OWN
// libgio and brought no module, so `g_tls_backend_get_default()` returned the dummy
// backend and every https request in a bundle-activated process failed — souphttpsrc
// § 2c reports it as "Internal data stream error", and @gjsify/tls, /http2 and /ws fail
// the same way one layer up. Measured by emptying the host module dir on darwin-x64.
//
// Here rather than in § 4b for § 2b's reason: Mach-O images in a nested dir, so they
// need the copy → relocate → re-sign pass and § 3 then verifies them. Three levels
// below the bundle root (lib/gio/modules/), so the deps prefix climbs back to lib/.
// The dir is a declared `tls-backend` data set (bundle-data.mjs), which is what makes
// an EMPTY one fail the build in § 4e and the publish in verify-bundle-manifest.mjs.
const gioModuleImages = []; // absolute paths in the bundle, for § 3
const gioModuleSources = new Map(); // leaf -> keg realpath, for § 5's attribution
if (WINDOWING) {
    const modulesOut = join(OUT, 'lib', 'gio', 'modules');
    if (gioModuleSeedPaths.length > 0) {
        mkdirSync(modulesOut, { recursive: true });
        let bytes = 0;
        // The SAME list that seeded the closure walk in § 1, for the reason § 2c gives:
        // the set that was walked and the set that ships cannot disagree.
        for (const src of gioModuleSeedPaths) {
            const f = basename(src);
            const dest = join(modulesOut, f);
            copyFileSync(src, dest); // dereferencing — a link into the Cellar is worthless in a tarball
            bytes += statSync(dest).size;
            gioModuleImages.push(dest);
            recordBinarySource(gioModuleSources, f, src);
        }
        for (const image of gioModuleImages) {
            relocate(image, { id: true, depPrefix: '@loader_path/../..' });
        }
        console.log(
            `build-gtk-runtime: GIO modules — ${gioModuleImages.length} module(s) relocated ` +
                `(@loader_path/../..), ${(bytes / 1024).toFixed(0)} KiB`,
        );
    } else {
        console.error(
            `build-gtk-runtime: ${join(brewLib, 'gio', 'modules')} holds no loadable GIO module — the ` +
                'bundle would ship its own libgio with no TLS backend behind it, so every https request ' +
                'gets the dummy backend and fails as a network error rather than as a missing module. ' +
                'Repair: brew install glib-networking.',
        );
        process.exit(1);
    }
}

// --- 3. verify the relocation ---------------------------------------------
// A leftover absolute reference to a library we DID bundle is the whole failure
// mode: the bundle looks complete, loads fine on the build host, and resolves
// nothing on a machine without Homebrew. Assert it here — in the ONE place both
// arches and both workflows (node-gi.yml, release.yml) go through — rather than as
// a grep re-typed per YAML job. The predicate is prefix-DERIVED (`brewPrefix`), not
// the literal `/opt/homebrew`, because that literal is vacuously absent on an Intel
// runner whose prefix is /usr/local; a passing hardcoded grep there would have been
// the first thing the darwin-x64 bundle got wrong.
// Non-system absolute deps we did NOT bundle (e.g. an /opt/X11 leaf) are REPORTED,
// never failed: the bundle deliberately leaves OS-provided libraries alone, and
// turning "unbundled" into an error would refuse a correct bundle.
function verifyRelocation(paths) {
    const failures = [];
    const externals = new Set();
    for (const p of paths) {
        for (const dep of otoolDeps(p)) {
            if (!dep.startsWith('/')) continue; // @loader_path / @rpath — relocated
            if (bundledLeaves.has(basename(dep)) || dep.startsWith(brewPrefix)) {
                failures.push(`${basename(p)} → ${dep}`);
            } else {
                externals.add(dep);
            }
        }
    }
    if (externals.size > 0) {
        console.log(`build-gtk-runtime: ${externals.size} OS-provided dep(s) left unbundled: ${[...externals].sort()}`);
    }
    if (failures.length > 0) {
        console.error(
            `build-gtk-runtime: RELOCATION FAILED — ${failures.length} reference(s) still point outside the bundle ` +
                `(brew prefix ${brewPrefix}):\n  ${failures.join('\n  ')}\n` +
                'Two causes: a leaf we DID bundle whose reference was not rewritten (an install_name_tool bug), or a ' +
                `dependency under ${brewPrefix} that never entered the closure because it is not symlinked into ` +
                `${brewLib} — add it to the seed patterns or resolve it through its keg.`,
        );
        process.exit(1);
    }
    console.log(`build-gtk-runtime: relocation verified — ${paths.length} image(s), 0 refs outside the bundle`);
}
// The nested pixbuf loaders (§ 2b) go through the SAME gate as the flat dylibs: their
// relocation is the harder one (a ../../.. prefix, plus an `@rpath` ref and an absolute
// LC_ID_DYLIB on librsvg's module), so leaving them out would ship exactly the class of
// bug this function exists to catch.
verifyRelocation([
    ...[...bundledLeaves].map((leaf) => join(libOut, leaf)),
    ...pixbufLoaderImages,
    ...gstPluginImages,
    ...gioModuleImages,
]);

// And the check verifyRelocation CANNOT make, because a duplicate is correctly
// relocated: no module § 2b–2d placed may ALSO be a flat lib/ entry. See
// duplicatedModuleLeaves for the class and the 24-plugin instance it was written on.
const duplicatedModules = duplicatedModuleLeaves(bundledLeaves, [
    ...pixbufLoaderImages,
    ...gstPluginImages,
    ...gioModuleImages,
]);
if (duplicatedModules.length > 0) {
    console.error(`build-gtk-runtime: ${formatDuplicatedModuleProblems(duplicatedModules, { flatDir: libOut })}`);
    process.exit(1);
}

// --- 4. typelibs — only the ones this bundle can actually BACK --------------
// The brew typelib dir is shared by every installed formula, so copying it wholesale
// shipped typelibs whose library never entered the closure. Measured on the published
// 0.27.1 darwin bundles: 6 of 38 typelibs had no backer (Adw-1, AppStream-1.0,
// GIRepository-2.0, HarfBuzz-0.0, Rsvg-2.0, Xmlb-2.0) — `new Adw.Application()` then
// fails with "Failed to load shared library 'libadwaita-1.0.dylib'" on a bundle that
// advertises the class. The plan reads each typelib's OWN shared_library field (never
// a leaf table) and is dependency-aware: an unbacked typelib that a KEPT one requires
// is a build FAILURE, not a drop (Pango-1.0 → HarfBuzz-0.0 is exactly that case).
const typelibOut = join(OUT, 'girepository-1.0');
mkdirSync(typelibOut, { recursive: true });
const requiredNamespaces = [...REQUIRED_NAMESPACES, ...(WINDOWING ? WINDOWING_REQUIRED_NAMESPACES : [])];
// darwin resolves a bare-leaf g_module_open through dyld, which is case-SENSITIVE
// even where the filesystem is not.
const typelibPlan = planTypelibSet({
    typelibs: readTypelibDir(brewTypelibs),
    libraries: nativeLibraryIndex(libOut, { caseInsensitive: false }),
    caseInsensitive: false,
    requiredNamespaces,
});
if (typelibPlan.problems.length > 0) {
    console.error(
        `build-gtk-runtime: ${formatTypelibProblems(typelibPlan.problems, {
            stage: `planning the typelib set from ${brewTypelibs}`,
            nativeDirLabel: 'lib/',
        })}`,
    );
    process.exit(1);
}
for (const typelib of typelibPlan.copy) copyFileSync(typelib.file, join(typelibOut, typelib.name));
const typelibCount = typelibPlan.copy.length;
console.log(
    `build-gtk-runtime: copied ${typelibCount} typelibs ` +
        `(${typelibPlan.backed.length} library-backed + ${typelibPlan.headerOnly.length} header-only)`,
);
if (typelibPlan.dropped.length > 0) {
    console.log(
        `build-gtk-runtime: dropped ${typelibPlan.dropped.length} typelib(s) with no backing library in this ` +
            `bundle (nothing shipped depends on them): ${typelibPlan.dropped
                .map((t) => `${t.key} → ${t.missing.join(' + ')}`)
                .join(', ')}`,
    );
}

// --- 4b. WINDOWING data (schemas / icons / gtksource) ---------------------
// The runtime DATA a REAL app needs beyond the dylibs+typelibs: compiled GSettings
// schemas (Gio.Settings — a HARD startup blocker without them), the Adwaita/hicolor
// icon themes, and GtkSourceView's data tree. These are plain files (no dylib
// relocation), located at runtime via GSETTINGS_SCHEMA_DIR / XDG_DATA_DIRS (node-gi's
// gtk-runtime.js maybeWireGtkWindowingEnv keys on the gschemas.compiled marker). Gated
// on --windowing; the display-free bundle is byte-unchanged. The FOURTH declared set —
// the gdk-pixbuf image loaders that decode those icons — is § 2b, because it is native
// code that has to be relocated and verified with the dylibs.
//
// Each step below still WARNS when the source prefix cannot provide a set, because the
// warning is where the cause is visible (which prefix path was missing) — but it is no
// longer the end of the story: § 4e re-reads the finished bundle and FAILS the build for
// every declared set that did not arrive, so a partial prefix cannot publish.
const windowing = {
    pixbufLoaders: pixbufLoaderImages.length, // § 2b
    gstPlugins: gstPluginImages.length, // § 2c
    gioModules: gioModuleImages.length, // § 2d
    schemas: false,
    iconThemes: [],
    iconFiles: 0,
    gtksource: false,
};
if (WINDOWING) {
    const brewShare = join(brewPrefix, 'share');

    // 4b-a. Compiled GSettings schemas + (re)compile gschemas.compiled — also the
    // windowing-data marker node-gi's loader detects.
    const schemasSrc = join(brewShare, 'glib-2.0', 'schemas');
    if (existsSync(schemasSrc)) {
        const schemasOut = join(OUT, 'share', 'glib-2.0', 'schemas');
        mkdirSync(schemasOut, { recursive: true });
        for (const f of readdirSync(schemasSrc)) {
            if (f.endsWith('.xml') || f.endsWith('.gschema.override') || f === 'gschemas.compiled') {
                copyFileSync(join(schemasSrc, f), join(schemasOut, f));
            }
        }
        try {
            execFileSync(findTool('glib-compile-schemas'), [schemasOut]);
        } catch (err) {
            console.warn(`build-gtk-runtime: WARNING — glib-compile-schemas failed: ${err?.message ?? err}`);
        }
        windowing.schemas = existsSync(join(schemasOut, 'gschemas.compiled'));
        console.log(
            `build-gtk-runtime: GSettings schemas ${windowing.schemas ? 'compiled' : 'copied (no gschemas.compiled!)'}`,
        );
    } else {
        console.warn(
            `build-gtk-runtime: WARNING — ${schemasSrc} missing; GSettings schemas NOT bundled ` +
                '(Gio.Settings will fail — § 4e will fail this build)',
        );
    }

    // 4b-b. Icon themes (Adwaita symbolic + hicolor) + caches, loaded from
    // XDG_DATA_DIRS/icons/<theme>/.
    const updateIconCache = findTool('gtk4-update-icon-cache');
    for (const theme of ['Adwaita', 'hicolor']) {
        const themeSrc = join(brewShare, 'icons', theme);
        if (!existsSync(themeSrc)) continue;
        // NOT cpSync: Homebrew links a keg's tree into its prefix, and `cpSync`'s
        // `dereference: true` only governs the top-level path, so every nested link
        // stayed a link into the Cellar (measured: 859 of them under Adwaita, i.e.
        // 0.2 MiB of links where the theme is 22 MB of files). § 4d gates the result.
        const copied = copyTreeDereferenced(themeSrc, join(OUT, 'share', 'icons', theme));
        windowing.iconFiles += copied.files;
        if (copied.dangling.length > 0) {
            console.warn(
                `build-gtk-runtime: WARNING — ${copied.dangling.length} dangling link(s) in ${themeSrc} skipped ` +
                    `(they resolve nowhere, so they cannot be bundled): ${copied.dangling.slice(0, 5).join(', ')}`,
            );
        }
        try {
            execFileSync(updateIconCache, ['-q', '-t', '-f', join(OUT, 'share', 'icons', theme)]);
        } catch {
            // an existing icon-theme.cache from the copy is a usable fallback
        }
        windowing.iconThemes.push(theme);
    }
    console.log(
        windowing.iconThemes.length
            ? `build-gtk-runtime: icon themes ${windowing.iconThemes.join(', ')} (${windowing.iconFiles} files, dereferenced)`
            : 'build-gtk-runtime: WARNING — no Adwaita/hicolor icon theme under share/icons (§ 4e will fail this build)',
    );

    // 4b-c. GtkSourceView's data tree — the WHOLE tree, not two hand-picked subdirs.
    // What it actually contains (measured, `gresource list` on libgtksourceview-5.0 +
    // `ls share/gtksourceview-5`): the built-in language-specs, styles and snippets are
    // a GRESOURCE COMPILED INTO THE LIBRARY (198 resources), so the syntax highlighting
    // travels with the dylib and is NOT what this copies. `share/` carries the RNG/DTD
    // schemas that validate USER-supplied .lang/.snippets files (language-specs/,
    // styles/, snippets/) plus fonts/BuilderBlocks.ttf — 4 files on brew. The earlier
    // version of this step copied only language-specs + styles and thereby dropped
    // snippets/ and fonts/ silently, which is the same shape as the defect above; the
    // tree is tiny, so the correct scope is all of it.
    const gtksourceSrc = join(brewShare, 'gtksourceview-5');
    if (existsSync(gtksourceSrc)) {
        const copied = copyTreeDereferenced(gtksourceSrc, join(OUT, 'share', 'gtksourceview-5'));
        windowing.gtksource = copied.files > 0;
        windowing.gtksourceFiles = copied.files;
        console.log(
            `build-gtk-runtime: GtkSource-5 data ${windowing.gtksource ? `bundled (${copied.files} files)` : 'EMPTY'}`,
        );
    } else {
        console.warn(
            `build-gtk-runtime: WARNING — ${gtksourceSrc} missing; GtkSource-5 data NOT bundled ` +
                '(§ 4e will fail this build — `brew install gtksourceview5`)',
        );
    }
}

// --- 4d. the runtime DATA must be real files, not links into this machine ----
// Only meaningful under --windowing (the display-free bundle writes no data tree),
// and only darwin needs it in practice — Homebrew's prefix is a symlink farm, while
// gvsbuild's is an extracted zip of real files. The check runs on both anyway: it is
// cheap, and "the source prefix has no links" is an assumption about someone else's
// packaging, not a fact we control.
if (WINDOWING) {
    const dataRoot = join(OUT, 'share');
    const links = findSymlinks(dataRoot);
    if (links.length > 0) {
        console.error(`build-gtk-runtime: ${formatSymlinkProblems(links, { root: dataRoot })}`);
        process.exit(1);
    }
    console.log('build-gtk-runtime: windowing data is self-contained — 0 symlinks under share/');
}

// --- 4c. verify the typelib/library symmetry of the FINISHED bundle ---------
// Re-derived from the OUTPUT dirs, not from the plan above: both the typelib set and
// the library set are read back off disk, so this gates the bytes that ship. It also
// asserts a POSITIVE fact rather than the absence of complaints — at least one
// library-backed typelib, and every namespace the bundle promises actually present
// (+ Adw/GtkSource under --windowing, which is the whole point of that flag).
const symmetry = verifyBundleTypelibs({
    typelibDir: typelibOut,
    nativeDir: libOut,
    caseInsensitive: false,
    requiredNamespaces,
});
if (symmetry.problems.length > 0) {
    console.error(
        `build-gtk-runtime: ${formatTypelibProblems(symmetry.problems, {
            stage: 'verifying the finished bundle',
            nativeDirLabel: 'lib/',
        })}`,
    );
    process.exit(1);
}
console.log(
    `build-gtk-runtime: typelib symmetry verified — ${symmetry.backed.length} backed typelib(s), every ` +
        `shared_library present in lib/; ${symmetry.headerOnly.length} header-only (no library by design); ` +
        `namespaces ${requiredNamespaces.join(', ')} all present`,
);

// --- 4e. the DECLARED windowing data must BE in the finished bundle ---------
// The data-side twin of § 4c, and the reason § 4b's steps may keep warning: a set is
// required iff the finished bundle ships the namespace it belongs to — the namespaces
// come from the typelib set § 4c just read off disk, not from the copy plan — so a
// warn-and-continue prefix gap fails HERE instead of publishing a bundle whose manifest
// advertises a runtime it does not contain. Runs only under --windowing because the
// display-free bundle declares no data at all (see bundle-data.mjs § RULE 2).
if (WINDOWING) {
    const shippedNamespaces = [...symmetry.backed, ...symmetry.headerOnly].map((t) => t.namespace);
    const data = verifyWindowingData({ bundleDir: OUT, shippedNamespaces });
    if (data.problems.length > 0) {
        console.error(`build-gtk-runtime: ${formatWindowingDataProblems(data.problems, { bundleDir: OUT })}`);
        process.exit(1);
    }
    windowing.verified = data.applied;
    console.log(
        `build-gtk-runtime: windowing data verified — ${data.applied
            .map((a) => `${a.id} (${a.files} file(s))`)
            .join(', ')}`,
    );
}

// --- 5. license compliance --------------------------------------------------
// The bundle carries ~45 third-party LGPL/MPL libraries and MODIFIES them (§ 2 and § 2b
// rewrite install names, then re-sign). Attribution is derived from where each
// dylib actually came from: a Homebrew library realpath always runs through
// …/Cellar/<formula>/<version>/, and Homebrew stores the formula inside the keg
// (.brew/<formula>.rb), so the license terms come from the build prefix itself
// rather than a list maintained here that would drift from the closure.
const brewInfoLicense = (formula) => {
    try {
        return JSON.parse(sh('brew', ['info', '--json=v2', formula]))?.formulae?.[0]?.license ?? null;
    } catch {
        return null; // no API cache / unknown formula — reported by the coverage gate
    }
};
// EVERY binary the tarball carries, not just the flat closure: § 2b's pixbuf loaders are
// third-party LGPL modules too, so "the terms travel with the binaries" is only true if
// the per-binary table names them. They attribute through the same derivation as every
// dylib — their realpath runs through …/Cellar/{gdk-pixbuf,librsvg}/<version>/… .
const shippedBinaries = new Map([...bundled, ...pixbufLoaderSources, ...gstPluginSources, ...gioModuleSources]);
const { components: licenseComponents, unattributed } = describeBrewKegs({
    files: shippedBinaries,
    fallbackLicense: brewInfoLicense,
});
const licensePayload = writeLicensePayload({ outDir: join(OUT, 'licenses'), components: licenseComponents });
const MODIFICATIONS = [
    '`install_name_tool -id` / `-change`: every install name and every reference to another library in this bundle ' +
        'rewritten to `@loader_path/<leaf>`, with the prefix climbing back to `lib/` for the modules that sit ' +
        'below it — `../` for the GStreamer plugins, `../../` for the GIO modules, `../../../` for the gdk-pixbuf ' +
        'image loaders (references to /usr/lib and /System are untouched).',
    '`codesign --force --sign -`: ad-hoc re-signature, because `install_name_tool` invalidates the original one ' +
        'and dyld refuses a mis-signed dylib on Apple silicon.',
];
writeFileSync(
    join(OUT, 'THIRD-PARTY-NOTICES.md'),
    renderThirdPartyNotice({
        target: TARGET,
        builder: BUILDER_ID,
        provenance: brewPrefix,
        windowing: WINDOWING,
        modifications: MODIFICATIONS,
        components: licenseComponents,
        binaries: [...shippedBinaries.keys()],
        attribution: 'per-binary',
        payloadDir: 'licenses',
    }),
);
const licenseProblems = assertLicenseCoverage({
    components: licenseComponents,
    binaries: [...shippedBinaries.keys()],
    unattributed,
    attribution: 'per-binary',
    textCount: licensePayload.files.length,
});
if (licenseProblems.length > 0) {
    console.error(`build-gtk-runtime: ${formatLicenseProblems(licenseProblems, { prefix: brewPrefix })}`);
    process.exit(1);
}
console.log(
    `build-gtk-runtime: licenses — ${licenseComponents.length} component(s) attributing all ` +
        `${shippedBinaries.size} binary/ies, ${licensePayload.files.length} license text(s) ` +
        `(${(licensePayload.bytes / 1024).toFixed(0)} KiB) → licenses/, notice → THIRD-PARTY-NOTICES.md`,
);

// --- 6. optional: relocate a copy of the node-gi addon --------------------
// The addon (built against Homebrew) carries absolute Homebrew refs. Rewrite them to
// @rpath/<leaf> + add an rpath to the SIBLING bundle so it loads the bundled
// libgirepository with NO Homebrew — the env-free core-conformance path.
//
// The sibling layout it produces, `<stage>/{node_gi.node, gtk/}`, is the shape a
// consumer actually loads — which is why § 6b decodes through THAT and not through OUT.
let stagedAddonDir = null;
if (ADDON) {
    if (!existsSync(ADDON)) {
        console.error(`build-gtk-runtime: --addon ${ADDON} not found`);
        process.exit(1);
    }
    stagedAddonDir = STAGE ?? join(OUT, '..', 'staged');
    mkdirSync(stagedAddonDir, { recursive: true });
    const addonDest = join(stagedAddonDir, 'node_gi.node');
    copyFileSync(ADDON, addonDest);
    // Point the addon at the bundle staged as its sibling `gtk/`.
    cpSync(OUT, join(stagedAddonDir, 'gtk'), { recursive: true });

    for (const dep of otoolDeps(addonDest)) {
        // Any non-system dep (Homebrew absolute path OR @rpath leaf we bundle).
        if (bundledLeaves.has(basename(dep)) || dep.startsWith(brewPrefix) || dep.startsWith('/usr/local/')) {
            execFileSync('install_name_tool', ['-change', dep, `@rpath/${basename(dep)}`, addonDest]);
        }
    }
    try {
        execFileSync('install_name_tool', ['-add_rpath', '@loader_path/gtk/lib', addonDest]);
    } catch {
        // rpath already present — fine.
    }
    execFileSync('codesign', ['--force', '--sign', '-', addonDest]);
    // The addon gets the SAME assertion as the dylibs: a surviving absolute ref to a
    // bundled leaf is the "loads on the build host, resolves nothing elsewhere" bug,
    // and until now only the dylibs were checked for it.
    verifyRelocation([addonDest]);
    console.log(`build-gtk-runtime: relocated addon → ${addonDest} (rpath @loader_path/gtk/lib)`);
}

// --- 6b. WINDOWING: DECODE an icon this bundle just shipped ----------------
// The assertion § 4e cannot make. § 4e counts the files in each declared data set, and
// the published darwin-x64 0.28.0 bundle satisfied it perfectly — 860 icon files,
// `verified icons: 863` — while ZERO of them decoded: the addon kept its absolute
// Homebrew install names, so a Mac with Homebrew glib loaded TWO GObject registries and
// `Pixbuf.new_from_file()` on the bundle's own Adwaita SVG returned −1×−1. A file count
// is not a capability (ADR 0018).
//
// This runs HERE, after § 6, and against the STAGED sibling layout rather than against
// OUT: `<stage>/{node_gi.node, gtk/}` is the shape a consumer loads, install names
// rewritten to @rpath and all. Probing OUT with an unrelocated addon would measure a
// machine, not a tarball.
//
// The RECORD goes into the manifest and `verify-bundle-manifest.mjs` requires it — so a
// bundle built by an older builder, or with this step bypassed, cannot publish. It does
// not degrade to "unverified".
if (WINDOWING) {
    if (!stagedAddonDir) {
        console.error(
            'build-gtk-runtime: --windowing needs --addon <node_gi.node> so the bundle can DECODE one of ' +
                'its own icons before it is published. Without it the only evidence the icon theme works ' +
                'is a file count, which is exactly what the 0.28.0 darwin bundle passed with zero ' +
                'decodable icons.',
        );
        process.exit(1);
    }
    const probe = spawnDecodeProbe({
        bundleDir: join(stagedAddonDir, 'gtk'),
        addon: join(stagedAddonDir, 'node_gi.node'),
        // Homebrew's own prefix leaves the child's PATH, and its GTK env vars leave with
        // it — the probe must fail on a bundle that only works because this machine has
        // brew, which is the 0.28.0 defect stated the other way round.
        hostPrefixes: [brewPrefix],
    });
    const probeProblems = decodeProbeProblems(probe);
    if (probeProblems.length > 0) {
        console.error(
            `build-gtk-runtime: THE BUNDLE CANNOT DECODE ITS OWN ICONS —\n  ${probeProblems.join('\n  ')}\n` +
                `record: ${JSON.stringify(probe, null, 2)}\n` +
                'Do NOT relax this check: a bundle that ships an icon theme no loader can read is the ' +
                'defect this build exists to stop shipping.',
        );
        process.exit(1);
    }
    windowing.decodeProbe = probe;
    console.log(
        `build-gtk-runtime: decode probe passed — ${probe.svg.file} ${probe.svg.width}x${probe.svg.height}, ` +
            `${probe.png.file} ${probe.png.width}x${probe.png.height} (${probe.loaderModules} loader module(s), ` +
            `${probe.formats.length} format(s))`,
    );
}

// --- manifest + size -------------------------------------------------------
// lstat, NOT stat. When this was written the icon themes were copied with their alias
// SYMLINKS intact and following them counted every alias at its target's full size — the
// arm64 --windowing manifest reported 19.4 MiB of runtime data for a share/ tree `du -sh`
// measured as part of a 37 MiB bundle. § 4b now dereferences, so the two agree and § 4d
// enforces that there is no link left to follow; lstat stays because the rule it encodes
// is the invariant, not the workaround: a size the manifest reports must be the size on
// disk, whatever ends up under share/.
function dirSize(dir) {
    if (!existsSync(dir)) return 0;
    let total = 0;
    for (const f of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, f.name);
        total += f.isDirectory() ? dirSize(p) : lstatSync(p).size;
    }
    return total;
}
const libBytes = dirSize(libOut);
const typelibBytes = dirSize(typelibOut);
const shareOut = join(OUT, 'share');
const dataBytes = WINDOWING && existsSync(shareOut) ? dirSize(shareOut) : 0;
const licenseBytes = dirSize(join(OUT, 'licenses'));
const manifest = {
    platform: TARGET,
    windowing: WINDOWING,
    builder: BUILDER_ID,
    generatedFrom: brewPrefix,
    dylibs: bundledLeaves.size,
    typelibs: typelibCount,
    libBytes,
    typelibBytes,
    dataBytes,
    licenseBytes,
    totalBytes: libBytes + typelibBytes + dataBytes + licenseBytes,
    dylibList: [...bundledLeaves].sort(),
    // Proof-of-symmetry, recorded so a consumer holding only the tarball can see
    // that the claim was checked and what it excluded (and why).
    typelibSymmetry: {
        backed: symmetry.backed.length,
        headerOnly: symmetry.headerOnly.length,
        dropped: typelibPlan.dropped.map((t) => ({ namespace: t.key, missing: t.missing })),
        requiredNamespaces,
    },
    licenses: {
        notice: 'THIRD-PARTY-NOTICES.md',
        dir: 'licenses',
        attribution: 'per-binary',
        components: licenseComponents.length,
        texts: licensePayload.files.length,
        // How many binaries the coverage gate actually covered. Recorded on BOTH
        // platforms so the publish gate can refuse a bundle whose license step ran
        // without ever looking at a binary — the win32 state that shipped GLib and
        // OpenSSL with no terms while every check was green.
        binariesCovered: shippedBinaries.size,
        binariesModified: true,
        modifications: MODIFICATIONS,
    },
    ...(WINDOWING ? { windowingData: windowing } : {}),
};
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));

const mb = (n) => (n / 1024 / 1024).toFixed(1);
console.log(
    `build-gtk-runtime: DONE (${TARGET}) → ${OUT}\n` +
        `  dylibs:   ${bundledLeaves.size} (${mb(libBytes)} MiB)\n` +
        `  typelibs: ${typelibCount} (${mb(typelibBytes)} MiB)\n` +
        (WINDOWING ? `  data:     ${mb(dataBytes)} MiB\n` : '') +
        `  licenses: ${licensePayload.files.length} text(s) (${mb(licenseBytes)} MiB)\n` +
        `  total:    ${mb(manifest.totalBytes)} MiB`,
);
