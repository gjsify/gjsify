// Build script for @gjsify/adwaita-web stylesheet.
// 1. Resolve symbolic icons from @gjsify/adwaita-icons and write _icons.generated.scss.
// 2. Compile scss/adwaita-skin.scss to dist/adwaita-web.css using the sass npm package.

import { compileString } from 'sass';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
    contactNewSymbolic,
    documentEditSymbolic,
    documentOpenSymbolic,
    documentSaveSymbolic,
    editCopySymbolic,
    goDownSymbolic,
    goHomeSymbolic,
    goNextSymbolic,
    goPreviousSymbolic,
    listAddSymbolic,
    listRemoveSymbolic,
    mailReplySenderSymbolic,
    mailSendSymbolic,
    openMenuSymbolic,
    sendToSymbolic,
    sidebarShowSymbolic,
    systemSearchSymbolic,
    viewConcealSymbolic,
    viewGridSymbolic,
    viewListSymbolic,
    viewMoreSymbolic,
    viewPagedSymbolic,
    viewRefreshSymbolic,
    viewRevealSymbolic,
} from '@gjsify/adwaita-icons/actions';
import { cameraPhotoSymbolic, networkWirelessSymbolic } from '@gjsify/adwaita-icons/devices';
import {
    folderDocumentsSymbolic,
    folderDownloadSymbolic,
    folderMusicSymbolic,
    folderSymbolic,
    userTrashSymbolic,
} from '@gjsify/adwaita-icons/places';
import {
    avatarDefaultSymbolic,
    imageMissingSymbolic,
    mailUnreadSymbolic,
    starredSymbolic,
} from '@gjsify/adwaita-icons/status';
import { emblemSystemSymbolic } from '@gjsify/adwaita-icons/legacy';
import { preferencesSystemSymbolic } from '@gjsify/adwaita-icons/categories';
import { applicationXExecutableSymbolic } from '@gjsify/adwaita-icons/mimetypes';
import { windowCloseSymbolic, windowMaximizeSymbolic, windowMinimizeSymbolic } from '@gjsify/adwaita-icons/ui';
import { toDataUri } from '@gjsify/adwaita-icons/utils';

// view-columns-symbolic is in NO icon theme — not the vendored one @gjsify/adwaita-icons
// is generated from, and not the installed Adwaita either. So the GTK story and the
// `.mdx` GJS/Blueprint panes naming it draw the broken-image paintable, and this
// hand-drawn 3-column glyph makes the WEB pane the odd one out rather than the fixed
// one. A glyph only this renderer has has to be argued in
// status/adwaita-web-icon-masks.json: `check-adwaita-icon-masks.mjs` fails on any ICONS
// value it cannot trace to an @gjsify/adwaita-icons import.
const viewColumnsSymbolic = `<svg height="16px" viewBox="0 0 16 16" width="16px" xmlns="http://www.w3.org/2000/svg">
    <path d="m 2 1 c -0.554688 0 -1 0.445312 -1 1 v 12 c 0 0.554688 0.445312 1 1 1 h 2 c 0.554688 0 1 -0.445312 1 -1 v -12 c 0 -0.554688 -0.445312 -1 -1 -1 z m 5 0 c -0.554688 0 -1 0.445312 -1 1 v 12 c 0 0.554688 0.445312 1 1 1 h 2 c 0.554688 0 1 -0.445312 1 -1 v -12 c 0 -0.554688 -0.445312 -1 -1 -1 z m 5 0 c -0.554688 0 -1 0.445312 -1 1 v 12 c 0 0.554688 0.445312 1 1 1 h 2 c 0.554688 0 1 -0.445312 1 -1 v -12 c 0 -0.554688 -0.445312 -1 -1 -1 z m 0 0" fill="currentColor"/>
</svg>`;

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(__dirname, '..');
const scssDir = resolve(pkgRoot, 'scss');
const distDir = resolve(pkgRoot, 'dist');

