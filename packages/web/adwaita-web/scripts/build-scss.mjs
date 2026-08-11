// Build script for @gjsify/adwaita-web stylesheet.
// 1. Resolve symbolic icons from @gjsify/adwaita-icons and write _icons.generated.scss.
// 2. Compile scss/adwaita-skin.scss to dist/adwaita-web.css using the sass npm package.

import { compileString } from 'sass';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
    contactNewSymbolic,
    documentEditSymbolic,
    documentOpenSymbolic,
    documentSaveSymbolic,
    editCopySymbolic,
    editPasteSymbolic,
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
    viewRefreshSymbolic,
    viewRevealSymbolic,
} from '@gjsify/adwaita-icons/actions';
import { cameraPhotoSymbolic, networkWirelessSymbolic } from '@gjsify/adwaita-icons/devices';
import {
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
import { toDataUri } from '@gjsify/adwaita-icons/utils';

// view-columns-symbolic is not in the vendored icon theme @gjsify/adwaita-icons is
// generated from, so supply a matching 3-column glyph in the same symbolic style.
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
const ICONS = {
    'edit-paste': editPasteSymbolic,
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
    'folder-download': folderDownloadSymbolic,
    'view-grid': viewGridSymbolic,
    'view-list': viewListSymbolic,
    'view-columns': viewColumnsSymbolic,
    'list-remove': listRemoveSymbolic,
    'send-to': sendToSymbolic,
    'folder-music': folderMusicSymbolic,
    'edit-copy': editCopySymbolic,
    'emblem-system': emblemSystemSymbolic,
    'preferences-system': preferencesSystemSymbolic,
    'application-x-executable': applicationXExecutableSymbolic,
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
// the `file:` URL a FileImporter hands back. Porting the rest of the way means swapping
// this one object for an Importer whose `canonicalize`/`load` supply CONTENTS through
// `node:fs` (which gjsify polyfills); nothing else here changes. Tracked in
// `status/open-todos.md` (#1053) as the one script not yet equivalent to the other four.
const entryPoint = resolve(scssDir, 'adwaita-skin.scss');
const result = compileString(readFileSync(entryPoint, 'utf8'), {
    url: pathToFileURL(entryPoint),
    importers: [{ findFileUrl: (url) => new URL(url, pathToFileURL(`${scssDir}/`)) }],
    style: 'expanded',
    sourceMap: true,
    sourceMapIncludeSources: true,
});

mkdirSync(distDir, { recursive: true });

const cssOut = resolve(distDir, 'adwaita-web.css');
const mapOut = resolve(distDir, 'adwaita-web.css.map');

writeFileSync(cssOut, `${result.css}\n/*# sourceMappingURL=adwaita-web.css.map */\n`);
writeFileSync(mapOut, JSON.stringify(result.sourceMap));

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
