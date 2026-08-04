// SPDX-License-Identifier: MIT
// Shared by BOTH batteries-included GTK-runtime builders (build-gtk-runtime-darwin.mjs
// and gtk-runtime-win32-x64/scripts/build-gtk-runtime.mjs): decide which typelibs a
// bundle may ship, then PROVE the shipped set is self-contained.
//
// THE DEFECT THIS EXISTS FOR — measured on the PUBLISHED 0.27.1 tarballs, not the
// repo: @gjsify/gtk-runtime-darwin-x64 ships `Adw-1.typelib` and NO
// `libadwaita-1.0.dylib`; @gjsify/gtk-runtime-win32-x64 ships `GtkSource-5.typelib`
// and no gtksourceview DLL. GObject-Introspection resolves a namespace's symbols
// with `g_module_open(<shared_library leaf>)`, so such a namespace RESOLVES (the
// typelib is found, the classes are advertised) and then dies in the constructor
// with "Failed to load shared library '…'" — the type is not a constructible
// GObject. A typelib without its backer is WORSE than an absent one: absence is a
// clean "namespace unavailable", presence is a lie that only fails at runtime.
//
// THE MAPPING IS READ FROM THE TYPELIB, NEVER FROM A TABLE. Every `.typelib` starts
// with girepository's fixed `Header` struct, whose `shared_library` field holds the
// exact string GI will hand to `g_module_open` — comma-separated when a namespace
// has several backers (`GLib-2.0` names libgobject AND libglib) and ABSENT for the
// header-only namespaces that have no library at all (xlib, freetype2, Vulkan,
// DBus, fontconfig, …). A hand-written leaf table would be a second truth that
// drifts per platform anyway: brew records `libadwaita-1.0.dylib`, gvsbuild records
// `adwaita-1-0.dll`, Linux records `libadwaita-1.so.0`.
//
// AND THE DROP DECISION IS DEPENDENCY-AWARE, because the naive filter REGRESSES the
// bundle. Measured on the same tarballs: `Pango-1.0` DEPENDS on `HarfBuzz-0.0`, and
// on darwin HarfBuzz-0.0's backer (`libharfbuzz-gobject.0.dylib`) is not bundled
// while on win32 it is (the win32 seed `^harfbuzz.*\.dll$` happens to match
// `harfbuzz-gobject.dll`). `gi_repository_require` loads a typelib's DEPENDENCIES
// first, so dropping an unbacked typelib that a KEPT typelib names would turn one
// half-broken namespace into a broken Pango — and with it Gdk, Gsk and Gtk. So an
// unbacked typelib that something kept depends on is a HARD FAILURE naming the
// missing library (the repair is a seed pattern, not a drop), never a silent drop.
//
// Everything here is pure + platform-agnostic (no child_process, no otool/dumpbin)
// so it is unit-tested on Linux against a synthetic header AND the host's own
// typelib corpus: packages/node-gi/node-gi/test/gtk-runtime-bundle-gates.test.mjs.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

// girepository `Header` (gitypelib-internal.h) — byte offsets of the four fields we
// read. The fields ahead of them are all fixed-width, so these offsets hold for
// every typelib major version girepository has shipped; the test asserts them
// against real typelibs rather than trusting this comment.
const MAGIC = Buffer.from('GOBJ\nMETADATA\r\n\u001a', 'latin1'); // 16 bytes
const OFF_MAJOR = 16;
const OFF_DEPENDENCIES = 36; // u32 string offset — 'Ns-Ver|Ns-Ver|…'
const OFF_NAMESPACE = 44; // u32 string offset
const OFF_NSVERSION = 48; // u32 string offset
const OFF_SHARED_LIBRARY = 52; // u32 string offset — 'libfoo.so.0,libbar.so.0'
const HEADER_MIN_BYTES = 56; // through the shared_library field

const NAMESPACE_RE = /^[A-Za-z_][A-Za-z0-9_+-]*$/;
const VERSION_RE = /^\d+(\.\d+)*$/;