// Single source of truth: a CSS `--icon-<name>` custom property AND the matching
// `.adw-icon--<name>` mask class are both generated from this map, so adding an icon used
// by a component or story is one entry here. Names are the libadwaita symbolic names with
// the `-symbolic` suffix dropped.
//
// THE MEMBERSHIP RULE, and the constraint behind it. Inlining everything
// `@gjsify/adwaita-icons` exports costs a MEASURED ~1.07 MB of data-URI, roughly five
// times the stylesheet it would sit in (the largest single glyph is 47 KB), so the
// compiled set has to be a chosen subset. The rule is: every icon name a SHIPPING
// web-facing surface in this repo emits, and nothing else. Deliberately NOT "every name
// any renderer emits" — a GTK pane names icons the SYSTEM theme resolves — and
// deliberately not what a FIXTURE names either: a spec or a conformance vector must not
// buy a shipped byte.
//
// `scripts/check-adwaita-icon-masks.mjs` holds the rule in three directions — it reads
// THIS map (the generated partial is gitignored, and the audit job neither installs nor
// builds) and fails on an emitted name with no entry, on an entry nothing emits, and on
// a glyph that came from somewhere other than @gjsify/adwaita-icons. Its header carries
// the surface list and the incident. Before the gate existed, an unresolvable name was
// not an error of any kind: the icon painted a solid 16px square in the widget's text
// colour and `adw-icon.spec.ts` asserted only that the class STRING had been applied.
// That is why the browser storybook drew `view-grid` where its GTK twin drew
// `view-paged-symbolic` — the right name resolved to a square, so a different one was
// substituted and the divergence recorded as prose.
const ICONS = {
    'go-down': goDownSymbolic,
    'sidebar-show': sidebarShowSymbolic,
    'go-previous': goPreviousSymbolic,
    'go-next': goNextSymbolic,
    'view-refresh': viewRefreshSymbolic,
    'open-menu': openMenuSymbolic,
    'go-home': goHomeSymbolic,
    'list-add': listAddSymbolic,
    'network-wireless': networkWirelessSymbolic,
    folder: folderSymbolic,
    starred: starredSymbolic,
    'system-search': systemSearchSymbolic,
    'contact-new': contactNewSymbolic,
    'mail-unread': mailUnreadSymbolic,
    'avatar-default': avatarDefaultSymbolic,
    'camera-photo': cameraPhotoSymbolic,
    'user-trash': userTrashSymbolic,
    'view-reveal': viewRevealSymbolic,
    'view-conceal': viewConcealSymbolic,
    'document-edit': documentEditSymbolic,
    'document-open': documentOpenSymbolic,
    'document-save': documentSaveSymbolic,
    'mail-send': mailSendSymbolic,
    'mail-reply-sender': mailReplySenderSymbolic,
    'folder-documents': folderDocumentsSymbolic,
    'folder-download': folderDownloadSymbolic,
    'view-grid': viewGridSymbolic,
    'view-list': viewListSymbolic,
    'view-more': viewMoreSymbolic,
    'view-paged': viewPagedSymbolic,
    'view-columns': viewColumnsSymbolic,
    'list-remove': listRemoveSymbolic,
    'send-to': sendToSymbolic,
    'folder-music': folderMusicSymbolic,
    'edit-copy': editCopySymbolic,
    'emblem-system': emblemSystemSymbolic,
    'preferences-system': preferencesSystemSymbolic,
    'application-x-executable': applicationXExecutableSymbolic,
    // GtkWindowControls' glyphs — needed by anything that draws an Adwaita window
    // frame in the browser, where there is no window manager to draw it. All
    // three, because the set a window shows is the PLATFORM's decoration layout:
    // close alone on GNOME, minimize/maximize/close on Windows.
    'window-close': windowCloseSymbolic,
    'window-minimize': windowMinimizeSymbolic,
    'window-maximize': windowMaximizeSymbolic,
    // The libadwaita fallback for a NULL/empty icon-name: every view switcher substitutes
    // it, so it has to resolve to a real glyph rather than to an empty mask.
    'image-missing': imageMissingSymbolic,
};

const iconVars = Object.entries(ICONS)
    .map(([name, svg]) => `  --icon-${name}: ${toDataUri(svg)};`)
    .join('\n');
const iconClasses = Object.keys(ICONS)
    .map(
        (name) =>
            `.adw-icon--${name} {\n  mask-image: var(--icon-${name});\n  -webkit-mask-image: var(--icon-${name});\n}`,
    )
    .join('\n\n');

const iconPartial = `// _icons.generated.scss — auto-generated by scripts/build-scss.mjs
// DO NOT EDIT — regenerated on every build from @gjsify/adwaita-icons.

:root {
${iconVars}
}

${iconClasses}
`;

