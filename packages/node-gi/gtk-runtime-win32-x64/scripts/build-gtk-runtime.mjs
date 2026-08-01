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
import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));

// --- args ------------------------------------------------------------------
function argValue(flag) {
    const i = process.argv.indexOf(flag);
    return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}
const OUT = argValue('--out') ?? join(pkgRoot, 'gtk');
const PREFIX = argValue('--prefix') ?? process.env.GTK_PREFIX;
// The full-windowing SUPERSET: also collect the runtime data a real GTK window needs.
const WINDOWING = process.argv.includes('--windowing');

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
// conformance never touches Adwaita, so it is NOT in the base seeds), the GL backing
// a GSK GL renderer picks (ANGLE libEGL/libGLESv2 + epoxy — the cairo renderer needs
// none, but a real window may negotiate GL), and librsvg (the SVG gdk-pixbuf loader
// that renders the Adwaita symbolic icons). Most GL/rsvg deps are pulled transitively
// by the loaders below; naming them keeps the closure complete even if a loader is
// missing. (Gdk/Gsk/Gtk are all in gtk-4-*.dll, already a base seed.)
const WINDOWING_SEED_PATTERNS = [
    /^(lib)?adwaita-1.*\.dll$/i, // gvsbuild leaf: adwaita-1-0.dll (backs the Adw-1 typelib)
    /^(lib)?gtksourceview-5.*\.dll$/i, // gvsbuild leaf: gtksourceview-5-0.dll (backs the GtkSource-5 typelib — the Learn6502 editor)
    /^libEGL.*\.dll$/i,
    /^libGLESv2.*\.dll$/i,
    /^epoxy.*\.dll$/i,
    /^rsvg.*\.dll$/i,
    /^libxml2.*\.dll$/i,
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
console.log(
    `build-gtk-runtime: ${seeds.length} seed DLLs${loaderSeeds.length ? ` + ${loaderSeeds.length} pixbuf loaders` : ''}`,
);

const dumpbin = findDumpbin();
// leaf(lower) -> actual filename (source in <prefix>/bin); '\0loader:'-prefixed keys
// are walked-but-not-bin-copied loader sentinels.
const bundled = new Map();
if (dumpbin) {
    console.log(`build-gtk-runtime: walking the DLL closure with ${dumpbin}`);
    // Seed with bin/ seeds (leaf names) + external loader DLLs (full paths) so THEIR
    // deps are walked into bin/ even though the loaders live outside bin/.
    const queue = [...seeds, ...loaderSeeds];
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

// --- 3. typelibs -----------------------------------------------------------
const typelibOut = join(OUT, 'girepository-1.0');
mkdirSync(typelibOut, { recursive: true });
let typelibCount = 0;
if (existsSync(gtkTypelibs)) {
    for (const f of readdirSync(gtkTypelibs)) {
        if (f.endsWith('.typelib')) {
            copyFileSync(join(gtkTypelibs, f), join(typelibOut, f));
            typelibCount++;
        }
    }
}
console.log(`build-gtk-runtime: copied ${typelibCount} typelibs`);

// --- 4. WINDOWING data (loaders / schemas / icons / fonts) ----------------
// Each step is independent + defensive: a missing tree/tool WARNS + continues so a
// partial gvsbuild layout still produces the DLL+typelib bundle. The DATA marker
// node-gi keys on is gschemas.compiled; if that step fails the loader treats the
// bundle as display-free (no windowing env wired).
const windowing = { pixbufLoaders: 0, schemas: false, iconThemes: [], fontconfig: false, gtksource: false };
if (WINDOWING) {
    // 4a. gdk-pixbuf loaders + a bundle-relative loaders.cache. The cache maps each
    // decoder DLL to its mime/extensions; gdk-pixbuf resolves the DLL paths in it
    // relative to GDK_PIXBUF_MODULEDIR when set (node-gi sets it), so we rewrite the
    // absolute build paths the query tool emits down to leaf names.
    if (existsSync(gdkPixbufLoaderDir)) {
        const loadersOut = join(OUT, 'lib', 'gdk-pixbuf-2.0', '2.10.0', 'loaders');
        mkdirSync(loadersOut, { recursive: true });
        for (const f of readdirSync(gdkPixbufLoaderDir)) {
            if (f.toLowerCase().endsWith('.dll')) {
                copyFileSync(join(gdkPixbufLoaderDir, f), join(loadersOut, f));
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
            // A loader header line is a quoted absolute path; strip it to the leaf so
            // GDK_PIXBUF_MODULEDIR resolves it in the consumer's bundle.
            const rel = cache.replace(/^"(.*[\\/])?([^"\\/]+\.dll)"\s*$/gim, '"$2"');
            writeFileSync(cacheOut, rel);
            console.log(`build-gtk-runtime: wrote loaders.cache (${windowing.pixbufLoaders} loaders, bundle-relative)`);
        } else {
            console.warn(
                'build-gtk-runtime: WARNING — gdk-pixbuf-query-loaders not found; loaders.cache NOT generated (SVG/PNG icons may not load)',
            );
        }
    } else {
        console.warn(`build-gtk-runtime: WARNING — ${gdkPixbufLoaderDir} missing; no gdk-pixbuf loaders bundled`);
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
            `build-gtk-runtime: WARNING — ${schemasSrc} missing; GSettings schemas NOT bundled (GTK settings reads will fail)`,
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
        cpSync(themeSrc, themeOut, { recursive: true });
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
            : 'build-gtk-runtime: WARNING — no Adwaita/hicolor icon theme found under share/icons (symbolic icons may be blank)',
    );

    // 4d. Fontconfig config + cache. GTK4-on-Windows text usually goes through the
    // DirectWrite/pangowin32 backend (no fontconfig), but gvsbuild's pango can be
    // fontconfig-backed; ship etc/fonts + a cache when present so either path works.
    const fontsSrc = join(PREFIX, 'etc', 'fonts');
    if (existsSync(fontsSrc)) {
        const fontsOut = join(OUT, 'etc', 'fonts');
        cpSync(fontsSrc, fontsOut, { recursive: true });
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

    // 4e. GtkSource-5 runtime DATA: the syntax-highlighting language definitions
    // (share/gtksourceview-5/language-specs/*.lang) + style schemes
    // (share/gtksourceview-5/styles/*.xml). GtkSource's LanguageManager /
    // StyleSchemeManager load these from XDG_DATA_DIRS/gtksourceview-5 (node-gi
    // prepends <bundle>/share), so without them the Learn6502 editor's GtkSource.View
    // constructs but has no built-in languages/styles. Defensive: WARN + continue if
    // gvsbuild's layout lacks the tree (the DLL + typelib still ship, so GtkSource
    // itself works — only the bundled highlight data is absent).
    const gtksourceSrc = join(PREFIX, 'share', 'gtksourceview-5');
    if (existsSync(gtksourceSrc)) {
        const gtksourceOut = join(OUT, 'share', 'gtksourceview-5');
        let copied = 0;
        for (const sub of ['language-specs', 'styles']) {
            const subSrc = join(gtksourceSrc, sub);
            if (existsSync(subSrc)) {
                cpSync(subSrc, join(gtksourceOut, sub), { recursive: true });
                copied += readdirSync(subSrc).length;
            }
        }
        windowing.gtksource = copied > 0;
        console.log(
            `build-gtk-runtime: GtkSource-5 data ${windowing.gtksource ? `bundled (${copied} language-specs/styles files)` : 'directory present but empty'}`,
        );
    } else {
        console.warn(
            `build-gtk-runtime: WARNING — ${gtksourceSrc} missing; GtkSource-5 language-specs/styles NOT bundled (the editor's built-in highlighting will be unavailable)`,
        );
    }
}

// --- manifest + size -------------------------------------------------------
function dirSize(dir) {
    if (!existsSync(dir)) return 0;
    let total = 0;
    for (const f of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, f.name);
        total += f.isDirectory() ? dirSize(p) : statSync(p).size;
    }
    return total;
}
const binBytes = dirSize(binOut);
const typelibBytes = dirSize(typelibOut);
const dataBytes = WINDOWING ? dirSize(join(OUT, 'lib')) + dirSize(join(OUT, 'share')) + dirSize(join(OUT, 'etc')) : 0;
const manifest = {
    platform: 'win32-x64',
    windowing: WINDOWING,
    generatedFrom: PREFIX,
    walkedWith: dumpbin ? 'dumpbin' : 'copy-all-fallback',
    dlls: binDlls.size,
    typelibs: typelibCount,
    binBytes,
    typelibBytes,
    dataBytes,
    totalBytes: binBytes + typelibBytes + dataBytes,
    dllList: [...binDlls.values()].map((f) => basename(f)).sort((a, b) => a.localeCompare(b)),
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
        `  total:    ${mb(manifest.totalBytes)} MiB`,
);
