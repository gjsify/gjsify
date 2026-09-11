// SPDX-License-Identifier: MIT
// Shared by BOTH batteries-included GTK-runtime builders: a shipped typelib must carry the
// ENTRY POINTS the bundle's consumers call, not merely a namespace of the right name.
//
// WHY THIS EXISTS. `typelib-backers.mjs` proves a typelib has its backing library, and
// `bundle-data.mjs` proves a declared data set is in the bundle. Between them sits a hole
// neither can see: a typelib that is present, backed and self-consistent, and MISSING a
// constructor its consumers call. Measured on the published 0.50.0 tarballs, one symbol at a
// time out of each bundle's own `Adw-1.typelib`:
//
//   symbol                                      win32-x64   darwin-arm64   darwin-x64
//   adw_about_dialog_new                        PRESENT     PRESENT        PRESENT
//   adw_about_dialog_new_from_appdata           absent      PRESENT        PRESENT
//   adw_about_dialog_get_appdata_resource_path  absent      PRESENT        PRESENT
//
// AND IT IS NOT ONLY A BYTE SCAN. The darwin row was afterwards CALLED, in the shipped `.app` on
// macOS 15.7.9 with the GTK closure from the bundle itself: `new_from_appdata` resolved, ran, and
// failed where it should — on a deliberately invalid resource path (`Adwaita-ERROR: Could not
// parse metadata file: The resource at "/nonexistent" does not exist`). A constructor that gets
// as far as parsing is present in every sense this gate cares about.
//
// On Windows 11 that reads as `Adw.AboutDialog.new_from_appdata -> THREW: no static method`,
// and an application whose About dialog is built from its own AppStream metainfo simply does
// not open. Nine other named constructors in the same run worked, so it is not a marshalling
// gap: the function is not in the bundle. Every existing gate stayed green over it — the
// namespace is there, the DLL behind it is there, every declared data set is there.
//
// THE CAUSE IS UPSTREAM AND IT IS DELIBERATE. gvsbuild's libadwaita project applies
// `patches/libadwaita/0001-remove-appstream-dependency.patch`, which wraps every `*_from_appdata`
// entry point and `adw_about_dialog_get_appdata_resource_path` in `#ifndef G_OS_WIN32` and makes
// `appstream_dep` conditional on `target_system != 'windows'`. libadwaita 1.9.3 — the version both
// gvsbuild and Homebrew build — still parses AppStream metadata through the heavyweight
// `appstream` library; the small `ministream` replacement landed in 1.10.alpha, and gvsbuild
// carries a `ministream` project waiting for it. So on Windows the functions are not built, and
// Homebrew, which `depends_on "appstream"`, has them — which is exactly the asymmetry the table
// above measures.
//
// WHAT THIS MODULE THEREFORE DOES. It does not "find" the missing symbol; nothing in this
// repository can compile it. It makes the hole IMPOSSIBLE TO SHIP UNANNOUNCED: every symbol in
// the floor below must either be in the shipped typelib or be covered by a DECLARED gap that
// names its upstream cause, and a gap whose cause has expired fails too. A bundle can be
// incomplete. It cannot be quietly incomplete.
//
// Pure + platform-agnostic (no child_process, no otool/dumpbin), so it is unit-tested on Linux
// against the host's own typelib corpus and against synthetic pools:
// packages/node-gi/node-gi/test/gtk-runtime-bundle-gates.test.mjs.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { readTypelibDir } from './typelib-backers.mjs';
import { matchLibrary, normalizeProject } from './gvsbuild-catalogue.mjs';

/**
 * The C entry points a shipped typelib must expose, keyed to the NAMESPACE whose presence
 * makes them required — the same derivation `WINDOWING_DATA_SETS` uses, so a floor entry
 * cannot be required of a bundle that does not ship the namespace, and cannot be dodged by a
 * bundle that does (`WINDOWING_REQUIRED_NAMESPACES` forces Adw).
 *
 * ONLY SYMBOLS WHOSE ABSENCE IS SILENT BELONG HERE, and "silent" is the whole bar: a missing
 * GI function is not a link error, not a warning and not a startup failure. It is a namespace
 * that loads, a class that resolves, and one `TypeError: no static method` at the moment a
 * user clicks something. A symbol whose absence already fails loudly needs no entry.
 *
 * THE FLOOR IS NOT AN API INVENTORY. Two entries is the right size: this is a ratchet against
 * a known class of upstream build divergence, not a re-implementation of ABI checking. Add an
 * entry when a divergence is MEASURED between the platforms this repository ships, the way the
 * two below were.
 */