writeFileSync(resolve(scssDir, '_icons.generated.scss'), iconPartial);
console.log(`✓ Generated scss/_icons.generated.scss (${Object.keys(ICONS).length} icons)`);

// `compileString`, NOT `compile`, and the difference is not stylistic: dart-sass gates its
// four FILE-PATH entry points (compile, compileAsync, render, renderSync) behind a runtime
// `isNodeJs()` test and throws "The compile() method is only available in Node.js.", while
// `compileString`/`compileStringAsync` carry no such test. A `gjsify build --app gjs` of
// this script omits the `node` export condition, so it resolves sass's `default` entry,
// BUILDS GREEN, and throws on the first compile at runtime (#1053).
//
// The importer is the SEAM, which is why resolution is routed through one rather than left
// to sass. `sass.node.js` populates the global `self.fs` that dart-sass reads every file
// through; `sass.default.js` loads with `{immutable}` only, so on a non-Node runtime that
// global is undefined and sass can open nothing — neither its own filesystem importer nor
// the `file:` URL a FileImporter hands back. So this is an Importer, not a FileImporter:
// `canonicalize` decides WHICH file (the partial/index resolution sass would otherwise do
// itself) and `load` hands back CONTENTS read through `node:fs`, which gjsify polyfills.
// dart-sass never opens a file, so it never needs the global it does not have.
//
// The other half of running here is NOT in this file — it is
// `package.json#gjsify.nodeScript.excludeGlobals`, and since JSON cannot carry the reason,
// the reason is here. `--globals auto` answers a runtime question syntactically: it injects
// a register for every global the bundled code MENTIONS, and dart-sass mentions its whole
// browser half. Two consequences, both fatal, neither obvious from the symptom:
//
//   document, HTMLElement, HTMLCanvasElement, Path2D, MutationObserver, navigator —
//     dead code here, but their registers are GTK-backed, so the bundle demands gi://Gdk at
//     load, and dart2js's own `document.scripts` probe then dies on a document polyfill
//     that has no `scripts`. A build script must not need a display stack.
//   process —
//     the one that decides everything else. dart-sass asks `process.versions` whether it
//     owns a `node` key and switches HOST STRATEGY on the answer; `@gjsify/process` answers
//     `20.0.0` on purpose, for the npm packages that gate an API LEVEL on it. Believed, it
//     sends dart-sass down a path whose `require("url")` a bundled ESM artifact cannot
//     serve. Left out, the bundle's own banner `process` stands — same `platform`/`env`/
//     `cwd`, and an empty `versions` — which is the truth here and is all this script uses.
//
// `location` deliberately STAYS: dart's `Uri.base` reads it, and unlike the six above its
// register pulls in no display stack.
//
// CANONICAL URLs USE A PRIVATE SCHEME, NOT `file:`, and that is the load-bearing detail.
// Sass resolves relative loads from a `file:`-canonical stylesheet through its OWN
// filesystem importer, so a custom importer on a `file:` entry is never asked: under Node
// it stayed dead code (which is why swapping it in changed no byte), and under GJS the
// first `@use` died with "fileExists() is only supported on Node.js". A URL sass cannot
// recognise as a file is what forces every load back through `load()` below. `load()`
// hands the real `file:` URL back as `sourceMapUrl`, so the emitted map still names the
// sources by their real paths and both outputs stay byte-identical to the Node run.
// Authority-less on purpose (`gjsify-fs:/a/b`, not `gjsify-fs:///a/b`): sass round-trips
// these through DART's `Uri`, not the WHATWG parser, and Dart drops an empty authority on
// normalisation. Writing the form it normalises TO is what keeps the string sass hands back
// equal to the string handed in — the three-slash form came back as one and turned a fixed
// prefix length into `file://ome/...`.
const CANONICAL_SCHEME = 'gjsify-fs:';
const FILE_SCHEME = 'file://';

/** `/a/b.scss` → `gjsify-fs:/a/b.scss` (on Windows: `gjsify-fs:/C:/a/b.scss`). */
const toCanonical = (path) => new URL(CANONICAL_SCHEME + pathToFileURL(path).pathname);
/** The inverse — the same location in the scheme a source map and `node:fs` understand. */
const toFileUrl = (canonical) => new URL(FILE_SCHEME + new URL(String(canonical)).pathname);

const SASS_EXTENSIONS = ['.scss', '.sass', '.css'];

