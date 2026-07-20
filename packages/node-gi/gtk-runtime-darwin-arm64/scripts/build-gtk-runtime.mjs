// SPDX-License-Identifier: MIT
// Collect + relocate a standalone, batteries-included GTK/GObject-Introspection
// runtime bundle for macOS arm64 — so @gjsify/node-gi's display-free conformance
// runs with NO Homebrew GTK on the host (Phase 2 of cross-platform node-gi).
//
//   node scripts/build-gtk-runtime.mjs [--out <dir>] [--addon <node_gi.node>] [--stage <dir>]
//
// Runs ONLY on darwin/arm64 with a build-time Homebrew GTK stack installed (the
// closure SOURCE — not shipped). It:
//   1. Walks the dylib graph (`otool -L`, recursively) from the typelib-backing
//      libraries the conformance loads (glib/gobject/gio + girepository + cairo +
//      pango + graphene + gdk-pixbuf + gtk4), collecting every Homebrew dylib.
//   2. Copies them flat into <out>/lib and RELOCATES each: rewrites its own id +
//      every sibling reference to `@loader_path/<leaf>` (via install_name_tool),
//      leaving /usr/lib + /System refs untouched, then AD-HOC RE-SIGNS it
//      (`codesign -s -`) — mandatory on Apple silicon: install_name_tool
//      invalidates the code signature and dyld refuses an unsigned/mis-signed
//      dylib.
//   3. Copies the typelib set into <out>/girepository-1.0.
//   4. (optional) Relocates a COPY of the node-gi addon (--addon) so it loads the
//      BUNDLED libgirepository via `@rpath` (add_rpath @loader_path/gtk/lib) with
//      NO Homebrew — the env-free path the core conformance leg exercises.
//
// The result is portable: none of the bundled libraries reference /opt/homebrew.
// Reference: GJS ships no relocation; the technique mirrors macOS app-bundle
// dylib fix-up (install_name_tool + @loader_path + ad-hoc codesign).
import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));

// --- args ------------------------------------------------------------------
function argValue(flag) {
    const i = process.argv.indexOf(flag);
    return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}
const OUT = argValue('--out') ?? join(pkgRoot, 'gtk');
const ADDON = argValue('--addon'); // optional: a node_gi.node to relocate a copy of
const STAGE = argValue('--stage'); // optional: sibling layout <stage>/{node_gi.node,gtk/}

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    console.error(`build-gtk-runtime: only supported on darwin/arm64, not ${process.platform}/${process.arch}`);
    process.exit(2);
}

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
];

// WINDOWING superset (opt-in via --windowing): also bundle libadwaita, whose dylib
// backs the Adw-1 typelib. The display-free conformance closure never touches
// Adwaita, so it is NOT a base seed — but the batteries-included bundle ships the
// Adw-1 TYPELIB, so without libadwaita's dylib a real `new Adw.Application()` fails
// with "Failed to load shared library 'libadwaita-1.0.dylib'" (→ Adw.Application is
// not a constructible GObject type). This is exactly what the macOS GTK-GUI proof
// (macos-gtk-windowing) needs; the recursive otool walk pulls libadwaita's
// transitive deps + relocates them like any other seed. Mirrors the win32
// --windowing superset (WINDOWING_SEED_PATTERNS there).
const WINDOWING = process.argv.includes('--windowing');
const WINDOWING_SEED_PATTERNS = [/^libadwaita-1\..*\.dylib$/];

function isSystemPath(p) {
    return p.startsWith('/usr/lib/') || p.startsWith('/System/');
}

// Parse an `otool -L <lib>` output into the list of dependency install paths
// (skipping the first line — the library's own id — and system libraries).
function otoolDeps(libPath) {
    let out;
    try {
        out = sh('otool', ['-L', libPath]);
    } catch {
        return [];
    }
    const lines = out.split('\n').slice(1); // line 0 is the id, not a dep
    const deps = [];
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const path = trimmed.split(' (')[0];
        if (!path || isSystemPath(path)) continue;
        deps.push(path);
    }
    return deps;
}

// Resolve a dependency's leaf to the real Homebrew file (following symlinks),
// or null when it is not a Homebrew library we bundle.
function resolveInBrew(leaf) {
    const candidate = join(brewLib, leaf);
    if (!existsSync(candidate)) return null;
    try {
        return realpathSync(candidate);
    } catch {
        return null;
    }
}

