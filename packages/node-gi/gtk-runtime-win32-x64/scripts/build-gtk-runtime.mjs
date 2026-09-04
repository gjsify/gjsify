// SPDX-License-Identifier: MIT
// Collect a standalone, batteries-included GTK/GObject-Introspection runtime
// bundle for Windows x64 — so @gjsify/node-gi loads gi:// namespaces with NO
// gvsbuild/system GTK on the host (the Windows sibling of the darwin-arm64 bundle).
//
//   node scripts/build-gtk-runtime.mjs [--out <dir>] [--prefix <gvsbuild GTK prefix>] [--windowing]
//
// Two closures, one bundle dir:
//   • DEFAULT (display-free) — the loadable DLLs + typelibs the DISPLAY-FREE
//     conformance needs (GLib/GObject/Gio/cairo/Pango/Graphene/Gdk). Unchanged.
//   • --windowing (SUPERSET) — everything above PLUS the runtime data a REAL GTK
//     WINDOW needs on Windows: the gdk-pixbuf loaders + `loaders.cache`, compiled
//     GSettings schemas (`gschemas.compiled`), the Adwaita/hicolor icon themes +
//     `icon-theme.cache`, and the Fontconfig config/cache. The extra image-loader
//     backing DLLs (librsvg/png/…) are walked into `bin/` too. node-gi's loader
//     (gtk-runtime.js) detects the windowing data (the `gschemas.compiled` marker)
//     and wires the env (GSETTINGS_SCHEMA_DIR / GDK_PIXBUF_MODULE_FILE /
//     XDG_DATA_DIRS / FONTCONFIG_*) so the SAME loader serves both — the display-free
//     path is byte-unchanged when the windowing data is absent.
//
// Runs ONLY on win32/x64 with a build-time gvsbuild GTK4 stack extracted at
// --prefix (env GTK_PREFIX, the closure *source*, not shipped — the same tree the
// node-gi.yml windows jobs cache at C:\gtk-build\gtk\x64\release). gvsbuild bundles
// the tools this needs (gdk-pixbuf-query-loaders / glib-compile-schemas /
// gtk4-update-icon-cache / fc-cache) in <prefix>/bin.
//
// CRUCIAL DIFFERENCE FROM macOS: there is NO relocation step (no install_name_tool,
// no @rpath, no codesign). Windows resolves a DLL's imports by SEARCH PATH at
// LoadLibrary time, so a bundle is "portable" the moment its DLLs sit in one dir —
// node-gi just prepends <out>/bin to PATH before the addon loads. The runtime DATA
// (loaders/schemas/icons/fonts) is likewise resolved by env vars set at load time,
// no baked absolute paths (the caches are rewritten to bundle-relative).
//
// Reference: GJS ships no relocation; gvsbuild ships the MSVC-ABI GTK4 stack whose
// DLLs load into stock (MSVC-ABI) Node.
//
// The typelib set and the license payload are NOT built here: both rules are shared
// with the darwin builder and live in packages/node-gi/scripts/{typelib-backers,
// bundle-licenses}.mjs — one home for "a bundle ships exactly the typelibs it can
// back" and for "the terms of what it ships travel with it", because two copies of a
// gate are two gates that drift.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
} from '../../scripts/bundle-data.mjs';
import {
    WIN32_LICENSE_FAMILIES,
    assertLicenseCoverage,
    formatLicenseProblems,
    renderThirdPartyNotice,
    scanLicenseFiles,
    upstreamLicenseComponents,
    writeLicensePayload,
} from '../../scripts/bundle-licenses.mjs';
import {
    GL_IMPLEMENTATION_PATTERNS,
    describeGlImplementation,
    formatMissingGlImplementation,
} from '../../scripts/gl-implementation.mjs';
import { decodeProbeProblems, spawnDecodeProbe } from '../../scripts/decode-probe.mjs';
import { isBundledGstPlugin, missingBundledGstPlugins, missingRequiredGstPlugins } from '../../scripts/gst-plugins.mjs';
import { bundleRelativeLoaderCache, loaderCacheProblems } from '../../scripts/pixbuf-loader-cache.mjs';
import {
    REQUIRED_NAMESPACES,
    WINDOWING_REQUIRED_NAMESPACES,
    formatTypelibProblems,
    nativeLibraryIndex,
    planTypelibSet,
    readTypelibDir,
    verifyBundleTypelibs,
} from '../../scripts/typelib-backers.mjs';

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
// Repo-relative path recorded in the shipped manifest so a consumer holding only the
// tarball can find the recipe that produced its bytes — the tarball itself no longer
// carries this script (the package's `files` no longer lists `scripts`, which would
// otherwise ship a copy whose relative imports above resolve to nothing).
const BUILDER_ID = 'packages/node-gi/gtk-runtime-win32-x64/scripts/build-gtk-runtime.mjs';

// --- args ------------------------------------------------------------------
function argValue(flag) {
    const i = process.argv.indexOf(flag);
    return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}
const OUT = argValue('--out') ?? join(pkgRoot, 'gtk');
const PREFIX = argValue('--prefix') ?? process.env.GTK_PREFIX;
// The node-gi addon that DECODES one of the bundled icons in § 5c. Required under
// --windowing; nothing else here uses it, and there is deliberately no relocation pass
// for it (Windows resolves DLLs by search path — node-gi puts the bundle's bin/ first).
const ADDON = argValue('--addon');
// The full-windowing SUPERSET: also collect the runtime data a real GTK window needs.
const WINDOWING = process.argv.includes('--windowing');
// Make "this windowing bundle resolves no GL implementation" FATAL rather than a
// warning. Off by default because no gvsbuild prefix has ever satisfied it (see
// GL_IMPLEMENTATION_PATTERNS): turning it on today would fail every win32 bundle
// build for a gap the bundle cannot currently close. It exists so the promotion
// that DOES ship a GL implementation can lock the property in the same change,
// instead of re-deriving it — and so the check is exercised, not just written.
const REQUIRE_GL = process.argv.includes('--require-gl');

if (process.platform !== 'win32' || process.arch !== 'x64') {
    console.error(`build-gtk-runtime: only supported on win32/x64, not ${process.platform}/${process.arch}`);
    process.exit(2);
}
if (!PREFIX) {
    console.error(
        'build-gtk-runtime: no GTK prefix — pass --prefix or set GTK_PREFIX (e.g. C:\\gtk-build\\gtk\\x64\\release)',
    );
    process.exit(1);
}

const gtkBin = join(PREFIX, 'bin');
const gtkTypelibs = join(PREFIX, 'lib', 'girepository-1.0');
if (!existsSync(gtkBin)) {
    console.error(`build-gtk-runtime: ${gtkBin} not found — extract the gvsbuild GTK4 stack first`);
    process.exit(1);
}

const sh = (bin, args, opts) => execFileSync(bin, args, { encoding: 'utf8', ...opts });