export const TYPELIB_API_FLOOR = [
    {
        namespace: 'Adw',
        symbol: 'adw_about_dialog_new_from_appdata',
        what: 'Adw.AboutDialog.new_from_appdata()',
        why:
            "the only constructor that builds an About dialog from the application's own AppStream " +
            'metainfo resource; without it a GNOME application has to restate its name, summary, ' +
            'licence, developer and release notes in code, and the ordinary call site throws ' +
            '"no static method" at the moment the user opens the dialog',
    },
    {
        namespace: 'Adw',
        symbol: 'adw_about_dialog_get_appdata_resource_path',
        what: 'Adw.AboutDialog.get_appdata_resource_path()',
        why: 'the reader half of the same property — a dialog constructed from appdata cannot say what it was built from without it',
    },
];

/**
 * A floor symbol this bundle is KNOWN not to carry, with the upstream fact that makes it so.
 *
 * A gap is a declaration, not an exemption: it turns a silent hole into a recorded one
 * (`manifest.typelibApi.gaps`, which a consumer holding only the tarball can read) and it
 * carries its own expiry. `upstream` is the same shape `gjsify.mediaCapabilities` uses for
 * the MP3/FLAC gaps — `catalogue` names the build system, and here `project` + `patch` name
 * the recipe and the patch file that removes the symbol. {@link gapUpstreamProblems} holds
 * that against the committed gvsbuild snapshot, so the day upstream drops the patch the gap
 * fails and names the symbol to close.
 *
 * PLATFORM, NOT PACKAGE. A gap is a property of the toolchain that produced the bytes, and
 * both darwin bundles are produced by the same Homebrew formula; keying on `process.platform`
 * is what makes a darwin regression (a formula that stopped depending on appstream) fail
 * instead of quietly inheriting Windows's excuse.
 */
export const TYPELIB_API_GAPS = [
    {
        platform: 'win32',
        namespace: 'Adw',
        symbols: ['adw_about_dialog_new_from_appdata', 'adw_about_dialog_get_appdata_resource_path'],
        why:
            'gvsbuild builds libadwaita with patches/libadwaita/0001-remove-appstream-dependency.patch, which wraps ' +
            'every *_from_appdata entry point in #ifndef G_OS_WIN32 and makes appstream_dep conditional on ' +
            "target_system != 'windows'. libadwaita 1.9.3 parses AppStream metadata through the appstream library, " +
            'for which gvsbuild defines no project; the small ministream replacement landed in libadwaita 1.10.alpha ' +
            'and gvsbuild already carries a ministream project. Closing this means a libadwaita >= 1.10 built against ' +
            'ministream in the Windows prefix, or gvsbuild dropping the patch — not a change in this repository.',
        upstream: { catalogue: 'gvsbuild', project: 'libadwaita', patch: '0001-remove-appstream-dependency.patch' },
    },
];

// A GI typelib's string pool is a run of NUL-terminated byte strings, and a C entry point is
// recorded there verbatim (`Header.shared_library`, function `symbol` fields and every name
// point into it). These are the bytes a symbol name may consist of; anything else ENDS a
// candidate, so a longer string that merely contains a symbol name can never be mistaken for
// it — which matters here because `adw_about_dialog_new` is a prefix of
// `adw_about_dialog_new_from_appdata` and a substring search would report the missing one as
// present in every bundle that has the other.
const SYMBOL_BYTE = (b) =>
    (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a) || b === 0x5f;

/**
 * Every NUL-terminated identifier in a typelib's byte image.
 *
 * A SUPERSET of the symbol table and deliberately so: this reads the file rather than walking
 * girepository's directory entries, so it cannot go stale when a typelib major version moves
 * an offset — the failure mode of an offset walk is a silent empty result, which would answer
 * "missing" for every symbol and turn the floor below into noise. A superset can only answer
 * PRESENT for something the file genuinely contains, and the floor asks exactly that question.
 *
 * Measured on the three published 0.50.0 bundles: 3369 identifiers in the win32 `Adw-1.typelib`,
 * 3363 in each darwin one — the win32 pool is the LARGER of the two and still lacks the two
 * symbols, which is why a size or count comparison could never have found this.
 *
 * @param {string} file absolute path to a .typelib
 * @returns {Set<string>}
 */
