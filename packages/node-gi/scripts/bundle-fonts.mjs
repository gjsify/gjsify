// SPDX-License-Identifier: MIT
// Shared by BOTH batteries-included GTK-runtime builders: the bundle brings the GNOME UI
// typeface with it, because off Linux nothing else does.
//
// WHAT WAS MEASURED, on Windows 11 / GTK 4.22.4 / GLib 2.88.1 with the published 0.50.0
// `prebuilds/win32-x64/gtk` bundle:
//
//   "Cantarell 11"    -> Tahoma 11   (couldn't load font "Cantarell 11", falling back to "Sans 11")
//   "Adwaita Sans 11" -> Tahoma 11   (same line)
//   font families on the map: 82 — Cantarell ABSENT, Adwaita Sans ABSENT, Adwaita Mono ABSENT
//
// And confirmed against the tarballs themselves, all three of them: the only `.ttf` in any
// published bundle is GtkSourceView's own `BuilderBlocks.ttf`, and `gtk/share/` holds
// `glib-2.0`, `gtksourceview-5` and `icons` — no `fonts`. Fontconfig's CONFIG ships
// (`etc/fonts/fonts.conf` + `conf.d`), with no faces for it to find.
//
// DARWIN IS MEASURED TOO, in the shipped `.app` on macOS 15.7.9 x86_64 with the GTK closure
// from the bundle itself: 187 families on the map, `Adwaita Sans` and `Cantarell` ABSENT from
// both, both falling back to Helvetica. So "all three bundles" is a measurement on two
// platforms and a tarball listing on the third, not an inference from the recipe.
//
// So every Adwaita stylesheet rule naming the GNOME font, and every application that asks
// for one by name, silently gets a foreign face. Pango does not report a missing family: it
// substitutes, the window renders, the process exits 0.
//
// WHY THE FACES COME FROM `refs/adwaita-fonts` AND NOT FROM THE BUILD PREFIX. Neither
// Homebrew nor gvsbuild installs them — adwaita-fonts is not a formula and not a gvsbuild
// project — and downloading a tarball at build time would put an unpinned third-party
// artifact in a published bundle. The submodule is a pinned upstream checkout that the
// repository already carries for the Adwaita work, so the bytes are the ones a person can
// diff. It is ~7.5 MB of `.ttf` and it is the ONLY `refs/` submodule the bundle jobs
// realize (`--depth 1`), against ~150 GB for the pool.
//
// REGISTRATION IS NOT THIS MODULE'S JOB and is not the same on the two platforms — on
// fontconfig-backed hosts `XDG_DATA_DIRS` already reaches `share/fonts`, while win32's
// pangowin32/DirectWrite font map ignores every fontconfig path and must be told through
// `add_font_file` (ADR 0038 § W1-W5). `@gjsify/node-gi`'s loader publishes the directory as
// `GJSIFY_GTK_RUNTIME_FONT_DIR` and `@gjsify/gtk-host`'s `initFonts()` registers it.
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The desktop face extensions that may be staged, lower-cased.
 *
 * The same four ADR 0038 fixes for `gjsify ship` and for `@gjsify/gtk-host`'s reader, and
 * restated rather than imported for the reason that ADR gives: this is a build script in
 * `packages/node-gi`, `FONT_FACE_EXTENSIONS` is TypeScript in `packages/framework/gtk-host`,
 * and a dependency in that direction is both wrong and impossible. The pairing is a
 * specification each end implements.
 *
 * `.woff`/`.woff2`/`.eot` are absent here too: whether FreeType opens one is a build option
 * of whichever FreeType the SHIPPED artifact loads, so accepting one would stage a file the
 * target may decline — which is a substituted typeface, not an error.
 */
const FONT_FACE_EXTENSIONS = ['.ttf', '.otf', '.ttc', '.otc'];

const isFontFace = (name) => FONT_FACE_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));

/**
 * Where the faces live in the bundle.
 *
 * Under `share/fonts/` because that is the directory fontconfig's stock configuration
 * already looks in over `XDG_DATA_DIRS` (`<dir prefix="xdg">fonts</dir>`), which the loader
 * points at `<bundle>/share`. The `adwaita` leaf keeps the bundle's own faces separable from
 * anything a future step stages beside them.
 */
export const BUNDLE_FONT_DIR = 'share/fonts/adwaita';

/** The licence component name — the leaf the OFL text lands under in `licenses/`. */
export const FONT_LICENSE_COMPONENT = 'adwaita-fonts';

/**
 * The submodule the faces are read from, repo-relative.
 *
 * Named here rather than in each builder so the two cannot drift, and so the CI step that
 * realizes it (`git submodule update --init --depth 1 refs/adwaita-fonts`) has one spelling
 * to match.
 */
export const ADWAITA_FONTS_REF = 'refs/adwaita-fonts';

/**
 * The subdirectories of the checkout that hold shippable faces.
 *
 * Both, and the mono half is not decoration: `Adwaita Mono` is what GNOME's monospace slot
 * resolves to, so a bundle shipping only the sans face moves every code view and terminal
 * widget onto the host's default monospace while the surrounding UI is correct — the same
 * silent substitution one widget in.
 */
