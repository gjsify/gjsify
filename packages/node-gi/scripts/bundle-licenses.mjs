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
// "OVER-INCLUSIVE RATHER THAN SILENT" WAS HALF TRUE, AND THE SILENT HALF SHIPPED.
// Measured on this branch's own win32-x64 CI artifact: 65 DLLs in `bin/` plus 25 binaries
// in their own directories, against 45 documented components — over-inclusive on one side
// (cairomm, gtkmm, pycairo, protobuf and six more are documented and not bundled) and
// EMPTY on the other. `glib`, `gobject-introspection`, `freetype`, `graphene`, `libtiff`,
// `libxml2`, `zlib`, `sqlite` and `openssl` back fourteen shipped DLLs — libgio,
// libgobject and libglib among them — and the prefix documents the terms of none of them.
// Nothing caught it because the coverage gate ran its per-binary checks ONLY under
// `per-binary` attribution, so the win32 branch asserted "some texts were recovered" and
// nothing else: a corpus of one file would have passed.
//
// Prefix attribution therefore keeps its honest claim (no per-DLL mapping in the shipped
// notice) but stops being unfalsifiable: WIN32_LICENSE_FAMILIES declares which project
// each bundled leaf belongs to, and `assertLicenseCoverage` now refuses a bundle holding
// a binary whose family the corpus documents no text for — in EITHER attribution mode.
// The table is a name map, never a statement of terms: the terms still come from the
// build prefix, and where the prefix documents none, from a text vendored beside the
// builder with its upstream provenance recorded (see § vendored corpus in the win32
// builder). A family the table does not know fails the build by name, which is the
// opposite of the silent drift a hand-listed license SET would have.
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
 * WHICH PROJECT EACH BUNDLED win32 BINARY BELONGS TO.
 *
 * A NAME MAP, NOT A STATEMENT OF TERMS — that distinction is the whole reason this table
 * is allowed to exist next to a header that forbids hand-listing. It says only "the leaf
 * `intl.dll` comes from the project gvsbuild documents as `gettext`"; what gettext's terms
 * ARE still comes from the build prefix's own `share/doc/gettext/COPYING`. So the table
 * cannot make a false licence claim: the worst it can do is name the wrong project, and
 * then the text that ships is the wrong project's — which is why every entry whose leaf
 * name differs from its project name carries the reason.
 *
 * It does not drift silently either, which a hand-listed licence SET would: the gate
 * walks the binaries the builder ACTUALLY copied, so a DLL this table does not know fails
 * the build by name. A gvsbuild bump that renames a library is then a one-line addition
 * caught at build time instead of a bundle shipped without terms.
 *
 * Ordered — the first matching entry wins, so `girepository-2.0-0.dll` and the
 * `gst*-1.0-*.dll` shared libraries are matched before the looser plugin pattern.
 *
 * @type {{ components: string[], pattern: RegExp, why?: string }[]}
 */