export function readTypelibSymbolPool(file) {
    const buf = readFileSync(file);
    const pool = new Set();
    let start = -1;
    for (let i = 0; i < buf.length; i++) {
        if (SYMBOL_BYTE(buf[i])) {
            if (start < 0) start = i;
            continue;
        }
        // Only a NUL closes a candidate. Any other byte means the run was not a pool string.
        if (start >= 0 && buf[i] === 0) pool.add(buf.toString('latin1', start, i));
        start = -1;
    }
    return pool;
}

/** The gaps that apply to one platform, in declaration order. */
export function gapsForPlatform(platform, gaps = TYPELIB_API_GAPS) {
    return gaps.filter((gap) => gap.platform === platform);
}

/**
 * Hold a finished bundle's typelibs against {@link TYPELIB_API_FLOOR}.
 *
 * Reads the bundle back OFF DISK, like `verifyBundleTypelibs` and `verifyWindowingData`: this
 * gates the bytes that ship, not the intent that produced them.
 *
 * @param {object} opts
 * @param {string} opts.typelibDir the finished bundle's `girepository-1.0`
 * @param {string} opts.platform `process.platform` of the bundle being built
 * @param {typeof TYPELIB_API_FLOOR} [opts.floor]
 * @param {typeof TYPELIB_API_GAPS} [opts.gaps]
 * @returns {{ checked: number, present: string[], missing: object[], declared: object[],
 *   skipped: object[], problems: string[] }}
 */
export function verifyTypelibApiFloor({ typelibDir, platform, floor = TYPELIB_API_FLOOR, gaps = TYPELIB_API_GAPS }) {
    const typelibs = readTypelibDir(typelibDir);
    const byNamespace = new Map(typelibs.map((meta) => [meta.namespace, meta]));
    const excused = new Map();
    for (const gap of gapsForPlatform(platform, gaps)) {
        for (const symbol of gap.symbols) excused.set(`${gap.namespace}:${symbol}`, gap);
    }

    const pools = new Map();
    const present = [];
    const missing = [];
    const declared = [];
    const skipped = [];
    for (const entry of floor) {
        const meta = byNamespace.get(entry.namespace);
        if (meta === undefined) {
            // The namespace is not in this bundle, so the floor has no subject — the same
            // derivation `verifyWindowingData` makes, and for the same reason: a bundle
            // cannot be required to carry an entry point of a namespace it does not ship.
            skipped.push({ ...entry, reason: `the bundle ships no ${entry.namespace} typelib` });
            continue;
        }
        if (!pools.has(meta.file)) pools.set(meta.file, readTypelibSymbolPool(meta.file));
        const has = pools.get(meta.file).has(entry.symbol);
        const gap = excused.get(`${entry.namespace}:${entry.symbol}`);
        if (has) {
            present.push(entry.symbol);
            if (gap !== undefined) {
                // A gap that is no longer a gap. Fatal in the same direction as everything
                // else here: the declaration is the thing a consumer reads, and one that
                // understates the bundle is as wrong as one that overstates it — and it is
                // the only moment anybody will notice that upstream fixed this.
                declared.push({ ...entry, gap, resolved: true });
            }
            continue;
        }
        if (gap !== undefined) {
            declared.push({ ...entry, gap, resolved: false });
            continue;
        }
        missing.push({ ...entry, typelib: basename(meta.file) });
    }

    const problems = [];
    for (const entry of missing) {
        problems.push(
            `${entry.typelib} ships the ${entry.namespace} namespace WITHOUT ${entry.symbol} ` +
                `(${entry.what}) — ${entry.why}`,
        );
    }
    for (const entry of declared.filter((d) => d.resolved)) {
        problems.push(
            `${entry.symbol} is DECLARED as a ${entry.gap.platform} gap and this bundle HAS it. ` +
                `The gap's reason was: ${entry.gap.why} That reason has expired — delete the symbol from ` +
                'TYPELIB_API_GAPS in packages/node-gi/scripts/typelib-symbols.mjs (and the whole entry if it ' +
                'was its last symbol), so the floor holds it from now on.',
        );
    }
    return {
        checked: present.length + missing.length + declared.length,
        present,
        missing,
        declared,
        skipped,
        problems,
    };
}

/**
 * The gap record that goes into `manifest.typelibApi`, so a consumer holding only the tarball
 * can see WHICH entry points this bundle does not carry and why.
 *
 * `resolved` gaps are excluded: they are a build failure above, so they never reach a manifest.
 * @param {ReturnType<typeof verifyTypelibApiFloor>} result
 */