// The seed DLLs of the DISPLAY-FREE conformance closure. Liberal, version-agnostic
// patterns matched against <prefix>/bin (gvsbuild's suffixes drift: glib-2.0-0.dll,
// girepository-2.0-0.dll, cairo-2.dll, pango-1.0-0.dll, gdk_pixbuf-2.0-0.dll,
// gtk-4-1.dll, harfbuzz.dll, …). The recursive dumpbin walk pulls every transitive
// gvsbuild dep (harfbuzz, fribidi, fontconfig, freetype, pixman, png, intl, pcre2,
// ffi, epoxy, zlib, …). gtk-4 is seeded because it backs the Gdk typelib the
// conformance's struct-construct loads (Gdk/Graphene) and transitively pulls
// pango/graphene/gdk-pixbuf/cairo/harfbuzz.
const SEED_PATTERNS = [
    /^glib-2\.0-.*\.dll$/i,
    /^gobject-2\.0-.*\.dll$/i,
    /^gio-2\.0-.*\.dll$/i,
    /^gmodule-2\.0-.*\.dll$/i,
    /^girepository-[12]\.0-.*\.dll$/i, // girepository-2.0 (merged API) on modern gvsbuild
    /^cairo(-gobject|-script-interpreter)?-?\d*\.dll$/i,
    /^pango(cairo|ft2|win32)?-1\.0-.*\.dll$/i,
    /^graphene-1\.0-.*\.dll$/i,
    /^gdk[-_]pixbuf-2\.0-.*\.dll$/i,
    /^gtk-4-.*\.dll$/i, // provides the Gdk typelib's backing library
    /^harfbuzz.*\.dll$/i,
];

// Extra seeds for the WINDOWING superset: libadwaita (the Adw-1 typelib's backing
// DLL — a real Adw.Application/ApplicationWindow needs it; the display-free
// conformance never touches Adwaita, so it is NOT in the base seeds), the GL
// dispatch layer epoxy (which GTK links; the cairo renderer needs no GL at all, but
// a real window may negotiate it), any GL IMPLEMENTATION the prefix happens to carry
// (see above — none has yet), and librsvg (the SVG gdk-pixbuf loader that renders the
// Adwaita symbolic icons). Most rsvg deps are pulled transitively by the loaders
// below; naming them keeps the closure complete even if a loader is missing.
// (Gdk/Gsk/Gtk are all in gtk-4-*.dll, already a base seed.)
const WINDOWING_SEED_PATTERNS = [
    /^(lib)?adwaita-1.*\.dll$/i, // gvsbuild leaf: adwaita-1-0.dll (backs the Adw-1 typelib)
    /^(lib)?gtksourceview-5.*\.dll$/i, // gvsbuild leaf: gtksourceview-5-0.dll (backs the GtkSource-5 typelib — the Learn6502 editor)
    ...GL_IMPLEMENTATION_PATTERNS,
    /^epoxy.*\.dll$/i,
    /^rsvg.*\.dll$/i,
    /^libxml2.*\.dll$/i,
    // GStreamer, backing the Gst + GstApp typelibs `@gjsify/webaudio` imports; its
    // PLUGINS are § 4g. TWO seeds, not one: the dumpbin walk reaches
    // gstbase/audio/pbutils/tag/video from gstreamer-1.0-0.dll, but gstapp is a
    // gst-plugins-base library only an appsrc/appsink user links — which is exactly
    // what the decode pipeline is. Seeding only gstreamer would leave
    // `GstApp-1.0.typelib` unbacked and § 3's symmetry rule would DROP it: a green
    // build with no audio and no message.
    /^gstreamer-1\.0-.*\.dll$/i,
    /^gstapp-1\.0-.*\.dll$/i,
    // libsoup, and NOT for the reason its darwin twin exists — the two OSes build the
    // soup plugin differently and only one of them hides the dependency. gst-plugins-good
    // takes the `host_system == 'windows'` branch of ext/soup/meson.build, which LINKS
    // libsoup; measured on the shipped DLL, `gstsoup.dll`'s import table names
    // `soup-3.0-0.dll` outright, so the dumpbin walk seeded from the plugin does reach it.
    // (On darwin the same plugin g_module_opens libsoup by leaf through its loader shim
    // and the otool walk finds nothing — that is where the seed is load-bearing.)
    //
    // It is seeded here anyway, for the reason that survives the difference: it backs
    // `Soup-3.0.typelib`, which § 3's symmetry rule was correctly dropping, and the seed
    // states that requirement rather than inheriting it from how -good happened to be
    // configured. gst-plugins.mjs § soup carries the measurement.
    /^soup-3\.0-.*\.dll$/i,
];

// Locate an MSVC/gvsbuild tool: env override, then the gvsbuild <prefix>/bin
// (gvsbuild ships gdk-pixbuf-query-loaders / glib-compile-schemas /
// gtk4-update-icon-cache / fc-cache there), then PATH. Null when absent.
function findTool(leaf, envVar) {
    const envd = envVar && process.env[envVar];
    if (envd && existsSync(envd)) return envd;
    const inBin = join(gtkBin, leaf);
    if (existsSync(inBin)) return inBin;
    try {
        const p = sh('where', [leaf.replace(/\.exe$/i, '')])
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean)[0];
        if (p && existsSync(p)) return p;
    } catch {
        // not on PATH
    }
    return null;
}

// Locate dumpbin (MSVC): env override, then PATH (a dev-cmd/vcvars job), then
// vswhere's -find glob into the VC toolchain. Null when unavailable → the caller
// falls back to copying the whole bin/ DLL set.
function findDumpbin() {
    const envd = process.env.DUMPBIN;
    if (envd && existsSync(envd)) return envd;
    try {
        const p = sh('where', ['dumpbin'])
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean)[0];
        if (p && existsSync(p)) return p;
    } catch {
        // not on PATH
    }
    const vswhere = join(
        process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
        'Microsoft Visual Studio',
        'Installer',
        'vswhere.exe',
    );
    if (existsSync(vswhere)) {
        try {
            const out = sh(vswhere, ['-latest', '-products', '*', '-find', '**\\Hostx64\\x64\\dumpbin.exe']);
            const p = out
                .split(/\r?\n/)
                .map((s) => s.trim())
                .filter(Boolean)[0];
            if (p && existsSync(p)) return p;
        } catch {
            // vswhere present but no match
        }
    }
    return null;
}

// Parse `dumpbin /dependents <dll>` into the list of imported DLL leaf names (both
// normal + delay-load sections; stop at the Summary). Exit-tolerant: dumpbin can
// print the section then exit non-zero on some inputs — capture the attached stdout.
function dumpbinDeps(dumpbin, dllPath) {
    let out;
    try {
        out = sh(dumpbin, ['/nologo', '/dependents', dllPath]);
    } catch (error) {
        out = typeof error?.stdout === 'string' ? error.stdout : '';
    }
    const deps = [];
    let inDeps = false;
    for (const raw of out.split(/\r?\n/)) {
        const line = raw.replace(/\s+$/, '');
        if (/following (delay load )?dependencies:/i.test(line)) {
            inDeps = true;
            continue;
        }
        if (/^\s*Summary/i.test(line)) break;
        if (inDeps) {
            const m = line.match(/^\s+([A-Za-z0-9_.+-]+\.dll)\s*$/i);
            if (m) deps.push(m[1]);
        }
    }
    return deps;
}

