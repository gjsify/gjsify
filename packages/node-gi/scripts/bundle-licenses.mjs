// SPDX-License-Identifier: MIT
// Shared by BOTH batteries-included GTK-runtime builders: ship the license terms of
// the third-party binaries the bundle carries, and a notice that says what was done
// to them.
//
// THE DEFECT THIS EXISTS FOR — measured on the PUBLISHED 0.27.1 tarballs: each
// @gjsify/gtk-runtime-* tarball carries 37–45 relocated LGPL/MPL/GPL libraries
// (GTK, GLib, Pango, cairo, freetype, fontconfig, harfbuzz, …) and contains NO
// license file of any kind — not even the MIT text for its own three source files.
// On darwin the binaries are additionally MODIFIED: `install_name_tool` rewrites
// every install name to `@loader_path` and each dylib is ad-hoc re-signed, which is
// exactly the "modified copy" case the LGPL asks to be stated.
//
// THE SET IS DERIVED FROM WHAT IS BUNDLED, never hand-listed, because a hand-listed
// set drifts the moment a seed pattern or a transitive dependency changes — and a
// stale license list is worse than none: it makes a false claim. Two derivations,
// one per source prefix, because the prefixes differ in what they can prove:
//
//   • darwin/Homebrew — every bundled dylib RESOLVES into `…/Cellar/<formula>/<version>/`,
//     so attribution is exact and per-binary. The license terms come from the keg's
//     own `.brew/<formula>.rb` (Homebrew stores the formula inside the keg), i.e.
//     from the build prefix, not from a table here. Any bundled dylib that does not
//     resolve into a keg is UNATTRIBUTED and fails the build.
//   • win32/gvsbuild — the prefix is one flat `bin/`, so per-DLL attribution is NOT
//     recoverable (measured: the VERSIONINFO resource is present in glib/gtk/zlib
//     and absent in adwaita/harfbuzz/libpng, so it cannot carry the mapping either).
//     What IS recoverable is the license corpus the prefix ships:
//     `share/doc/<project>/COPYING|LICENSE` + `share/licenses/<project>/*` — 36 files
//     in GTK4_Gvsbuild_2026.6.0_x64. So the notice includes the whole corpus and
//     says plainly that the mapping is not recoverable, which is over-inclusive
//     rather than silent.
//
// Everything here is pure (no child_process): the darwin `brew info` fallback is
// injected by the caller, so this module is unit-testable on Linux —
// packages/node-gi/node-gi/test/gtk-runtime-bundle-gates.test.mjs.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';

/**
 * Filenames that carry license terms — anchored, so `LICENSE.md`, `COPYING.LIB` and
 * `COPYING_LGPL` match while `licensing-notes.txt` does not. `AUTHORS` is included on
 * purpose: several of these projects keep the copyright holders there, and a permissive
 * license that requires reproducing the copyright notice is only satisfied with it.
 */
const LICENSE_FILE_RE = /^(COPYING|COPYRIGHT|LICEN[CS]E|NOTICE|AUTHORS)([-._][\w.+-]*)?$/i;

/** A single license text is a page or two; 512 KiB rules out a doc tree mistaken for one. */
const MAX_TEXT_BYTES = 512 * 1024;

/**
 * Find license texts under `root`, restricted to the given subdirectories and a
 * shallow depth — deep enough for `share/doc/<project>/COPYING`, shallow enough that
 * a bundled HTML manual (`share/doc/tiff/manual/html/project/license.html`) is not
 * mistaken for license terms.
 * @param {{ root: string, subdirs?: string[], maxDepth?: number, maxBytes?: number }} opts
 * @returns {{ absolute: string, relative: string, file: string, component: string, bytes: number }[]}
 */
export function scanLicenseFiles({ root, subdirs = ['.'], maxDepth = 2, maxBytes = MAX_TEXT_BYTES }) {
    const found = [];
    const walk = (dir, depth) => {
        if (depth > maxDepth || !existsSync(dir)) return;
        let entries;
        try {
            entries = readdirSync(dir, { withFileTypes: true });
        } catch {
            return; // unreadable dir in a build prefix is not our failure to own
        }
        for (const entry of entries) {
            const abs = join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(abs, depth + 1);
            } else if (entry.isFile() && LICENSE_FILE_RE.test(entry.name)) {
                const bytes = statSync(abs).size;
                if (bytes === 0 || bytes > maxBytes) continue;
                const rel = relative(root, abs).split(sep).join('/');
                found.push({
                    absolute: abs,
                    relative: rel,
                    file: entry.name,
                    component: basename(dirname(abs)),
                    bytes,
                });
            }
        }
    };
    for (const sub of subdirs) walk(sub === '.' ? root : join(root, sub), 1);
    // Deterministic order → reproducible payload + notice.
    return found.sort((a, b) => a.relative.localeCompare(b.relative));
}

/**
 * Extract Homebrew's `license` stanza from a keg's own formula file. Returns the RAW
 * expression that follows the keyword (bracket-balanced, whitespace-collapsed) rather
 * than a normalised SPDX id:
 * `all_of:`/`any_of:`/`:cannot_represent` are real values and paraphrasing them here
 * would be this module inventing legal metadata.
 * @param {string} formulaRuby contents of `<keg>/.brew/<formula>.rb`
 * @returns {string | null}
 */