export const WIN32_LICENSE_FAMILIES = [
    // GLib is the one this gate exists for: six of the bundle's DLLs are GLib, it is the
    // LGPL library everything else here links, and the published win32 tarballs have
    // carried it with no terms attached since the first one.
    { components: ['glib'], pattern: /^(glib|gobject|gio|gmodule|gthread)-2\.0-\d+\.dll$/i },
    {
        components: ['glib'],
        pattern: /^girepository-2\.0-\d+\.dll$/i,
        why: 'girepository-2.0 moved INTO glib at 2.80',
    },
    {
        components: ['gobject-introspection'],
        pattern: /^girepository-1\.0-\d+\.dll$/i,
        why:
            'the TWO girepository DLLs are two projects, and one entry for both named the wrong one. ' +
            'glib 2.80 took girepository-2.0 in; gobject-introspection did not stop building the 1.0 ' +
            'library — 1.86.0 girepository/meson.build still declares shared_library(girepository-1.0), ' +
            'and gvsbuild --enable-gi installs it. Both ship, so matching girepository-* as ONE family ' +
            'made the notice name glib as the project behind a gobject-introspection binary',
    },
    { components: ['gtk4'], pattern: /^gtk-4-\d+\.dll$/i },
    { components: ['libadwaita'], pattern: /^adwaita-1-\d+\.dll$/i, why: 'libadwaita builds `adwaita-1-0.dll`' },
    { components: ['gtksourceview5'], pattern: /^gtksourceview-5-\d+\.dll$/i },
    { components: ['gdk-pixbuf'], pattern: /^gdk_pixbuf-2\.0-\d+\.dll$/i },
    { components: ['pango'], pattern: /^pango(cairo|ft2|win32)?-1\.0-\d+\.dll$/i },
    { components: ['cairo'], pattern: /^cairo(-gobject|-script-interpreter)?-\d+\.dll$/i },
    { components: ['harfbuzz'], pattern: /^harfbuzz(-[a-z]+)?\.dll$/i, why: '`harfbuzz-icu.dll` is harfbuzz, not icu' },
    { components: ['graphene'], pattern: /^graphene-1\.0-\d+\.dll$/i },
    { components: ['fontconfig'], pattern: /^fontconfig-\d+\.dll$/i },
    { components: ['freetype'], pattern: /^freetype-\d+\.dll$/i },
    { components: ['fribidi'], pattern: /^fribidi-\d+\.dll$/i },
    { components: ['libepoxy'], pattern: /^epoxy-\d+\.dll$/i, why: 'libepoxy builds `epoxy-0.dll`' },
    { components: ['libffi'], pattern: /^ffi-\d+\.dll$/i, why: 'libffi builds `ffi-8.dll`' },
    { components: ['libpng'], pattern: /^libpng\d+\.dll$/i },
    { components: ['libjpeg-turbo'], pattern: /^jpeg\d+\.dll$/i, why: 'libjpeg-turbo builds `jpeg62.dll`' },
    { components: ['libtiff'], pattern: /^tiff(-\d+)?\.dll$/i, why: 'libtiff builds `tiff.dll`' },
    { components: ['librsvg'], pattern: /^(rsvg-2-\d+|pixbufloader_svg)\.dll$/i },
    {
        components: ['gdk-pixbuf'],
        pattern: /^pixbufloader_[a-z0-9]+\.dll$/i,
        why: 'the other image loaders are gdk-pixbuf`s own',
    },
    { components: ['pixman'], pattern: /^pixman-1-\d+\.dll$/i },
    { components: ['pcre2'], pattern: /^pcre2-\d+-\d+\.dll$/i },
    { components: ['expat'], pattern: /^libexpat\.dll$/i },
    { components: ['zlib'], pattern: /^zlib1\.dll$/i },
    { components: ['gettext'], pattern: /^intl\.dll$/i, why: 'gettext builds libintl as `intl.dll`' },
    { components: ['win-iconv'], pattern: /^iconv\.dll$/i, why: 'gvsbuild uses win-iconv, not GNU libiconv' },
    { components: ['libxml2'], pattern: /^xml2-\d+\.dll$/i, why: 'libxml2 builds `xml2-16.dll`' },
    { components: ['sqlite'], pattern: /^sqlite3\.dll$/i },
    {
        components: ['icu'],
        pattern: /^icu[a-z]{2}\d+\.dll$/i,
        why: 'icudt/icuuc/icuin carry the ICU major in the leaf',
    },
    { components: ['libpsl'], pattern: /^psl-\d+\.dll$/i, why: 'libpsl builds `psl-5.dll`' },
    { components: ['nghttp2'], pattern: /^nghttp2\.dll$/i },
    { components: ['libsoup3'], pattern: /^soup-3\.0-\d+\.dll$/i },
    {
        components: ['openssl'],
        pattern: /^lib(crypto|ssl)-\d+(-x64)?\.dll$/i,
        why: 'the Apache-2.0 payload this branch added; § 4 of that licence requires the text to travel with it',
    },
    {
        components: ['mit-kerberos'],
        pattern: /^(krb5_64|comerr64|gssapi64|k5sprt64)\.dll$/i,
        why: 'MIT Kerberos names its DLLs after the modules, not the project — libsoup3 pulls them in for GSSAPI auth',
    },
    {
        components: ['glib-networking'],
        pattern: /^gio(openssl|gnutls|gnomeproxy|libproxy)\.dll$/i,
        why: 'the GIO modules in lib/gio/modules — the TLS backend and the proxy resolver',
    },
    { components: ['orc'], pattern: /^orc-\d+\.\d+-\d+\.dll$/i },
    { components: ['opus'], pattern: /^opus-\d+\.dll$/i },
    { components: ['ogg'], pattern: /^ogg-\d+\.dll$/i },
    { components: ['gstreamer'], pattern: /^gst(reamer|base|controller|net|check)-1\.0-\d+\.dll$/i },
    {
        components: ['gst-plugins-base'],
        pattern: /^gst(app|audio|video|tag|riff|rtp|pbutils|fft|sdp|gl|allocators)-1\.0-\d+\.dll$/i,
        why: 'gst-plugins-base ships these as libraries; gstreamer core ships only the five above',
    },
    {
        components: ['gstreamer'],
        pattern: /^gst-plugin-scanner\.exe$/i,
        why:
            'the ONE binary in the bundle that is not a library, and the one the win32 coverage set ' +
            'first left out: it lives in libexec/, so neither the flat bin/ walk nor the module lists ' +
            'reached it. gstreamer core ships the scanner (darwin attributes it through its keg)',
    },
    {
        components: ['gstreamer', 'gst-plugins-base', 'gst-plugins-good'],
        pattern: /^gst[a-z0-9]+\.dll$/i,
        why:
            'the plugin dir mixes all three projects (gstcoreelements is core, gstplayback is -base, ' +
            'gstsoup is -good) and the flat prefix cannot say which is which — so ALL THREE must be ' +
            'documented, the same deliberate over-inclusion prefix attribution already declares',
    },
];