// --- 1. discover the closure ----------------------------------------------
console.log(`build-gtk-runtime: gvsbuild prefix ${PREFIX}${WINDOWING ? ' (windowing superset)' : ' (display-free)'}`);
// leaf(lower) -> actual on-disk filename in <prefix>/bin
const binFiles = new Map();
for (const f of readdirSync(gtkBin)) {
    if (f.toLowerCase().endsWith('.dll')) binFiles.set(f.toLowerCase(), f);
}
if (binFiles.size === 0) {
    console.error(`build-gtk-runtime: no DLLs under ${gtkBin} — is the GTK stack extracted?`);
    process.exit(1);
}

const seedPatterns = WINDOWING ? [...SEED_PATTERNS, ...WINDOWING_SEED_PATTERNS] : SEED_PATTERNS;
const seeds = [...binFiles.values()].filter((f) => seedPatterns.some((re) => re.test(f)));
if (seeds.length === 0) {
    console.error('build-gtk-runtime: no seed DLLs matched — check the gvsbuild layout / SEED_PATTERNS');
    process.exit(1);
}

// Windowing: the gdk-pixbuf loaders (SVG/PNG/… image decoders GTK dlopen's for
// icons) live OUTSIDE bin/ — their backing libs (librsvg, …) must still land in
// bin/, so seed the closure walk with each loader DLL so its dumpbin walk pulls them.
const gdkPixbufLoaderDir = join(PREFIX, 'lib', 'gdk-pixbuf-2.0', '2.10.0', 'loaders');
const loaderSeeds = [];
if (WINDOWING && existsSync(gdkPixbufLoaderDir)) {
    for (const f of readdirSync(gdkPixbufLoaderDir)) {
        if (f.toLowerCase().endsWith('.dll')) loaderSeeds.push(join(gdkPixbufLoaderDir, f));
    }
}

// Same shape for the GStreamer plugins (§ 4g): they live outside bin/ and their
// backing DLLs must still land there, so each plugin seeds the closure walk.
const gstPluginDir = join(PREFIX, 'lib', 'gstreamer-1.0');
const gstPluginSeeds = [];
if (WINDOWING && existsSync(gstPluginDir)) {
    for (const f of readdirSync(gstPluginDir)) {
        if (f.toLowerCase().endsWith('.dll') && isBundledGstPlugin(f)) {
            gstPluginSeeds.push(join(gstPluginDir, f));
        }
    }
}
// And for the GIO modules (§ 4h) — the TLS backend. Same shape again: outside bin/,
// nothing links them, so without seeding here their backing DLLs never reach bin/ and
// the module cannot load on a machine without the build prefix.
const gioModuleDir = join(PREFIX, 'lib', 'gio', 'modules');
const gioModuleSeeds = [];
if (WINDOWING && existsSync(gioModuleDir)) {
    for (const f of readdirSync(gioModuleDir)) {
        if (f.toLowerCase().endsWith('.dll')) gioModuleSeeds.push(join(gioModuleDir, f));
    }
}
console.log(
    `build-gtk-runtime: ${seeds.length} seed DLLs${loaderSeeds.length ? ` + ${loaderSeeds.length} pixbuf loaders` : ''}` +
        `${gstPluginSeeds.length ? ` + ${gstPluginSeeds.length} gst plugins` : ''}` +
        `${gioModuleSeeds.length ? ` + ${gioModuleSeeds.length} gio modules` : ''}`,
);

const dumpbin = findDumpbin();
// leaf(lower) -> actual filename (source in <prefix>/bin); '\0loader:'-prefixed keys
// are walked-but-not-bin-copied loader sentinels.
const bundled = new Map();
if (dumpbin) {
    console.log(`build-gtk-runtime: walking the DLL closure with ${dumpbin}`);
    // Seed with bin/ seeds (leaf names) + external loader DLLs (full paths) so THEIR
    // deps are walked into bin/ even though the loaders live outside bin/.
    const queue = [...seeds, ...loaderSeeds, ...gstPluginSeeds, ...gioModuleSeeds];
    while (queue.length) {
        const entry = queue.shift();
        const isPath = entry.includes('\\') || entry.includes('/');
        const leaf = isPath ? basename(entry) : entry;
        const lower = leaf.toLowerCase();
        const src = isPath ? entry : binFiles.get(lower);
        if (!src) continue; // system / non-gvsbuild dep — leave as OS-provided
        if (!isPath) {
            if (bundled.has(lower)) continue;
            bundled.set(lower, src);
        } else if (bundled.has('\0loader:' + lower)) {
            continue;
        } else {
            bundled.set('\0loader:' + lower, null); // walked, not bin-copied (copied below)
        }
        // dumpbin needs the ABSOLUTE path: a bin/ entry's `src` is a bare filename
        // (leaf), so resolve it under <prefix>/bin; a loader entry's `src` is already
        // a full path. Passing the bare leaf made dumpbin find nothing → the closure
        // never grew past the seeds → the transitive DLLs (ffi/intl/pcre2/zlib/…)
        // were dropped and the addon failed to dlopen.
        const walkPath = isPath ? src : join(gtkBin, src);
        for (const dep of dumpbinDeps(dumpbin, walkPath)) {
            const dl = dep.toLowerCase();
            if (!bundled.has(dl) && binFiles.has(dl)) queue.push(dep);
        }
    }
} else {
    console.warn(
        'build-gtk-runtime: WARNING — dumpbin not found (no MSVC / vswhere); falling back to copying the FULL bin/*.dll set (a complete but larger superset).',
    );
    for (const [lower, src] of binFiles) bundled.set(lower, src);
}
// Real bin/ DLLs only (drop the walked-loader sentinels).
const binDlls = new Map([...bundled].filter(([k, v]) => v !== null && !k.startsWith('\0loader:')));
console.log(`build-gtk-runtime: closure = ${binDlls.size} DLLs`);

// --- 2. copy DLLs (no relocation — Windows resolves by search path) -------
const binOut = join(OUT, 'bin');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(binOut, { recursive: true });
for (const src of binDlls.values()) {
    copyFileSync(join(gtkBin, src), join(binOut, src));
}
console.log(`build-gtk-runtime: copied ${binDlls.size} DLLs -> ${binOut}`);