export function parseBrewLicenseStanza(formulaRuby) {
    const lines = formulaRuby.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const m = /^\s*license\s+(\S.*)$/.exec(lines[i]);
        if (!m) continue;
        let text = m[1];
        // Continue while brackets are unbalanced (`license all_of: [` … `]`).
        let depth = 0;
        const balance = (s) => {
            for (const ch of s) {
                if (ch === '[' || ch === '{') depth++;
                else if (ch === ']' || ch === '}') depth--;
            }
        };
        balance(text);
        for (let j = i + 1; depth > 0 && j < lines.length && j < i + 40; j++) {
            text += ` ${lines[j].trim()}`;
            balance(lines[j]);
        }
        return text.replaceAll(/\s+/g, ' ').trim();
    }
    return null;
}

/**
 * Attribute every bundled darwin dylib to the Homebrew keg it came from, and read
 * that keg's license terms out of the keg itself.
 * @param {{ files: Map<string, string>, fallbackLicense?: (formula: string) => string | null }} opts
 *   `files` maps the bundled leaf name → the REAL source path (post-realpath), which
 *   for a Homebrew library always runs through `…/Cellar/<formula>/<version>/…`.
 * @returns {{ components: object[], unattributed: {file: string, source: string}[] }}
 */
export function describeBrewKegs({ files, fallbackLicense }) {
    const byKeg = new Map();
    const unattributed = [];
    for (const [leaf, source] of files) {
        const parts = source.split(sep);
        const i = parts.lastIndexOf('Cellar');
        if (i < 0 || parts.length < i + 3) {
            unattributed.push({ file: leaf, source });
            continue;
        }
        const name = parts[i + 1];
        const version = parts[i + 2];
        const root = parts.slice(0, i + 3).join(sep);
        const key = `${name}/${version}`;
        if (!byKeg.has(key)) byKeg.set(key, { name, version, root, binaries: [] });
        byKeg.get(key).binaries.push(leaf);
    }
    const components = [...byKeg.values()]
        .map((keg) => {
            let license = null;
            let homepage = null;
            const formulaFile = join(keg.root, '.brew', `${keg.name}.rb`);
            if (existsSync(formulaFile)) {
                const ruby = readFileSync(formulaFile, 'utf8');
                license = parseBrewLicenseStanza(ruby);
                homepage = /^\s*homepage\s+"([^"]+)"/m.exec(ruby)?.[1] ?? null;
            }
            if (!license && fallbackLicense) license = fallbackLicense(keg.name);
            return {
                ...keg,
                license,
                homepage,
                binaries: keg.binaries.sort(),
                // Keg-local license terms: the keg root itself, plus the two places a
                // build system installs them.
                texts: scanLicenseFiles({ root: keg.root, subdirs: ['.', 'share/licenses', 'share/doc'], maxDepth: 2 }),
            };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    return { components, unattributed };
}

/**
 * Copy the collected texts into the bundle under `<outDir>/<component>/<file>`,
 * de-duplicating identical paths.
 * @param {{ outDir: string, components: object[] }} opts
 * @returns {{ files: string[], bytes: number }}
 */
export function writeLicensePayload({ outDir, components }) {
    const written = new Set();
    let bytes = 0;
    for (const component of components) {
        for (const text of component.texts) {
            const dest = join(outDir, component.name, text.file);
            if (written.has(dest)) continue;
            mkdirSync(dirname(dest), { recursive: true });
            copyFileSync(text.absolute, dest);
            written.add(dest);
            bytes += text.bytes;
        }
    }
    return { files: [...written].sort(), bytes };
}

/**
 * Render the shipped notice. Deterministic (everything sorted) so two builds of the
 * same prefix produce identical bytes.
 * @param {{ target: string, builder: string, provenance: string, windowing: boolean,
 *   modifications: string[], components: object[], binaries: string[],
 *   attribution: 'per-binary' | 'prefix', payloadDir: string }} opts
 * @returns {string}
 */