/**
 * The namespaces a bundle EXISTS to provide, so a filter that silently removed
 * everything cannot pass. Not a typelib→library mapping (that is derived) but the
 * bundle's own contract, taken from what the two packages' descriptions promise
 * ("GLib/GObject/Gio/cairo/Pango/Graphene/Gdk") plus the namespaces node-gi's
 * batteries-included probe resolves (scripts/check-batteries.mjs: Gio subclassing +
 * Pango/Graphene/Gdk `get_type`). Versionless on purpose — the GTK major is the
 * builders' business, not this gate's.
 */
export const REQUIRED_NAMESPACES = [
    'GLib',
    'GObject',
    'Gio',
    'GModule',
    'cairo',
    'Pango',
    'PangoCairo',
    'Graphene',
    'GdkPixbuf',
    'Gdk',
    'Gsk',
    'Gtk',
];

/**
 * What `--windowing` is FOR: libadwaita + GtkSourceView. Asserting the typelibs
 * here (and not only the dylibs, which the workflows grep for) is what makes the
 * superset's promise checkable — with the drop filter in place, a missing
 * libadwaita would otherwise take `Adw-1.typelib` out of the bundle quietly and
 * leave a green build that ships no Adwaita at all.
 */
export const WINDOWING_REQUIRED_NAMESPACES = ['Adw', 'GtkSource'];

function splitList(value, separator) {
    if (!value) return [];
    return value
        .split(separator)
        .map((part) => part.trim())
        .filter(Boolean);
}

/**
 * Read the header fields of one `.typelib`.
 *
 * A mis-parse MUST NOT be able to look like "header-only, no backer needed" — that
 * silent pass is the whole class this module exists to close — so the namespace and
 * version are validated and anything unexpected throws instead of degrading.
 * @param {string} file absolute path to a .typelib
 * @returns {{ file: string, name: string, namespace: string, version: string, key: string,
 *   sharedLibraries: string[], dependencies: string[], major: number }}
 */
export function readTypelibMetadata(file) {
    const buf = readFileSync(file);
    if (buf.length < HEADER_MIN_BYTES || !buf.subarray(0, MAGIC.length).equals(MAGIC)) {
        throw new Error(`${basename(file)}: not a GObject-Introspection typelib (bad magic or truncated header)`);
    }
    const str = (offset) => {
        if (offset === 0 || offset >= buf.length) return null;
        const end = buf.indexOf(0, offset);
        return buf.subarray(offset, end < 0 ? buf.length : end).toString('utf8');
    };
    const major = buf.readUInt8(OFF_MAJOR);
    const namespace = str(buf.readUInt32LE(OFF_NAMESPACE));
    const version = str(buf.readUInt32LE(OFF_NSVERSION));
    if (!namespace || !NAMESPACE_RE.test(namespace) || !version || !VERSION_RE.test(version)) {
        throw new Error(
            `${basename(file)}: header parse yielded namespace=${JSON.stringify(namespace)} ` +
                `version=${JSON.stringify(version)} (typelib major ${major}) — refusing to guess. ` +
                'Either the file is not a typelib or girepository moved the Header fields; fix the offsets ' +
                'in typelib-backers.mjs, do NOT treat an unreadable header as "no backing library needed".',
        );
    }
    return {
        file,
        name: basename(file),
        namespace,
        version,
        key: `${namespace}-${version}`,
        sharedLibraries: splitList(str(buf.readUInt32LE(OFF_SHARED_LIBRARY)), ','),
        dependencies: splitList(str(buf.readUInt32LE(OFF_DEPENDENCIES)), '|'),
        major,
    };
}

/**
 * Read every `.typelib` in a directory (sorted, so logs and manifests are stable).
 * @param {string} dir
 * @returns {ReturnType<typeof readTypelibMetadata>[]}
 */
export function readTypelibDir(dir) {
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
        .filter((f) => f.endsWith('.typelib'))
        .sort()
        .map((f) => readTypelibMetadata(join(dir, f)));
}