export function typelibApiRecord(result) {
    const gaps = [];
    const seen = new Set();
    for (const entry of result.declared) {
        if (entry.resolved || seen.has(entry.gap)) continue;
        seen.add(entry.gap);
        gaps.push({
            namespace: entry.gap.namespace,
            symbols: [...entry.gap.symbols],
            why: entry.gap.why,
            upstream: { ...entry.gap.upstream },
        });
    }
    return {
        checked: result.checked,
        present: [...result.present].sort(),
        gaps,
        skipped: result.skipped.map((entry) => ({ namespace: entry.namespace, symbol: entry.symbol })),
    };
}

/**
 * Hold every declared gap's upstream reason against the committed gvsbuild snapshot.
 *
 * THE EXPIRY, and the reason it is a check rather than a comment. `GVSBUILD_VERSION` is a pin;
 * a newer gvsbuild exists at every moment; and the sentence "gvsbuild patches this symbol out"
 * stops being true the day upstream deletes the patch file — at which point every other gate in
 * this repository stays green over a gap that could have been closed. That is the
 * `gvsbuild-catalogue` rule's own subject (ADR 0056 § 6) with the cause moved one step: there a
 * REASON is "upstream defines no project", here it is "upstream applies this patch". Both are
 * facts about a pinned release, and both are read out of the same snapshot.
 *
 * @param {object} opts
 * @param {{version: string, modules: string[], patches?: Record<string, string[]>}} opts.catalogue
 * @param {typeof TYPELIB_API_GAPS} [opts.gaps]
 * @returns {{problems: string[], checked: number}}
 */
export function gapUpstreamProblems({ catalogue, gaps = TYPELIB_API_GAPS }) {
    const problems = [];
    let checked = 0;
    for (const gap of gaps) {
        const { catalogue: named, project, patch } = gap.upstream ?? {};
        if (named !== 'gvsbuild') continue;
        checked++;
        const label = `${gap.platform}/${gap.namespace} gap (${gap.symbols.join(', ')})`;

        // The project has to exist, or the gap blames a recipe that is not there.
        if (matchLibrary(catalogue.modules, project).length === 0) {
            problems.push(
                `${label}: its reason names gvsbuild's \`${project}\` project, and gvsbuild ${catalogue.version} ` +
                    `defines no project module matching it (${catalogue.modules.length} read). Either the project ` +
                    'was renamed upstream — re-read the snapshot with ' +
                    '`node packages/node-gi/scripts/gvsbuild-catalogue.mjs --update` — or this gap now blames ' +
                    'nothing and the symbol has to be measured again.',
            );
            continue;
        }

        const applied = catalogue.patches?.[normalizeProject(project)];
        if (applied === undefined) {
            problems.push(
                `${label}: the committed gvsbuild snapshot records no patch list for \`${project}\`, so its ` +
                    'upstream reason was compared to nothing. Re-read it with ' +
                    '`node packages/node-gi/scripts/gvsbuild-catalogue.mjs --update`, which fetches the patch ' +
                    'directory of every project a gap names.',
            );
            continue;
        }
        if (applied.includes(patch)) continue;
        problems.push(
            `${label}: its reason is that gvsbuild applies \`${patch}\` to \`${project}\`, and gvsbuild ` +
                `${catalogue.version} applies ${applied.length ? applied.join(', ') : 'no patch at all'}. The ` +
                'symbols may be buildable now: bump the prefix, rebuild the bundle, and delete this entry from ' +
                'TYPELIB_API_GAPS — the floor check will then say whether the bundle really carries them.',
        );
    }
    return { problems, checked };
}

/** One shared operator message for both builders, so the remedy is written once. */
export function formatTypelibApiProblems(problems, { stage, typelibDir }) {
    return (
        `TYPELIB API FLOOR FAILED (${stage}) — ${problems.length} problem(s):\n  ${problems.join('\n  ')}\n` +
        `Every entry point in TYPELIB_API_FLOOR must be in the matching typelib under ${typelibDir}, or be ` +
        'covered by a TYPELIB_API_GAPS entry that names the upstream fact removing it ' +
        '(packages/node-gi/scripts/typelib-symbols.mjs). A missing GI function is not a link error and not a ' +
        'warning: the namespace loads, the class resolves, and the call throws "no static method" in front of a ' +
        'user. Repairs, in order of preference: build the prefix so the function exists (a newer formula, a ' +
        'dependency the recipe skipped); or — only when upstream genuinely cannot produce it — DECLARE the gap, ' +
        'so the bundle states what it does not carry instead of implying that it does. Do NOT relax this check ' +
        'and do NOT delete a floor entry to make a build pass.'
    );
}