const FACE_DIRS = ['sans', 'mono'];

/**
 * The family names the staged faces are expected to produce.
 *
 * A NAME LIST, and the reason it exists is that a file count cannot answer the only question
 * a consumer has. `initFonts()` reports the families the font map GAINED and warns about each
 * expected family that did not arrive, and it needs names to do it; a face that FreeType
 * declines registers as zero new families while every count stays right. This is the same
 * lesson `windowingData.decodeProbe` records one data set over: 860 icon files of which zero
 * decoded.
 *
 * `Cantarell` is deliberately NOT here. Adwaita Sans succeeded it as the GNOME UI face and
 * adwaita-fonts ships no Cantarell — an application still naming it gets a substitution, and
 * the honest place to say so is the family-match report, not a family this bundle pretends to
 * carry.
 */
export const BUNDLED_FONT_FAMILIES = ['Adwaita Sans', 'Adwaita Mono'];

/**
 * Copy the Adwaita faces out of the pinned submodule into the finished bundle.
 *
 * Returns what it did rather than throwing on an empty checkout: the builders treat a missing
 * data set uniformly at their § "verify the finished bundle" step (`verifyWindowingData`,
 * which now carries a `fonts` set), so a WARN here keeps the cause visible next to the path
 * that was missing while the FAILURE stays in the one place that reads the bundle back.
 *
 * @param {{ repoRoot: string, outDir: string }} opts
 * @returns {{ dir: string, faces: string[], source: string, bytes: number }}
 */
export function stageBundledFonts({ repoRoot, outDir }) {
    const source = join(repoRoot, ADWAITA_FONTS_REF);
    const dir = join(outDir, ...BUNDLE_FONT_DIR.split('/'));
    const faces = [];
    let bytes = 0;
    if (!existsSync(source)) return { dir, faces, source, bytes };

    mkdirSync(dir, { recursive: true });
    for (const sub of FACE_DIRS) {
        const from = join(source, sub);
        if (!existsSync(from)) continue;
        for (const entry of readdirSync(from, { withFileTypes: true })) {
            // Files only, and no recursion: the upstream layout is flat and a link would put
            // a path that resolves on the build machine alone into the tarball — the class
            // `findSymlinks` exists against, closed here by never following one.
            if (!entry.isFile() || !isFontFace(entry.name)) continue;
            const src = join(from, entry.name);
            copyFileSync(src, join(dir, entry.name));
            bytes += statSync(src).size;
            faces.push(entry.name);
        }
    }
    faces.sort();
    return { dir, faces, source, bytes };
}

/**
 * The faces' terms, in the shape the shared licence payload/notice already takes — so the OFL
 * text is written by `writeLicensePayload`, named in `THIRD-PARTY-NOTICES.md` and counted in
 * `manifest.licenses.texts` like every other component, rather than copied beside them by a
 * second mechanism nothing reads.
 *
 * ITS OWN COMPONENT, and not folded into one of the prefix's. Every other text in `licenses/`
 * is recovered from the build prefix (a Homebrew keg, the gvsbuild install tree); these faces
 * come from a pinned submodule, and attributing OFL fonts to "the gvsbuild prefix" would be a
 * false statement in the one file whose entire job is true ones. `binaries: []` is honest for
 * the same reason — a `.ttf` is not a loadable image, so no per-binary attribution claims it,
 * and both coverage modes already accept a component that ships a text and owns no binary.
 *
 * @param {{ repoRoot: string }} opts
 * @returns {{ name: string, license: string, homepage: string, binaries: string[],
 *   texts: {absolute: string, relative: string, file: string, component: string, bytes: number}[] } | null}
 */
export function bundledFontLicenseComponent({ repoRoot }) {
    const absolute = join(repoRoot, ADWAITA_FONTS_REF, 'LICENSE');
    if (!existsSync(absolute)) return null;
    return {
        name: FONT_LICENSE_COMPONENT,
        // The upstream file is the OFL verbatim; the SPDX id is stated and the TEXT ships, so
        // a reader never has to take this field's word for anything.
        license: 'OFL-1.1',
        homepage: 'https://gitlab.gnome.org/GNOME/adwaita-fonts',
        binaries: [],
        texts: [
            {
                absolute,
                relative: 'LICENSE',
                // `.txt`, because the payload writer copies under the name given here and a
                // bare `LICENSE` beside the faces reads as the bundle's own terms.
                file: 'OFL.txt',
                component: FONT_LICENSE_COMPONENT,
                bytes: statSync(absolute).size,
            },
        ],
    };
}

/** The operator message for a checkout that is not there — one spelling for both builders. */
export function formatMissingFontSource(source) {
    return (
        `WARNING — no Adwaita faces at ${source}; the bundle will ship no UI font ` +
        '(§ "the DECLARED windowing data" will fail this build). The submodule is not realized: run ' +
        '`git submodule update --init --depth 1 refs/adwaita-fonts` before the builder. Do NOT init ' +
        'refs/ recursively — the realized pool is ~150 GB.'
    );
}