// --- 2b. does this bundle carry a GL IMPLEMENTATION? ----------------------
// Asked of the FINISHED bin/, not of the seed list, so the answer describes the
// artifact a user installs rather than the intent of the recipe. The negative is
// the interesting one and it is stated positively — which patterns were tried and
// that NONE matched — because the failure this closes was a seed that silently
// matched nothing while the bundle went on advertising `windowing: true`.
// `.map((f) => basename(f))`, NOT `.map(basename)`: map passes the INDEX as the
// second argument and basename reads that as its `suffix`, which throws on the
// first element. Same shape as `dllList` below.
const glImplementation = describeGlImplementation({ dlls: [...binDlls.values()].map((f) => basename(f)) });
if (WINDOWING && glImplementation.matched.length === 0) {
    const message = formatMissingGlImplementation({ gl: glImplementation, prefixBin: gtkBin });
    if (REQUIRE_GL) {
        console.error(`build-gtk-runtime: ${message}`);
        process.exit(1);
    }
    console.warn(`build-gtk-runtime: WARNING — ${message}`);
} else if (WINDOWING) {
    console.log(`build-gtk-runtime: GL implementation in bundle: ${glImplementation.matched.join(', ')}`);
}

// --- 3. typelibs — only the ones this bundle can actually BACK -------------
// gvsbuild's typelib dir covers its whole build, not our closure, so copying it
// wholesale shipped typelibs with no DLL behind them. Measured on the published
// 0.27.1 win32 tarball: 3 of 37 (Adw-1, GtkSource-5, Rsvg-2.0) — a real
// `new Adw.Application()` on that bundle fails with "Failed to load shared library
// 'adwaita-1-0.dll'" while the typelib advertises the class. The plan reads each
// typelib's OWN shared_library field, and refuses to drop one that a KEPT typelib
// depends on (see typelib-backers.mjs).
const typelibOut = join(OUT, 'girepository-1.0');
mkdirSync(typelibOut, { recursive: true });
const requiredNamespaces = [...REQUIRED_NAMESPACES, ...(WINDOWING ? WINDOWING_REQUIRED_NAMESPACES : [])];
// Windows resolves a DLL name case-INSENSITIVELY at LoadLibrary time, so the check
// models that rather than byte equality.
const typelibPlan = planTypelibSet({
    typelibs: readTypelibDir(gtkTypelibs),
    libraries: nativeLibraryIndex(binOut, { caseInsensitive: true }),
    caseInsensitive: true,
    requiredNamespaces,
});
if (typelibPlan.problems.length > 0) {
    console.error(
        `build-gtk-runtime: ${formatTypelibProblems(typelibPlan.problems, {
            stage: `planning the typelib set from ${gtkTypelibs}`,
            nativeDirLabel: 'bin/',
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
        `build-gtk-runtime: dropped ${typelibPlan.dropped.length} typelib(s) with no backing DLL in this bundle ` +
            `(nothing shipped depends on them): ${typelibPlan.dropped
                .map((t) => `${t.key} -> ${t.missing.join(' + ')}`)
                .join(', ')}`,
    );
}

// --- 4. WINDOWING data (loaders / schemas / icons / fonts) ----------------
// Each step warns where the CAUSE is visible (which prefix path was missing) and
// continues, so one gap does not hide the others — but continuing is no longer the end
// of the story: § 5b re-reads the finished bundle and FAILS the build for every declared
// set that did not arrive. Warn-and-continue alone is how `"dataBytes": 0` reached npm
// in 0.27.1. The DATA marker node-gi keys on is gschemas.compiled; a bundle without it
// is treated as display-free by the loader, i.e. the failure is silent, which is
// precisely why it is asserted instead of warned about.
const windowing = {
    pixbufLoaders: 0,
    gstPlugins: 0,
    gioModules: 0,
    schemas: false,
    iconThemes: [],
    fontconfig: false,
    gtksource: false,
};
// Every loadable module § 4a/4g/4h PLACES in its own directory, for the rule-3 gate below
// them: a module must not ALSO be a flat bin/ entry. This leg is CLEAN today — dumpbin's
// import table does not name the file it describes, so nothing queues a module the way
// `otool -L` did on darwin — and the gate is here so it stays a fact rather than a
// property of which walker each OS happens to use. See duplicatedModuleLeaves.
const placedModuleLeaves = [];
// Binaries § 4 places that are NOT loadable modules, so rule 3 does not apply to them and
// the license coverage set below still must. Today that is the GStreamer plugin scanner,
// an .exe in libexec/ — and it is exactly what "every binary the tarball carries" missed
// on the first pass: it is in neither `binDlls` nor a module list, so the win32 coverage
// gate never saw the one non-library binary in the bundle. darwin attributes it through
// its keg like any other image; this keeps the two platforms answering the same question.
const placedExecutables = [];
if (WINDOWING) {
    // 4a. gdk-pixbuf loaders + a TOPLEVEL-relative loaders.cache. The cache maps each
    // decoder DLL to its mime/extensions, and the query tool emits absolute build paths
    // that resolve on this machine alone, so the module lines get rewritten.
    //
    // Rewritten to `lib/gdk-pixbuf-2.0/2.10.0/loaders/<leaf>`, NOT to `<leaf>`. gdk-pixbuf
    // joins a relative cache entry with the bundle TOPLEVEL and never consults
    // GDK_PIXBUF_MODULEDIR, which is a generator-only variable — the leaf this used to
    // write resolved to `<bundle>\<leaf>`, so every SVG icon shipped undecodable while the
    // cache still parsed and still advertised `svg`. pixbuf-loader-cache.mjs carries the
    // measurement; `loaderCacheProblems` below is what makes the class fail the build.
    if (existsSync(gdkPixbufLoaderDir)) {
        const loadersOut = join(OUT, 'lib', 'gdk-pixbuf-2.0', '2.10.0', 'loaders');
        mkdirSync(loadersOut, { recursive: true });
        for (const f of readdirSync(gdkPixbufLoaderDir)) {
            if (f.toLowerCase().endsWith('.dll')) {
                copyFileSync(join(gdkPixbufLoaderDir, f), join(loadersOut, f));
                placedModuleLeaves.push(f);
                windowing.pixbufLoaders++;
            }
        }
        const queryTool = findTool('gdk-pixbuf-query-loaders.exe', 'GDK_PIXBUF_QUERY_LOADERS');
        const cacheOut = join(OUT, 'lib', 'gdk-pixbuf-2.0', '2.10.0', 'loaders.cache');
        if (queryTool && windowing.pixbufLoaders > 0) {
            const loaderPaths = readdirSync(loadersOut)
                .filter((f) => f.toLowerCase().endsWith('.dll'))
                .map((f) => join(loadersOut, f));
            let cache = '';
            try {
                cache = sh(queryTool, loaderPaths);
            } catch (error) {
                cache = typeof error?.stdout === 'string' ? error.stdout : '';
            }
            const rel = bundleRelativeLoaderCache(cache);
            // Asserted BEFORE the write, and against the bundle on disk: a cache naming a
            // module that is not there is the defect above, and it is invisible to every
            // other check here (§ 5b counts the files, and they are all present).
            const cacheProblems = loaderCacheProblems(rel, { bundleDir: OUT });
            if (cacheProblems.length > 0) {
                console.error(
                    `build-gtk-runtime: THE LOADER CACHE POINTS OUTSIDE THE BUNDLE —\n  ${cacheProblems.join('\n  ')}`,
                );
                process.exit(1);
            }
            writeFileSync(cacheOut, rel);
            console.log(`build-gtk-runtime: wrote loaders.cache (${windowing.pixbufLoaders} loaders, bundle-relative)`);
        } else {
            console.warn(
                'build-gtk-runtime: WARNING — gdk-pixbuf-query-loaders not found; loaders.cache NOT generated ' +
                    '(SVG/PNG icons would not load — § 5b will fail this build)',
            );
        }
    } else {
        console.warn(
            `build-gtk-runtime: WARNING — ${gdkPixbufLoaderDir} missing; no gdk-pixbuf loaders bundled ` +
                '(§ 5b will fail this build)',
        );
    }

    // 4g. GStreamer plugins + the plugin scanner — the ELEMENTS. `Gst.init()`
    // succeeds against an empty registry, so a bundle shipping libgstreamer and
    // every Gst typelib but no plugins reports itself perfectly healthy and then
    // fails far away with "no element decodebin". The same shape 4a exists for.
    //
    // EVERYTHING the prefix has, not a curated element list: guessing which codecs
    // an app will meet fails SILENTLY when the guess is wrong. The size is printed
    // instead, so the payload is a number somebody can act on. No relocation —
    // unlike darwin's Mach-O plugins, Windows resolves the backing DLLs by search
    // path, and the closure walk above already put them in bin/.
    if (existsSync(gstPluginDir)) {
        const pluginsOut = join(OUT, 'lib', 'gstreamer-1.0');
        mkdirSync(pluginsOut, { recursive: true });
        let bytes = 0;
        const shippedGstPlugins = [];
        for (const f of readdirSync(gstPluginDir)) {
            if (!f.toLowerCase().endsWith('.dll')) continue;
            // The AUDIO PATH only, same rule and same reasons as darwin.
            if (!isBundledGstPlugin(f)) continue;
            const dest = join(pluginsOut, f);
            copyFileSync(join(gstPluginDir, f), dest);
            bytes += statSync(dest).size;
            shippedGstPlugins.push(f);
            placedModuleLeaves.push(f);
            windowing.gstPlugins++;
        }
        // The scanner, which GStreamer FORKS so a plugin that crashes on load cannot
        // take the app down with it. Its compiled-in path is the build machine's, so
        // it has to be bundled AND pointed at (`GST_PLUGIN_SCANNER`, wired in
        // node-gi's gtk-runtime.js).
        const scannerSrc = join(PREFIX, 'libexec', 'gstreamer-1.0', 'gst-plugin-scanner.exe');
        if (existsSync(scannerSrc)) {
            const scannerOut = join(OUT, 'libexec', 'gstreamer-1.0');
            mkdirSync(scannerOut, { recursive: true });
            copyFileSync(scannerSrc, join(scannerOut, 'gst-plugin-scanner.exe'));
            placedExecutables.push('gst-plugin-scanner.exe');
        } else {
            console.warn(
                `build-gtk-runtime: WARNING — ${scannerSrc} missing; GStreamer will scan plugins ` +
                    'IN-PROCESS (works, until the first plugin that crashes on load)',
            );
        }
        // ZERO IS NEVER RIGHT, and the build shipped zero while staying green: the
        // plugin filter stripped `^libgst`, Windows names its plugins `gstfoo.dll`
        // without the prefix, and all 83 were skipped. Nothing noticed, because the
        // typelib symmetry gate checks typelib against LIBRARY and knows nothing
        // about plugins — so the bundle had libgstreamer, both Gst typelibs, and no
        // elements at all. That is precisely the "healthy, then no element decodebin"
        // failure this section is written against, so it is now an ERROR.
        if (windowing.gstPlugins === 0) {
            console.error(
                `build-gtk-runtime: ${gstPluginDir} holds plugins but NONE matched the audio-path ` +
                    'filter — a --windowing bundle with no GStreamer elements would report itself ' +
                    'healthy and then fail with "no element decodebin". Check isBundledGstPlugin ' +
                    "against this platform's plugin naming.",
            );
            process.exit(1);
        }
        // ZERO IS NEVER RIGHT, one element deeper — the darwin builder carries the twin
        // of this block. The count above passed on every published bundle while
        // `souphttpsrc` was absent from all of them, because a count cannot say WHICH
        // plugin is gone.
        const missingRequired = missingRequiredGstPlugins(shippedGstPlugins);
        if (missingRequired.length > 0) {
            console.error(
                `build-gtk-runtime: ${gstPluginDir} produced no plugin for ${missingRequired.join(', ')} — ` +
                    'gst-plugins.mjs marks these required because a bundle without them reports a healthy ' +
                    'Gst.init() and then fails in the application (no appsrc / no decodebin / no source ' +
                    'element for an http(s) URI). `soup` comes from gst-plugins-good and needs libsoup3 ' +
                    'built into the same gvsbuild prefix FIRST, else meson disables the plugin silently. ' +
                    'Do NOT drop the name from GST_REQUIRED_PLUGINS to get a green build.',
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
        const bundledGaps = missingBundledGstPlugins(shippedGstPlugins, 'win32-x64');
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
            `build-gtk-runtime: GStreamer — ${windowing.gstPlugins} plugin(s), ` +
                `${(bytes / 1024 / 1024).toFixed(1)} MiB`,
        );
    } else {
        console.error(
            `build-gtk-runtime: ${gstPluginDir} does not exist — a --windowing bundle with NO GStreamer ` +
                'plugin directory at all. `Gst.init()` then succeeds against an empty registry and the ' +
                'failure surfaces in the application as "no element decodebin".\n' +
                '    This used to be a warning, which is the same defect the per-plugin gap check ' +
                'below exists for, one level up: four missing files are caught and the whole directory ' +
                'missing was not (#1544). Install GStreamer into the build prefix; do NOT drop the ' +
                'windowing claim to get a green build.',
        );
        process.exit(1);
    }

    // 4h. GIO modules — the TLS backend. `GTlsConnection` has no implementation in GIO
    // itself: glib-networking ships one as a module GIO g_module_opens out of its module
    // dir. The bundle brings its own GIO and brought no module, so every https request in
    // a bundle-activated process got the DUMMY backend — `souphttpsrc` on an https URL
    // fails as "Internal data stream error", and @gjsify/tls, /http2 and /ws the same way
    // one layer up. No relocation (Windows resolves the backing DLLs by search path, and
    // the closure walk already put them in bin/); node-gi points GIO_MODULE_DIR here.
    // Declared as the `tls-backend` data set, so § 5b fails an empty one.
    if (existsSync(gioModuleDir)) {
        const modulesOut = join(OUT, 'lib', 'gio', 'modules');
        mkdirSync(modulesOut, { recursive: true });
        let bytes = 0;
        for (const src of gioModuleSeeds) {
            const dest = join(modulesOut, basename(src));
            copyFileSync(src, dest);
            bytes += statSync(dest).size;
            placedModuleLeaves.push(basename(src));
            windowing.gioModules++;
        }
        if (windowing.gioModules === 0) {
            console.error(
                `build-gtk-runtime: ${gioModuleDir} holds no GIO module DLL — the bundle would ship its ` +
                    'own GIO with no TLS backend behind it, so every https request gets the dummy backend ' +
                    'and fails as a network error. Repair: add glib-networking to the gvsbuild build.',
            );
            process.exit(1);
        }
        console.log(
            `build-gtk-runtime: GIO modules — ${windowing.gioModules} module(s), ${(bytes / 1024).toFixed(0)} KiB`,
        );
    } else {
        console.error(
            `build-gtk-runtime: ${gioModuleDir} missing — no GIO TLS backend to bundle. ` +
                'Repair: add glib-networking to the gvsbuild build (it is a dependency of the libsoup3 ' +
                'project, so building libsoup3 brings it).',
        );
        process.exit(1);
    }

    // Rule 3: no module § 4a/4g/4h placed may ALSO be a flat bin/ entry. Case-folded,
    // because bin/ is a Windows directory. The darwin twin of this gate stands after its
    // § 3, and duplicatedModuleLeaves carries the class.
    // `binDlls` is a Map (leaf -> resolved source); its VALUES are what § 2a copied.
    const duplicatedModules = duplicatedModuleLeaves(binDlls.values(), placedModuleLeaves, {
        caseInsensitive: true,
    });
    if (duplicatedModules.length > 0) {
        console.error(`build-gtk-runtime: ${formatDuplicatedModuleProblems(duplicatedModules, { flatDir: binOut })}`);
        process.exit(1);
    }

    // 4b. Compiled GSettings schemas (GTK/Adwaita read org.gnome.desktop.interface
    // etc. at startup). Copy every schema found (GTK's own + gsettings-desktop-
    // schemas if gvsbuild shipped it) and (re)compile gschemas.compiled.
    const schemasSrc = join(PREFIX, 'share', 'glib-2.0', 'schemas');
    if (existsSync(schemasSrc)) {
        const schemasOut = join(OUT, 'share', 'glib-2.0', 'schemas');
        mkdirSync(schemasOut, { recursive: true });
        for (const f of readdirSync(schemasSrc)) {
            if (f.endsWith('.xml') || f.endsWith('.gschema.override') || f === 'gschemas.compiled') {
                copyFileSync(join(schemasSrc, f), join(schemasOut, f));
            }
        }
        const compileTool = findTool('glib-compile-schemas.exe', 'GLIB_COMPILE_SCHEMAS');
        if (compileTool) {
            try {
                sh(compileTool, [schemasOut]);
            } catch (error) {
                console.warn(`build-gtk-runtime: WARNING — glib-compile-schemas failed: ${error?.message ?? error}`);
            }
        }
        windowing.schemas = existsSync(join(schemasOut, 'gschemas.compiled'));
        console.log(
            `build-gtk-runtime: GSettings schemas ${windowing.schemas ? 'compiled' : 'copied (no gschemas.compiled!)'}`,
        );
    } else {
        console.warn(
            `build-gtk-runtime: WARNING — ${schemasSrc} missing; GSettings schemas NOT bundled ` +
                '(GTK settings reads would fail — § 5b will fail this build)',
        );
    }

    // 4c. Icon themes (Adwaita for symbolic icons + hicolor fallback) + caches. The
    // theme is loaded from XDG_DATA_DIRS/icons/<theme>/ (node-gi prepends <bundle>/share).
    const updateIconCache =
        findTool('gtk4-update-icon-cache.exe', 'GTK4_UPDATE_ICON_CACHE') ??
        findTool('gtk-update-icon-cache.exe', 'GTK_UPDATE_ICON_CACHE');
    for (const theme of ['Adwaita', 'hicolor']) {
        const themeSrc = join(PREFIX, 'share', 'icons', theme);
        if (!existsSync(themeSrc)) continue;
        const themeOut = join(OUT, 'share', 'icons', theme);
        copyTreeDereferenced(themeSrc, themeOut);
        if (updateIconCache) {
            try {
                sh(updateIconCache, ['-q', '-t', '-f', themeOut]);
            } catch {
                // an existing icon-theme.cache from the copy is a usable fallback
            }
        }
        windowing.iconThemes.push(theme);
    }
    console.log(
        windowing.iconThemes.length
            ? `build-gtk-runtime: icon themes ${windowing.iconThemes.join(', ')}${updateIconCache ? ' (cache refreshed)' : ' (no update-icon-cache tool — copied caches)'}`
            : 'build-gtk-runtime: WARNING — no icon theme found under share/icons (§ 5b will fail this build)',
    );

    // 4d. Fontconfig config + cache. GTK4-on-Windows text usually goes through the
    // DirectWrite/pangowin32 backend (no fontconfig), but gvsbuild's pango can be
    // fontconfig-backed; ship etc/fonts + a cache when present so either path works.
    const fontsSrc = join(PREFIX, 'etc', 'fonts');
    if (existsSync(fontsSrc)) {
        const fontsOut = join(OUT, 'etc', 'fonts');
        copyTreeDereferenced(fontsSrc, fontsOut);
        const fcCache = findTool('fc-cache.exe', 'FC_CACHE');
        if (fcCache) {
            try {
                sh(fcCache, ['-f', fontsOut], { env: { ...process.env, FONTCONFIG_PATH: fontsOut } });
            } catch {
                // best-effort — Pango's win32 backend does not need the cache
            }
        }
        windowing.fontconfig = true;
        console.log('build-gtk-runtime: fontconfig config bundled');
    } else {
        console.log('build-gtk-runtime: no etc/fonts (pango uses the win32/DirectWrite backend) — skipping fontconfig');
    }

    // 4e. GtkSourceView's data tree — the WHOLE tree, loaded from
    // XDG_DATA_DIRS/gtksourceview-5 (node-gi prepends <bundle>/share).
    //
    // What it is, measured rather than assumed (`gresource list` on the library +
    // `ls share/gtksourceview-5`): GtkSourceView 5 compiles its BUILT-IN language-specs,
    // styles and snippets into a GResource inside the library (198 resources), so the
    // syntax highlighting travels with the DLL and does not depend on this copy at all.
    // `share/` carries the RNG/DTD schemas that validate USER-supplied .lang/.snippets
    // files plus fonts/BuilderBlocks.ttf — 4 files in GTK4_Gvsbuild_2026.6.0_x64, the
    // same shape as brew. The previous version of this step copied only language-specs +
    // styles and so dropped snippets/ and fonts/ with no diagnostic; the tree is tiny,
    // so all of it is the correct scope.
    const gtksourceSrc = join(PREFIX, 'share', 'gtksourceview-5');
    if (existsSync(gtksourceSrc)) {
        const copied = copyTreeDereferenced(gtksourceSrc, join(OUT, 'share', 'gtksourceview-5'));
        windowing.gtksource = copied.files > 0;
        windowing.gtksourceFiles = copied.files;
        console.log(
            `build-gtk-runtime: GtkSource-5 data ${windowing.gtksource ? `bundled (${copied.files} files)` : 'directory present but EMPTY'}`,
        );
    } else {
        console.warn(
            `build-gtk-runtime: WARNING — ${gtksourceSrc} missing; GtkSource-5 data NOT bundled ` +
                '(§ 5b will fail this build — use a gvsbuild prefix that ships share/gtksourceview-5)',
        );
    }
}

// --- 4f. the runtime DATA must be real files, not links into this machine ----
// gvsbuild's prefix is an extracted zip of real files, so nothing here is expected to
// trip — unlike darwin, where Homebrew's prefix is a symlink farm (measured: 859 links
// under share/icons/Adwaita, 0.2 MiB of links where the theme is 22 MB of files, PR
// #977), which is why the data steps above copy with copyTreeDereferenced() rather
// than cpSync. The check runs here too because "the source prefix has no links" is an
// assumption about someone else's packaging, not a fact this builder controls.
if (WINDOWING) {
    const links = [
        ...findSymlinks(join(OUT, 'share')),
        ...findSymlinks(join(OUT, 'lib')),
        ...findSymlinks(join(OUT, 'etc')),
    ];
    if (links.length > 0) {
        console.error(`build-gtk-runtime: ${formatSymlinkProblems(links, { root: OUT })}`);
        process.exit(1);
    }
    console.log('build-gtk-runtime: windowing data is self-contained - 0 symlinks under share/, lib/, etc/');
}

// --- 5. verify the typelib/library symmetry of the FINISHED bundle ---------
// Re-derived from the OUTPUT dirs (both sets read back off disk), so the gate is on
// the bytes that ship, and stated as a POSITIVE fact: at least one DLL-backed
// typelib, plus every namespace the package promises actually present (+ Adw and
// GtkSource under --windowing, which is what that flag is for).
const symmetry = verifyBundleTypelibs({
    typelibDir: typelibOut,
    nativeDir: binOut,
    caseInsensitive: true,
    requiredNamespaces,
});
if (symmetry.problems.length > 0) {
    console.error(
        `build-gtk-runtime: ${formatTypelibProblems(symmetry.problems, {
            stage: 'verifying the finished bundle',
            nativeDirLabel: 'bin/',
        })}`,
    );
    process.exit(1);
}
console.log(
    `build-gtk-runtime: typelib symmetry verified — ${symmetry.backed.length} backed typelib(s), every ` +
        `shared_library present in bin/; ${symmetry.headerOnly.length} header-only (no library by design); ` +
        `namespaces ${requiredNamespaces.join(', ')} all present`,
);

// --- 5b. the DECLARED windowing data must BE in the finished bundle --------
// The data-side twin of § 5, sharing its rule module with the darwin builder: a data set
// is required iff the FINISHED bundle ships the namespace it belongs to (namespaces from
// the typelib set § 5 just read off disk, not from § 4's copy plan), so § 4's warnings
// can stay where the cause is visible while a prefix gap fails HERE. The set list is the
// SAME one the darwin builder asserts — it used to be that list plus a win32-only sibling
// for the gdk-pixbuf loaders, which only win32 shipped; the darwin builder ships them now,
// so there is one list and this call passes no `sets` override at all.
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

// --- 5c. WINDOWING: DECODE an icon this bundle just shipped ----------------
// The assertion § 5b cannot make, and the reason this file changed at all (#996): § 5b
// counts the files in each declared data set, and a count is not a capability. The
// darwin sibling shipped 860 icon files of which zero decoded while its manifest read
// `verified icons: 863`; nobody has ever run a decode against the win32 bundle at all,
// which is the same missing signal with no measurement behind it yet.
//
// This is where the win32 loader mechanism finally got exercised rather than reasoned
// about, and it FAILED on its first run: the cache named its modules by BARE LEAF on the
// theory that gdk-pixbuf honours `GDK_PIXBUF_MODULEDIR`, which it does not, so the
// bundle's one external loader resolved to a path nothing writes and the probe recorded
// `0x0` for an SVG the manifest counted among 820 icon files. § 4a writes the cache
// toplevel-relative now and asserts it; this decode is what says the chain WORKS.
//
// The RECORD goes into the manifest and `verify-bundle-manifest.mjs` requires it, so a
// bundle built by an older builder, or with this step bypassed, cannot publish.
if (WINDOWING) {
    if (!ADDON) {
        console.error(
            'build-gtk-runtime: --windowing needs --addon <node_gi.node> so the bundle can DECODE one of ' +
                'its own icons before it is published. Without it the only evidence the icon theme works ' +
                'is a file count, which is what the darwin bundle passed with zero decodable icons.',
        );
        process.exit(1);
    }
    if (!existsSync(ADDON)) {
        console.error(`build-gtk-runtime: --addon ${ADDON} not found`);
        process.exit(1);
    }
    // `hostPrefixes: [PREFIX]` is load-bearing HERE and not a precaution: the job that
    // runs this puts `<PREFIX>\bin` on GITHUB_PATH one step earlier (the bundle-data
    // tools need it), and Windows resolves a DLL by SEARCH PATH — so without the scrub a
    // DLL missing from the bundle resolves from the gvsbuild prefix and the probe
    // records a pass for a bundle that works on this runner alone.
    const probe = spawnDecodeProbe({ bundleDir: OUT, addon: ADDON, hostPrefixes: [PREFIX] });
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

// --- 6. license compliance -------------------------------------------------
// The bundle carries 37–41 third-party LGPL/MPL/GPL DLLs and shipped no terms at all.
// UNLIKE darwin there is no per-binary attribution to derive: the gvsbuild prefix is
// one flat build tree (and its DLLs' VERSIONINFO is inconsistent — glib/gtk/zlib carry
// ProductName, adwaita/harfbuzz/libpng carry nothing), so the mapping cannot be read
// out of the prefix and is NOT invented here. What the prefix does document is its
// license corpus — share/doc/<project>/{COPYING,LICENSE} + share/licenses/<project>/*
// (36 files in GTK4_Gvsbuild_2026.6.0_x64) — so the whole corpus ships and the notice
// says plainly that the per-binary mapping is not recoverable. Over-inclusive beats
// silent.
//
// OVER-INCLUSIVE IN ONE DIRECTION IS NOT COVERAGE IN THE OTHER, and only the first half
// was ever checked. `assertLicenseCoverage` ran its per-binary rules under `per-binary`
// attribution only, so this call asserted "some text was recovered" — a corpus of one
// file would have passed it. Measured on the artifact: 65 DLLs, 45 documented projects,
// and nine projects behind fourteen DLLs (glib among them) with no terms in the bundle.
// The corpus is still DERIVED and the notice still refuses to claim a per-DLL mapping;
// what changed is that WIN32_LICENSE_FAMILIES lets the gate ask, per binary, whether SOME
// documented project covers it — and the build stops when one does not.
const licenseTexts = scanLicenseFiles({ root: PREFIX, subdirs: ['share/licenses', 'share/doc'], maxDepth: 2 });
const byComponent = new Map();
for (const text of licenseTexts) {
    if (!byComponent.has(text.component)) byComponent.set(text.component, { name: text.component, texts: [] });
    byComponent.get(text.component).texts.push(text);
}
// EVERY binary the tarball carries, not just bin/ — the same correction the darwin
// builder already carries. The gst plugins, the pixbuf loaders, the GIO modules and the
// plugin scanner are third-party binaries too, and a coverage check that never sees them
// cannot say the terms travel with them.
const shippedBinaries = [
    ...[...binDlls.values()].map((f) => basename(f)),
    ...placedModuleLeaves,
    ...placedExecutables,
].sort();
// THE VENDORED CORPUS, and the measurement that made it necessary. The corpus above is
// what the prefix HAPPENS to document, and on the published bundles that was 45 projects
// against 90 shipped binaries: glib, gobject-introspection, freetype, graphene, libtiff,
// libxml2, zlib, sqlite and openssl back fourteen of them and the prefix documents none —
// gvsbuild has no install step for some, and installs others under a name the scan does
// not accept (openssl installs `LICENSE` while OpenSSL 3 ships `LICENSE.txt`). So the
// bundle shipped LGPL-2.1 GLib and Apache-2.0 OpenSSL with no terms at all. The rule the
// merge follows lives in bundle-licenses.mjs so its test drives THIS code and not a copy;
// provenance per file is licenses-not-in-prefix/README.md.
for (const component of upstreamLicenseComponents({
    root: join(pkgRoot, 'licenses-not-in-prefix'),
    documented: byComponent.keys(),
    binaries: shippedBinaries,
    families: WIN32_LICENSE_FAMILIES,
})) {
    byComponent.set(component.name, component);
}
const licenseComponents = [...byComponent.values()].sort((a, b) => a.name.localeCompare(b.name));
const licensePayload = writeLicensePayload({ outDir: join(OUT, 'licenses'), components: licenseComponents });
writeFileSync(
    join(OUT, 'THIRD-PARTY-NOTICES.md'),
    renderThirdPartyNotice({
        target: 'win32-x64',
        builder: BUILDER_ID,
        provenance: PREFIX,
        windowing: WINDOWING,
        // Windows needs no relocation: the DLLs are byte-identical copies and the
        // bundle is made portable by the loader's PATH prepend alone.
        modifications: [],
        components: licenseComponents,
        binaries: shippedBinaries,
        attribution: 'prefix',
        payloadDir: 'licenses',
    }),
);
const licenseProblems = assertLicenseCoverage({
    components: licenseComponents,
    binaries: shippedBinaries,
    attribution: 'prefix',
    textCount: licensePayload.files.length,
    families: WIN32_LICENSE_FAMILIES,
});
if (licenseProblems.length > 0) {
    console.error(`build-gtk-runtime: ${formatLicenseProblems(licenseProblems, { prefix: PREFIX })}`);
    process.exit(1);
}
const upstreamComponents = licenseComponents.filter((c) => c.upstreamText).map((c) => c.name);
console.log(
    `build-gtk-runtime: licenses — ${licensePayload.files.length} text(s) from ${licenseComponents.length} ` +
        `project(s) (${(licensePayload.bytes / 1024).toFixed(0)} KiB) covering ${shippedBinaries.length} ` +
        `binary/ies -> licenses/, notice -> THIRD-PARTY-NOTICES.md` +
        `${upstreamComponents.length ? ` (${upstreamComponents.join(', ')} from upstream, not from the prefix)` : ''}`,
);

// --- manifest + size -------------------------------------------------------
// lstat, NOT stat. § 4 dereferences every data tree and § 4f fails the build on any link
// left under one, so on a correct build the two agree; lstat encodes the invariant rather
// than the workaround — a size the manifest reports must be the size on disk, whatever
// ends up under share/ (following an alias link counts it at its target's full size, and
// that is how the darwin manifest once reported 19.4 MiB of data it did not have).
function dirSize(dir) {
    if (!existsSync(dir)) return 0;
    let total = 0;
    for (const f of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, f.name);
        total += f.isDirectory() ? dirSize(p) : lstatSync(p).size;
    }
    return total;
}
const binBytes = dirSize(binOut);
const typelibBytes = dirSize(typelibOut);
const dataBytes = WINDOWING ? dirSize(join(OUT, 'lib')) + dirSize(join(OUT, 'share')) + dirSize(join(OUT, 'etc')) : 0;
const licenseBytes = dirSize(join(OUT, 'licenses'));
const manifest = {
    platform: 'win32-x64',
    windowing: WINDOWING,
    builder: BUILDER_ID,
    generatedFrom: PREFIX,
    walkedWith: dumpbin ? 'dumpbin' : 'copy-all-fallback',
    dlls: binDlls.size,
    typelibs: typelibCount,
    binBytes,
    typelibBytes,
    dataBytes,
    licenseBytes,
    totalBytes: binBytes + typelibBytes + dataBytes + licenseBytes,
    dllList: [...binDlls.values()].map((f) => basename(f)).sort((a, b) => a.localeCompare(b)),
    // Proof-of-symmetry, recorded so a consumer holding only the tarball can see that
    // the claim was checked and what it excluded (and why).
    typelibSymmetry: {
        backed: symmetry.backed.length,
        headerOnly: symmetry.headerOnly.length,
        dropped: typelibPlan.dropped.map((t) => ({ namespace: t.key, missing: t.missing })),
        requiredNamespaces,
    },
    // Windowing-only: a display-free bundle is not expected to rasterise anything,
    // so the absence of GL there is by design and recording it would read as a gap.
    ...(WINDOWING ? { glImplementation } : {}),
    licenses: {
        notice: 'THIRD-PARTY-NOTICES.md',
        dir: 'licenses',
        attribution: 'prefix',
        components: licenseComponents.length,
        texts: licensePayload.files.length,
        // Recorded, not just asserted: a consumer holding only the tarball can see how
        // many binaries the coverage check actually covered, and which projects' terms
        // came from upstream because the build prefix documents none.
        binariesCovered: shippedBinaries.length,
        upstreamComponents,
        binariesModified: false,
        modifications: [],
    },
    ...(WINDOWING ? { windowingData: windowing } : {}),
};
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));

const mb = (n) => (n / 1024 / 1024).toFixed(1);
console.log(
    `build-gtk-runtime: DONE -> ${OUT}\n` +
        `  DLLs:     ${binDlls.size} (${mb(binBytes)} MiB)\n` +
        `  typelibs: ${typelibCount} (${mb(typelibBytes)} MiB)\n` +
        (WINDOWING
            ? `  data:     loaders=${windowing.pixbufLoaders} schemas=${windowing.schemas} icons=[${windowing.iconThemes.join(',')}] fontconfig=${windowing.fontconfig} (${mb(dataBytes)} MiB)\n`
            : '') +
        `  licenses: ${licensePayload.files.length} text(s) (${mb(licenseBytes)} MiB)\n` +
        `  total:    ${mb(manifest.totalBytes)} MiB`,
);
