// SPDX-License-Identifier: MIT
// Collect a standalone, batteries-included GTK/GObject-Introspection runtime
// bundle for Windows x64 — so @gjsify/node-gi's display-free conformance runs with
// NO gvsbuild/system GTK on the host (the Windows sibling of the darwin-arm64
// bundle).
//
//   node scripts/build-gtk-runtime.mjs [--out <dir>] [--prefix <gvsbuild GTK prefix>]
//
// Runs ONLY on win32/x64 with a build-time gvsbuild GTK4 stack extracted at
// --prefix (env GTK_PREFIX, the same tree the node-gi.yml `windows` job caches at
// C:\gtk-build\gtk\x64\release). It:
//   1. Enumerates <prefix>/bin/*.dll and, from the display-free seed DLLs the
//      conformance loads (glib/gobject/gio/gmodule + girepository + cairo + pango +
//      graphene + gdk-pixbuf + gtk4 + harfbuzz), walks the DLL import closure with
//      `dumpbin /dependents` (recursively), keeping every dependency that is itself
//      a gvsbuild DLL (system DLLs like KERNEL32 are left OS-provided — they never
//      resolve to a file in <prefix>/bin, so the "keep only gvsbuild-resident deps"
//      filter drops them). If dumpbin can't be located, it falls back to copying the
//      whole <prefix>/bin/*.dll set (a complete superset — a loud WARNING flags it).
//   2. Copies the closure DLLs FLAT into <out>/bin.
//   3. Copies the typelib set into <out>/girepository-1.0.
//
// CRUCIAL DIFFERENCE FROM macOS: there is NO relocation step (no install_name_tool,
// no @rpath, no codesign). Windows resolves a DLL's imports by SEARCH PATH at
// LoadLibrary time, so a bundle is "portable" the moment its DLLs sit in one dir —
// node-gi just prepends <out>/bin to PATH before the addon loads (see the package
// README + @gjsify/node-gi/gtk-runtime.js). Copying is the whole job.
//
// Reference: GJS ships no relocation; gvsbuild ships the MSVC-ABI GTK4 stack whose
// DLLs load into stock (MSVC-ABI) Node.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
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

if (process.platform !== 'win32' || process.arch !== 'x64') {
    console.error(`build-gtk-runtime: only supported on win32/x64, not ${process.platform}/${process.arch}`);
    process.exit(2);
}
if (!PREFIX) {
    console.error('build-gtk-runtime: no GTK prefix — pass --prefix or set GTK_PREFIX (e.g. C:\\gtk-build\\gtk\\x64\\release)');
    process.exit(1);
}

const gtkBin = join(PREFIX, 'bin');
const gtkTypelibs = join(PREFIX, 'lib', 'girepository-1.0');
if (!existsSync(gtkBin)) {
    console.error(`build-gtk-runtime: ${gtkBin} not found — extract the gvsbuild GTK4 stack first`);
    process.exit(1);
}

const sh = (bin, args) => execFileSync(bin, args, { encoding: 'utf8' });

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

// Locate dumpbin (MSVC): env override, then PATH (a dev-cmd/vcvars job), then
// vswhere's -find glob into the VC toolchain. Null when unavailable → the caller
// falls back to copying the whole bin/ DLL set.
function findDumpbin() {
    const envd = process.env.DUMPBIN;
    if (envd && existsSync(envd)) return envd;
    try {
        const p = sh('where', ['dumpbin']).split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
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
            const p = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
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
console.log(`build-gtk-runtime: gvsbuild prefix ${PREFIX}`);
// leaf(lower) -> actual on-disk filename in <prefix>/bin
const binFiles = new Map();
for (const f of readdirSync(gtkBin)) {
    if (f.toLowerCase().endsWith('.dll')) binFiles.set(f.toLowerCase(), f);
}
if (binFiles.size === 0) {
    console.error(`build-gtk-runtime: no DLLs under ${gtkBin} — is the GTK stack extracted?`);
    process.exit(1);
}

const seeds = [...binFiles.values()].filter((f) => SEED_PATTERNS.some((re) => re.test(f)));
if (seeds.length === 0) {
    console.error('build-gtk-runtime: no seed DLLs matched — check the gvsbuild layout / SEED_PATTERNS');
    process.exit(1);
}
console.log(`build-gtk-runtime: ${seeds.length} seed DLLs: ${seeds.join(', ')}`);

const dumpbin = findDumpbin();
// leaf(lower) -> actual filename (source in <prefix>/bin)
const bundled = new Map();
if (dumpbin) {
    console.log(`build-gtk-runtime: walking the DLL closure with ${dumpbin}`);
    const queue = [...seeds];
    while (queue.length) {
        const leaf = queue.shift();
        const lower = leaf.toLowerCase();
        if (bundled.has(lower)) continue;
        const src = binFiles.get(lower);
        if (!src) continue; // system / non-gvsbuild dep — leave as OS-provided
        bundled.set(lower, src);
        for (const dep of dumpbinDeps(dumpbin, join(gtkBin, src))) {
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
console.log(`build-gtk-runtime: closure = ${bundled.size} DLLs`);

// --- 2. copy DLLs (no relocation — Windows resolves by search path) -------
const binOut = join(OUT, 'bin');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(binOut, { recursive: true });
for (const src of bundled.values()) {
    copyFileSync(join(gtkBin, src), join(binOut, src));
}
console.log(`build-gtk-runtime: copied ${bundled.size} DLLs -> ${binOut}`);

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

// --- manifest + size -------------------------------------------------------
function dirSize(dir) {
    let total = 0;
    for (const f of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, f.name);
        total += f.isDirectory() ? dirSize(p) : statSync(p).size;
    }
    return total;
}
const binBytes = dirSize(binOut);
const typelibBytes = dirSize(typelibOut);
const manifest = {
    platform: 'win32-x64',
    generatedFrom: PREFIX,
    walkedWith: dumpbin ? 'dumpbin' : 'copy-all-fallback',
    dlls: bundled.size,
    typelibs: typelibCount,
    binBytes,
    typelibBytes,
    totalBytes: binBytes + typelibBytes,
    dllList: [...bundled.values()].map((f) => basename(f)).sort((a, b) => a.localeCompare(b)),
};
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));

const mb = (n) => (n / 1024 / 1024).toFixed(1);
console.log(
    `build-gtk-runtime: DONE -> ${OUT}\n` +
        `  DLLs:     ${bundled.size} (${mb(binBytes)} MiB)\n` +
        `  typelibs: ${typelibCount} (${mb(typelibBytes)} MiB)\n` +
        `  total:    ${mb(manifest.totalBytes)} MiB`,
);