/**
 * The candidate files sass itself would try for a load, in its order: the exact name, then
 * the `_partial`, then the same two per extension, then the directory's `index`. Written
 * out because a custom `canonicalize` replaces that resolution — it does not extend it.
 */
function loadCandidates(path) {
    const dir = dirname(path);
    const name = basename(path);
    const ext = extname(name);
    if (SASS_EXTENSIONS.includes(ext)) {
        const stem = name.slice(0, -ext.length);
        return [join(dir, name), join(dir, `_${stem}${ext}`)];
    }
    return [
        ...SASS_EXTENSIONS.flatMap((e) => [join(dir, `${name}${e}`), join(dir, `_${name}${e}`)]),
        ...SASS_EXTENSIONS.flatMap((e) => [join(path, `index${e}`), join(path, `_index${e}`)]),
    ];
}

const contentsImporter = {
    canonicalize(url) {
        // Sass resolves a relative `@use` against the containing stylesheet's canonical URL
        // before asking, so this is normally already in the canonical scheme. `scssDir`
        // anchors the one case it is not: a bare specifier reaching the entry's importer.
        const target = url.startsWith(CANONICAL_SCHEME) ? fileURLToPath(toFileUrl(url)) : resolve(scssDir, url);
        for (const candidate of loadCandidates(target)) {
            if (existsSync(candidate)) return toCanonical(candidate);
        }
        return null;
    },
    load(canonicalUrl) {
        const fileUrl = toFileUrl(canonicalUrl);
        const path = fileURLToPath(fileUrl);
        const ext = extname(path);
        return {
            contents: readFileSync(path, 'utf8'),
            syntax: ext === '.sass' ? 'indented' : ext === '.css' ? 'css' : 'scss',
            // The private scheme is an implementation detail of HOW the file was read; the
            // map has to name the file itself, or every `sourcesContent` entry is filed
            // under a URL nothing can open.
            sourceMapUrl: fileUrl,
        };
    },
};

const entryPoint = resolve(scssDir, 'adwaita-skin.scss');
const result = compileString(readFileSync(entryPoint, 'utf8'), {
    url: toCanonical(entryPoint),
    importers: [contentsImporter],
    style: 'expanded',
    sourceMap: true,
    sourceMapIncludeSources: true,
});

mkdirSync(distDir, { recursive: true });

const cssOut = resolve(distDir, 'adwaita-web.css');
const mapOut = resolve(distDir, 'adwaita-web.css.map');

writeFileSync(cssOut, `${result.css}\n/*# sourceMappingURL=adwaita-web.css.map */\n`);
// The ENTRY is the one stylesheet sass did not get through `load()` — it was handed the
// string directly — so it is the one source still named in the private scheme. A map
// describes files a devtool has to be able to open, so the scheme comes back off here,
// where it went on, rather than leaking into the artifact.
const sourceMap = {
    ...result.sourceMap,
    sources: result.sourceMap.sources.map((s) => (s.startsWith(CANONICAL_SCHEME) ? String(toFileUrl(s)) : s)),
};
writeFileSync(mapOut, JSON.stringify(sourceMap));

console.log(`✓ Compiled ${entryPoint} → ${cssOut}`);

// `src/styles.generated.ts` lets the JS entry self-apply the stylesheet via a <style>
// element (see src/index.ts). This is bundler-independent — unlike a `.css` import, which
// a gjsify `--app browser` build turns into a string that a side-effect import would
// silently discard, leaving the app unstyled.
//
// It is a build INTERMEDIATE (input to the TypeScript-compiling consumer + build:types),
// NOT build output: regenerated from the compiled CSS on every build and kept in `src/`
// (gitignored) so `src/index.ts` can import it. Emit ONLY the `.ts`: a co-located `.js`
// sibling next to the `.ts` source is what the bundler saw twice, as
// `styles.generated{,2}.js`.
const stylesModule = `// styles.generated — auto-generated by scripts/build-scss.mjs.
// DO NOT EDIT — the compiled adwaita-web stylesheet, inlined so the JS entry can
// self-apply it on import regardless of the consumer's bundler.
export const ADWAITA_WEB_CSS = ${JSON.stringify(result.css)};
`;
writeFileSync(resolve(pkgRoot, 'src', 'styles.generated.ts'), stylesModule);
console.log('✓ Generated src/styles.generated.ts');
