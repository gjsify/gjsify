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
//   3. VERIFIES the relocation (see verifyRelocation) — the assertion is
//      brew-prefix-DERIVED, because the prefix is /opt/homebrew on Apple silicon
//      and /usr/local on Intel: a hardcoded `/opt/homebrew` grep passes vacuously
//      on an Intel runner and would have proven nothing about the arch this script
//      exists to add.
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
    writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    assertLicenseCoverage,
    describeBrewKegs,
    formatLicenseProblems,
    renderThirdPartyNotice,
    writeLicensePayload,
} from './bundle-licenses.mjs';
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
// (WINDOWING_SEED_PATTERNS there), and its runtime DATA is § 4b below (schemas, icon
// themes, GtkSource language-specs/styles).
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
const WINDOWING_SEED_PATTERNS = [/^libadwaita-1\..*\.dylib$/, /^libgtksourceview-5\..*\.dylib$/];

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
verifyRelocation([...bundledLeaves].map((leaf) => join(libOut, leaf)));

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
// icon themes, and GtkSource's language-specs/styles. These are plain files (no dylib
// relocation), located at runtime via GSETTINGS_SCHEMA_DIR / XDG_DATA_DIRS (node-gi's
// gtk-runtime.js maybeWireGtkWindowingEnv keys on the gschemas.compiled marker). Gated
// on --windowing; the display-free bundle is byte-unchanged. NB the gdk-pixbuf image
// LOADERS (needed to render SVG symbolic icons) are NOT bundled yet — they are dylibs
// that need @loader_path relocation from a NESTED dir (unlike win32's plain DLL copy);
// tracked follow-up, so symbolic icons may be blank until then.
const windowing = { schemas: false, iconThemes: [], gtksource: false };
if (WINDOWING) {
    const brewShare = join(brewPrefix, 'share');
    const findTool = (leaf) => {
        const inBrew = join(brewPrefix, 'bin', leaf);
        return existsSync(inBrew) ? inBrew : leaf; // fall back to PATH
    };

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
            `build-gtk-runtime: WARNING — ${schemasSrc} missing; GSettings schemas NOT bundled (Gio.Settings will fail)`,
        );
    }

    // 4b-b. Icon themes (Adwaita symbolic + hicolor) + caches, loaded from
    // XDG_DATA_DIRS/icons/<theme>/.
    const updateIconCache = findTool('gtk4-update-icon-cache');
    for (const theme of ['Adwaita', 'hicolor']) {
        const themeSrc = join(brewShare, 'icons', theme);
        if (!existsSync(themeSrc)) continue;
        cpSync(themeSrc, join(OUT, 'share', 'icons', theme), { recursive: true });
        try {
            execFileSync(updateIconCache, ['-q', '-t', '-f', join(OUT, 'share', 'icons', theme)]);
        } catch {
            // an existing icon-theme.cache from the copy is a usable fallback
        }
        windowing.iconThemes.push(theme);
    }
    console.log(
        windowing.iconThemes.length
            ? `build-gtk-runtime: icon themes ${windowing.iconThemes.join(', ')}`
            : 'build-gtk-runtime: WARNING — no Adwaita/hicolor icon theme under share/icons',
    );

    // 4b-c. GtkSource-5 language-specs + styles (the editor's syntax highlighting).
    const gtksourceSrc = join(brewShare, 'gtksourceview-5');
    if (existsSync(gtksourceSrc)) {
        let copied = 0;
        for (const sub of ['language-specs', 'styles']) {
            const subSrc = join(gtksourceSrc, sub);
            if (existsSync(subSrc)) {
                cpSync(subSrc, join(OUT, 'share', 'gtksourceview-5', sub), { recursive: true });
                copied += readdirSync(subSrc).length;
            }
        }
        windowing.gtksource = copied > 0;
        console.log(
            `build-gtk-runtime: GtkSource-5 data ${windowing.gtksource ? `bundled (${copied} files)` : 'empty'}`,
        );
    } else {
        console.warn(`build-gtk-runtime: WARNING — ${gtksourceSrc} missing; GtkSource-5 data NOT bundled`);
    }
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

// --- 5. license compliance --------------------------------------------------
// The bundle carries ~45 third-party LGPL/MPL libraries and MODIFIES them (§ 2
// rewrites install names, then re-signs). Attribution is derived from where each
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
const { components: licenseComponents, unattributed } = describeBrewKegs({
    files: bundled,
    fallbackLicense: brewInfoLicense,
});
const licensePayload = writeLicensePayload({ outDir: join(OUT, 'licenses'), components: licenseComponents });
const MODIFICATIONS = [
    '`install_name_tool -id` / `-change`: every install name and every reference to a sibling in this bundle ' +
        'rewritten to `@loader_path/<leaf>` (references to /usr/lib and /System are untouched).',
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
        binaries: [...bundledLeaves],
        attribution: 'per-binary',
        payloadDir: 'licenses',
    }),
);
const licenseProblems = assertLicenseCoverage({
    components: licenseComponents,
    binaries: [...bundledLeaves],
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
        `${bundledLeaves.size} dylib(s), ${licensePayload.files.length} license text(s) ` +
        `(${(licensePayload.bytes / 1024).toFixed(0)} KiB) → licenses/, notice → THIRD-PARTY-NOTICES.md`,
);

// --- 6. optional: relocate a copy of the node-gi addon --------------------
// The addon (built against Homebrew) carries absolute Homebrew refs. Rewrite them to
// @rpath/<leaf> + add an rpath to the SIBLING bundle so it loads the bundled
// libgirepository with NO Homebrew — the env-free core-conformance path.
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
    // The addon gets the SAME assertion as the dylibs: a surviving absolute ref to a
    // bundled leaf is the "loads on the build host, resolves nothing elsewhere" bug,
    // and until now only the dylibs were checked for it.
    verifyRelocation([addonDest]);
    console.log(`build-gtk-runtime: relocated addon → ${addonDest} (rpath @loader_path/gtk/lib)`);
}

// --- manifest + size -------------------------------------------------------
// lstat, NOT stat: the icon themes are copied with their alias SYMLINKS intact, and
// following them counted every alias at its target's full size — the arm64
// --windowing manifest reported 19.4 MiB of runtime data for a share/ tree `du -sh`
// measured as part of a 37 MiB bundle. A size the manifest reports must be the size
// on disk.
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