/**
 * Index the loadable-native-code dir the way the PLATFORM resolves it: Windows
 * `LoadLibrary` is case-insensitive, dyld's `g_module_open` of a bare leaf is not.
 * @param {string} dir the bundle's `bin/` (win32) or `lib/` (darwin)
 * @param {{ caseInsensitive: boolean }} opts
 * @returns {Set<string>} comparison keys
 */
export function nativeLibraryIndex(dir, { caseInsensitive }) {
    if (!existsSync(dir)) return new Set();
    return new Set(readdirSync(dir).map((f) => (caseInsensitive ? f.toLowerCase() : f)));
}

/**
 * Partition typelibs against the libraries actually present, and check the two
 * closure properties that make a bundle self-contained.
 * @param {{ typelibs: ReturnType<typeof readTypelibMetadata>[], libraries: Set<string>,
 *   caseInsensitive: boolean, requiredNamespaces: string[] }} opts
 * @returns {{ backed: object[], headerOnly: object[], unbacked: object[],
 *   missingDependencies: {from: string, dependency: string}[], missingRequired: string[] }}
 */
export function analyzeTypelibs({ typelibs, libraries, caseInsensitive, requiredNamespaces = [] }) {
    const key = (leaf) => (caseInsensitive ? leaf.toLowerCase() : leaf);
    const backed = [];
    const headerOnly = [];
    const unbacked = [];
    for (const t of typelibs) {
        if (t.sharedLibraries.length === 0) {
            headerOnly.push(t);
            continue;
        }
        const missing = t.sharedLibraries.filter((lib) => !libraries.has(key(lib)));
        if (missing.length > 0) unbacked.push({ ...t, missing });
        else backed.push(t);
    }
    const available = new Set(typelibs.map((t) => t.key));
    const shipped = new Set([...backed, ...headerOnly].map((t) => t.key));
    const missingDependencies = [];
    for (const t of [...backed, ...headerOnly]) {
        for (const dep of t.dependencies) {
            // A dependency that exists in the SOURCE set but is unbacked is reported
            // as `blocked` by planTypelibSet (its repair is a seed); one that exists
            // nowhere is a broken source prefix.
            if (!shipped.has(dep) && !available.has(dep)) missingDependencies.push({ from: t.key, dependency: dep });
        }
    }
    const present = new Set([...backed, ...headerOnly].map((t) => t.namespace));
    const missingRequired = requiredNamespaces.filter((ns) => !present.has(ns));
    return { backed, headerOnly, unbacked, missingDependencies, missingRequired };
}

/**
 * Decide which of the SOURCE prefix's typelibs the bundle may ship.
 *
 * An unbacked typelib is dropped — unless a typelib we DO ship depends on it, in
 * which case dropping it would break that namespace's `gi_repository_require` and
 * the only correct repair is to bundle the missing library. Those land in
 * `blocked` and the caller must fail the build.
 * @param {{ typelibs: object[], libraries: Set<string>, caseInsensitive: boolean,
 *   requiredNamespaces?: string[] }} opts
 * @returns {{ copy: object[], dropped: object[], blocked: object[], backed: object[],
 *   headerOnly: object[], missingDependencies: object[], missingRequired: string[],
 *   problems: string[] }}
 */