/**
 * The declared family a bundled leaf belongs to, or `null` when nothing claims it.
 * @param {string} leaf bundled file name, e.g. `libcrypto-3-x64.dll`
 * @param {{ components: string[], pattern: RegExp }[]} families
 * @returns {{ components: string[], pattern: RegExp, why?: string } | null}
 */
export function licenseFamilyFor(leaf, families) {
    return families.find((family) => family.pattern.test(leaf)) ?? null;
}

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
 * The components whose terms come from a VENDORED upstream text rather than from the build
 * prefix — the win32 gap-filler, expressed once so the builder and its test cannot disagree
 * about the rule. (They did: the rule lived in the builder and the test re-implemented it,
 * which is a green test over a copy of the code it is meant to hold.)
 *
 * TWO NARROWINGS ARE THE RULE, not a detail of the caller. The prefix stays AUTHORITATIVE —
 * a component it documents is never overridden here — and a vendored text enters only for a
 * project some binary in THIS bundle needs, so the display-free variant does not carry
 * OpenSSL's terms for a DLL it never had.
 * @param {{ root: string, documented: Iterable<string>, binaries: Iterable<string>,
 *   families: {components: string[], pattern: RegExp}[] }} opts
 * @returns {{ name: string, texts: object[], upstreamText: true }[]} sorted by name
 */