// --- 1. discover the closure ----------------------------------------------
console.log(`build-gtk-runtime: brew prefix ${brewPrefix}${WINDOWING ? ' (windowing superset — + libadwaita)' : ' (display-free)'}`);
const seedPatterns = WINDOWING ? [...SEED_PATTERNS, ...WINDOWING_SEED_PATTERNS] : SEED_PATTERNS;
const seeds = readdirSync(brewLib).filter((f) => seedPatterns.some((re) => re.test(f)));
if (seeds.length === 0) {
    console.error('build-gtk-runtime: no seed libraries found — is the GTK stack installed?');
    process.exit(1);
}
console.log(`build-gtk-runtime: ${seeds.length} seed libraries: ${seeds.join(', ')}`);

const bundled = new Map(); // leaf -> real source path
const queue = [...seeds];
while (queue.length) {
    const leaf = queue.shift();
    if (bundled.has(leaf)) continue;
    const real = resolveInBrew(leaf);
    if (!real) continue; // system / non-brew dep — leave as-is
    bundled.set(leaf, real);
    for (const dep of otoolDeps(real)) {
        const depLeaf = basename(dep);
        if (!bundled.has(depLeaf)) queue.push(depLeaf);
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
function relocate(libPath, { id } = {}) {
    // Own id (dylibs only).
    if (id) execFileSync('install_name_tool', ['-id', `@loader_path/${basename(libPath)}`, libPath]);
    // Rewrite every dependency that points at a library WE bundle → @loader_path.
    for (const dep of otoolDeps(libPath)) {
        if (bundledLeaves.has(basename(dep))) {
            execFileSync('install_name_tool', ['-change', dep, `@loader_path/${basename(dep)}`, libPath]);
        }
    }
    // Ad-hoc re-sign — install_name_tool invalidated the signature (arm64 hard req).
    execFileSync('codesign', ['--force', '--sign', '-', libPath]);
}

for (const leaf of bundledLeaves) {
    relocate(join(libOut, leaf), { id: true });
}
console.log(`build-gtk-runtime: relocated + re-signed ${bundledLeaves.size} dylibs → @loader_path`);

// --- 3. typelibs -----------------------------------------------------------
const typelibOut = join(OUT, 'girepository-1.0');
mkdirSync(typelibOut, { recursive: true });
let typelibCount = 0;
if (existsSync(brewTypelibs)) {
    for (const f of readdirSync(brewTypelibs)) {
        if (f.endsWith('.typelib')) {
            copyFileSync(join(brewTypelibs, f), join(typelibOut, f));
            typelibCount++;
        }
    }
}
console.log(`build-gtk-runtime: copied ${typelibCount} typelibs`);

// --- 4. optional: relocate a copy of the node-gi addon --------------------
// The addon (built against Homebrew) carries absolute /opt/homebrew refs. Rewrite
// them to @rpath/<leaf> + add an rpath to the SIBLING bundle so it loads the
// bundled libgirepository with NO Homebrew — the env-free core-conformance path.
if (ADDON) {
    if (!existsSync(ADDON)) {
        console.error(`build-gtk-runtime: --addon ${ADDON} not found`);
        process.exit(1);
    }
    const stageDir = STAGE ?? join(OUT, '..', 'staged');
    mkdirSync(stageDir, { recursive: true });
    const addonDest = join(stageDir, 'node_gi.node');
    copyFileSync(ADDON, addonDest);
    // Point the addon at the bundle staged as its sibling `gtk/`.
    cpSync(OUT, join(stageDir, 'gtk'), { recursive: true });

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
    console.log(`build-gtk-runtime: relocated addon → ${addonDest} (rpath @loader_path/gtk/lib)`);
}

// --- manifest + size -------------------------------------------------------
function dirSize(dir) {
    let total = 0;
    for (const f of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, f.name);
        total += f.isDirectory() ? dirSize(p) : statSync(p).size;
    }
    return total;
}
const libBytes = dirSize(libOut);
const typelibBytes = dirSize(typelibOut);
const manifest = {
    platform: 'darwin-arm64',
    generatedFrom: brewPrefix,
    dylibs: bundledLeaves.size,
    typelibs: typelibCount,
    libBytes,
    typelibBytes,
    totalBytes: libBytes + typelibBytes,
    dylibList: [...bundledLeaves].sort(),
};
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));

const mb = (n) => (n / 1024 / 1024).toFixed(1);
console.log(
    `build-gtk-runtime: DONE → ${OUT}\n` +
        `  dylibs:   ${bundledLeaves.size} (${mb(libBytes)} MiB)\n` +
        `  typelibs: ${typelibCount} (${mb(typelibBytes)} MiB)\n` +
        `  total:    ${mb(manifest.totalBytes)} MiB`,
);