export function planTypelibSet({ typelibs, libraries, caseInsensitive, requiredNamespaces = [] }) {
    const analysis = analyzeTypelibs({ typelibs, libraries, caseInsensitive, requiredNamespaces });
    const { backed, headerOnly, unbacked } = analysis;
    const unbackedByKey = new Map(unbacked.map((t) => [t.key, t]));

    // Fixpoint: a blocked typelib is itself shipped-by-necessity, so ITS unbacked
    // dependencies are required too and belong in the same error report.
    const blockedKeys = new Set();
    let changed = true;
    while (changed) {
        changed = false;
        for (const t of [...backed, ...headerOnly, ...[...blockedKeys].map((k) => unbackedByKey.get(k))]) {
            for (const dep of t.dependencies) {
                if (unbackedByKey.has(dep) && !blockedKeys.has(dep)) {
                    blockedKeys.add(dep);
                    changed = true;
                }
            }
        }
    }
    const blocked = unbacked.filter((t) => blockedKeys.has(t.key));
    const dropped = unbacked.filter((t) => !blockedKeys.has(t.key));

    const problems = [];
    for (const t of blocked) {
        const needers = [...backed, ...headerOnly, ...blocked]
            .filter((o) => o.dependencies.includes(t.key))
            .map((o) => o.key);
        problems.push(
            `${t.name} (${t.key}) has no backing library in the bundle (missing ${t.missing.join(', ')}) ` +
                `and CANNOT be dropped — ${needers.join(', ')} depend${needers.length === 1 ? 's' : ''} on it`,
        );
    }
    for (const { from, dependency } of analysis.missingDependencies) {
        problems.push(`${from} depends on ${dependency}, which the source prefix does not provide at all`);
    }
    for (const ns of analysis.missingRequired) {
        problems.push(`required namespace ${ns} is not shippable — no typelib for it survived the backer check`);
    }
    return { ...analysis, copy: [...backed, ...headerOnly], dropped, blocked, problems };
}

/**
 * Re-derive the symmetry check from the FINISHED bundle on disk — both the typelib
 * set and the library set are read back from the output dirs, so this gates the
 * bytes that ship rather than the intent that produced them.
 * @param {{ typelibDir: string, nativeDir: string, caseInsensitive: boolean,
 *   requiredNamespaces?: string[] }} opts
 * @returns {{ backed: object[], headerOnly: object[], unbacked: object[], problems: string[] }}
 */
export function verifyBundleTypelibs({ typelibDir, nativeDir, caseInsensitive, requiredNamespaces = [] }) {
    const typelibs = readTypelibDir(typelibDir);
    const libraries = nativeLibraryIndex(nativeDir, { caseInsensitive });
    const analysis = analyzeTypelibs({ typelibs, libraries, caseInsensitive, requiredNamespaces });
    const problems = [];
    for (const t of analysis.unbacked) {
        problems.push(`${t.name} (${t.key}) names ${t.sharedLibraries.join(', ')} — MISSING ${t.missing.join(', ')}`);
    }
    for (const { from, dependency } of analysis.missingDependencies) {
        problems.push(`${from} depends on ${dependency}, which the bundle does not ship`);
    }
    for (const ns of analysis.missingRequired) {
        problems.push(`required namespace ${ns} is absent from the bundle`);
    }
    // Positive fact, not merely "no violations found": a bundle whose typelib dir is
    // empty (or whose parse produced nothing) would otherwise satisfy every check
    // above vacuously — the exact shape of failure this module was written for.
    if (analysis.backed.length === 0) {
        problems.push(`no library-backed typelib in ${typelibDir} — nothing was actually verified`);
    }
    return { ...analysis, problems };
}

/**
 * One shared operator message for both builders, so the remedy is written once.
 * @param {string[]} problems
 * @param {{ stage: string, nativeDirLabel: string }} opts
 * @returns {string}
 */
export function formatTypelibProblems(problems, { stage, nativeDirLabel }) {
    return (
        `TYPELIB/LIBRARY SYMMETRY FAILED (${stage}) — ${problems.length} problem(s):\n  ${problems.join('\n  ')}\n` +
        `Every typelib the bundle ships must have its backing library in ${nativeDirLabel} of the SAME bundle, ` +
        'and every namespace a shipped typelib depends on must be shipped too. Repairs, in order of preference: ' +
        "add the missing library to this builder's SEED_PATTERNS (or WINDOWING_SEED_PATTERNS) so the closure walk " +
        'picks it up; install the formula/package that provides it into the build prefix; or — only when the ' +
        'namespace is genuinely out of scope and nothing shipped depends on it — let the plan drop its typelib. ' +
        'Do NOT relax this check: a typelib whose library is absent advertises constructible types that fail with ' +
        '"Failed to load shared library" at first use.'
    );
}