export function upstreamLicenseComponents({ root, documented, binaries, families }) {
    const byPrefix = new Set(documented);
    const needed = new Set();
    for (const leaf of binaries) {
        for (const name of licenseFamilyFor(leaf, families)?.components ?? []) needed.add(name);
    }
    const byComponent = new Map();
    for (const text of scanLicenseFiles({ root, subdirs: ['.'], maxDepth: 2 })) {
        if (byPrefix.has(text.component) || !needed.has(text.component)) continue;
        if (!byComponent.has(text.component)) {
            byComponent.set(text.component, { name: text.component, texts: [], upstreamText: true });
        }
        byComponent.get(text.component).texts.push(text);
    }
    return [...byComponent.values()].sort((a, b) => a.name.localeCompare(b.name));
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
        lines.push('What is NOT left to over-inclusion is coverage: the build fails unless every bundled binary');
        lines.push('belongs to a declared project whose terms are in this payload, so a shipped library with no');
        lines.push('license text cannot leave the builder.');
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
        lines.push(`| ${c.name}${c.upstreamText ? ' \\*' : ''} | ${c.version ?? '—'} | ${declared} | ${texts} |`);
    }
    lines.push('');
    const upstream = components.filter((c) => c.upstreamText);
    if (upstream.length > 0) {
        lines.push(
            `\\* The build prefix documents no terms for ${upstream.length} project(s) it nevertheless builds ` +
                'binaries from, so their texts are reproduced from the upstream release the prefix pins. ' +
                'The file and the version it was taken from are recorded next to the builder — ' +
                `${upstream.map((c) => `\`${c.name}\``).join(', ')}.`,
        );
        lines.push('');
    }
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
 *
 * BOTH attribution modes now answer the same question — "does every binary that ships
 * have its terms in the payload" — from whichever evidence their prefix can give:
 * darwin proves it per keg, win32 proves it per declared family. Before, the win32
 * branch asserted only that SOME text was recovered, and eight projects behind fourteen
 * shipped DLLs were invisible to it (§ header).
 *
 * @param {{ components: object[], binaries: string[], unattributed?: object[],
 *   attribution: 'per-binary' | 'prefix', textCount: number,
 *   families?: {components: string[], pattern: RegExp, why?: string}[] }} opts
 *   `families` is REQUIRED under `prefix` attribution: without it the mode has no way to
 *   relate a binary to a component, which is exactly the hole this closes — so its
 *   absence is a problem rather than a skipped check.
 * @returns {string[]}
 */
export function assertLicenseCoverage({ components, binaries, unattributed = [], attribution, textCount, families }) {
    const problems = [];
    if (components.length === 0) problems.push('no license components were derived from the build prefix at all');
    if (binaries.length === 0) problems.push('no bundled binaries were passed to the license step');
    if (textCount === 0) {
        problems.push(
            'not one license text was recovered from the build prefix — the bundle would ship third-party ' +
                'binaries with no terms attached',
        );
    }
    if (attribution === 'prefix') {
        if (!families) {
            problems.push(
                'prefix attribution was used with no license family table — the coverage of every bundled ' +
                    'binary is then uncheckable, which is the state that shipped GLib and OpenSSL with no terms',
            );
        } else {
            // A component COUNTS as documented only when it ships a text. A name in the
            // corpus with an empty text list is a directory, not a licence.
            const documented = new Set(components.filter((c) => (c.texts ?? []).length > 0).map((c) => c.name));
            for (const binary of binaries) {
                const family = licenseFamilyFor(binary, families);
                if (!family) {
                    problems.push(
                        `${binary} belongs to no declared license family — the bundle cannot say which ` +
                            "project's terms cover it",
                    );
                    continue;
                }
                const undocumented = family.components.filter((name) => !documented.has(name));
                if (undocumented.length > 0) {
                    problems.push(
                        `${binary} is ${family.components.join(' + ')}, and no license text ships for ` +
                            `${undocumented.join(', ')}`,
                    );
                }
            }
        }
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
        'directory that holds its license text to the scan roots. For a win32 DLL that belongs to no declared ' +
        'family, add it to WIN32_LICENSE_FAMILIES in bundle-licenses.mjs (a NAME map, one line); for a family ' +
        "the prefix documents no text for, vendor that project's upstream text under the win32 builder's " +
        'licenses-not-in-prefix/ with its provenance. Do NOT downgrade this to a warning and do NOT delete the ' +
        'entry to get a green build — shipping relocated LGPL/Apache binaries with no terms attached is the ' +
        'condition this check exists to prevent.'
    );
}