export function renderThirdPartyNotice({
    target,
    builder,
    provenance,
    windowing,
    modifications,
    components,
    binaries,
    attribution,
    payloadDir,
}) {
    const ownerOf = new Map();
    for (const c of components) for (const b of c.binaries ?? []) ownerOf.set(b, c);
    const withText = components.filter((c) => (c.texts ?? []).length > 0);
    const withoutText = components.filter((c) => (c.texts ?? []).length === 0);

    const lines = [];
    lines.push('# Third-party notices');
    lines.push('');
    lines.push(
        `This directory is a self-contained GTK / GObject-Introspection runtime for **${target}**, ` +
            'assembled from third-party free-software libraries. The npm package around it ' +
            '(`@gjsify/gtk-runtime-*`) is MIT-licensed; **the binaries below are not** — they keep the terms ' +
            'of their own projects, reproduced here.',
    );
    lines.push('');
    lines.push(`- Assembled by: \`${builder}\``);
    lines.push(`- Build prefix (source of every binary): \`${provenance}\``);
    lines.push(
        `- Variant: ${windowing ? '`--windowing` (full runtime incl. GSettings schemas + icon themes)' : 'display-free'}`,
    );
    lines.push(`- License texts recovered from that prefix: \`${payloadDir}/\``);
    lines.push('');
    lines.push('## Modifications to the binaries');
    lines.push('');
    if (modifications.length === 0) {
        lines.push('None. The libraries are byte-identical copies of the build prefix; the bundle is made portable');
        lines.push('by search path alone (the loader prepends this directory before the first `LoadLibrary`).');
    } else {
        lines.push('The copies in this bundle are **modified** relative to the build prefix:');
        lines.push('');
        for (const m of modifications) lines.push(`- ${m}`);
        lines.push('');
        lines.push('No source code was changed; the modifications are link-time metadata so the libraries resolve');
        lines.push('each other from inside the bundle instead of from the build machine.');
    }
    lines.push('');
    lines.push('## Components');
    lines.push('');
    if (attribution === 'prefix') {
        lines.push('Per-binary attribution is **not recoverable** from this build prefix: it is a single flat build');
        lines.push('tree, so the license corpus it ships is reproduced in full below and applies to the bundled');
        lines.push('binaries collectively. Listing every project the prefix documents is deliberate over-inclusion.');
        lines.push('');
    }
    lines.push('| Component | Version | License (as declared by the build prefix) | Texts included |');
    lines.push('|---|---|---|---|');
    for (const c of components) {
        // The same file can be scanned twice (gvsbuild ships adwaita-icon-theme's
        // COPYING_CCBYSA3 under both share/doc and share/licenses); the payload writer
        // dedups by destination, so the table must too or it reports a phantom.
        const files = [...new Set((c.texts ?? []).map((t) => t.file))];
        const texts = files.join(', ') || '—';
        const declared = c.license ?? (files.length > 0 ? '(see included text)' : '(not declared)');
        lines.push(`| ${c.name} | ${c.version ?? '—'} | ${declared} | ${texts} |`);
    }
    lines.push('');
    lines.push(
        `${withText.length} component(s) ship their license text in \`${payloadDir}/\`; ` +
            `${withoutText.length} declare a license without shipping its text in the build prefix — ` +
            'for those the declared identifier above is the authoritative statement of terms, and the ' +
            'corresponding text is obtainable from the project and from spdx.org/licenses.',
    );
    lines.push('');
    lines.push('## Bundled binaries');
    lines.push('');
    for (const b of [...binaries].sort()) {
        const owner = ownerOf.get(b);
        lines.push(`- \`${b}\`${owner ? ` — ${owner.name} ${owner.version ?? ''}`.trimEnd() : ''}`);
    }
    lines.push('');
    return lines.join('\n');
}

/**
 * The compliance gate. Returns operator-readable problems; empty = the notice makes
 * a complete, positive statement about every binary that ships.
 * @param {{ components: object[], binaries: string[], unattributed?: object[],
 *   attribution: 'per-binary' | 'prefix', textCount: number }} opts
 * @returns {string[]}
 */
export function assertLicenseCoverage({ components, binaries, unattributed = [], attribution, textCount }) {
    const problems = [];
    if (components.length === 0) problems.push('no license components were derived from the build prefix at all');
    if (binaries.length === 0) problems.push('no bundled binaries were passed to the license step');
    if (textCount === 0) {
        problems.push(
            'not one license text was recovered from the build prefix — the bundle would ship third-party ' +
                'binaries with no terms attached',
        );
    }
    if (attribution === 'per-binary') {
        for (const u of unattributed) {
            problems.push(`${u.file} cannot be attributed to any component (source ${u.source})`);
        }
        const owned = new Set(components.flatMap((c) => c.binaries ?? []));
        for (const b of binaries) {
            if (!owned.has(b)) problems.push(`${b} is bundled but no component claims it`);
        }
        for (const c of components) {
            if (!c.license && (c.texts ?? []).length === 0) {
                problems.push(`${c.name} ${c.version ?? ''} declares no license and ships no license text`.trim());
            }
        }
    }
    return problems;
}

/**
 * One shared operator message, so the remedy is written once for both builders.
 * @param {string[]} problems
 * @param {{ prefix: string }} opts
 * @returns {string}
 */
export function formatLicenseProblems(problems, { prefix }) {
    return (
        `LICENSE COVERAGE FAILED — ${problems.length} problem(s):\n  ${problems.join('\n  ')}\n` +
        `Every binary this bundle ships must be traceable to a component of the build prefix (${prefix}) whose ` +
        'terms are recorded in THIRD-PARTY-NOTICES.md. Repairs: install the library through the package manager ' +
        'that owns the prefix (so it lands in a keg/documented tree) instead of side-loading it; or add the ' +
        'directory that holds its license text to the scan roots. Do NOT downgrade this to a warning — shipping ' +
        'relocated LGPL binaries with no terms attached is the condition this check exists to prevent.'
    );
}
