// Compile the bundled Adwaita icon subset into a GResource, then embed it as a VALUE.
//
// WHY AN APP HAS TO SHIP ITS ICONS AT ALL. A GTK app that writes
// `iconName: 'list-add-symbolic'` draws whatever the HOST's icon theme has under that
// name — and nothing guarantees the host has the Adwaita set at all. Measured across this
// repository before this change: `add_resource_path` and `add_search_path` had ZERO hits
// in every `.ts`/`.js`/`.mjs`/`.tmpl`/`.blp` outside `node_modules`, so every gjsify GTK
// app drew the host's theme, and on a host with no Adwaita a documented icon name drew
// GTK's broken-image paintable. The web pillar closed the same hole with `registerIcon()`
// and a compiled subset; this is the GTK half of that guarantee.
//
// WHAT THE RESOURCE PATH DOES AND DOES NOT BUY, measured on this machine against
// gtk4 with `Gtk.IconTheme.lookup_icon(...).get_file().get_uri()` — the file the widget
// will actually paint, not a claim that a path was registered:
//
//   host theme = Adwaita (HAS the name)  ->  file:///usr/share/icons/Adwaita/... (host wins)
//   host theme = oxygen / Bluecurve      ->  resource:///.../scalable/actions/... (bundle wins)
//   host theme = hicolor                 ->  resource:///... (bundle wins)
//
// So `add_resource_path` is a FALLBACK contribution, exactly as its GIR doc says
// ("make application-specific icons available as part of the icon theme"), not an
// override. That is the right default for a desktop app — a user who chose Papirus keeps
// Papirus — and it already closes the failure this exists for: the name never fails to
// resolve. `installBundledIconTheme({ prefer: 'bundled' })` is the opt-in that also makes
// the shipped set authoritative; `icon-theme.ts` documents how and what it costs.
//
// WHY THE BYTES TRAVEL AS BASE64 AND NOT AS A SIBLING FILE. `gjsify build` emits ONE
// bundle file with no asset pipeline (the single-file invariant in
// rolldown-plugin-gjsify/AGENTS.md), so a `.gresource` next to the JS is a file the app
// cannot find at runtime. `@gjsify/adwaita-fonts`' `build-embedded.mjs` states the same
// lesson one package over: what has to travel through a JS bundle travels as a VALUE. The
// BUNDLING is still `glib-compile-resources`, reached through the CLI's own `gjsify
// gresource` command — base64 is transport, not a second bundling mechanism.
//
// Usage: node scripts/build-icon-gresource.mjs

import { execFileSync, spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(__dirname, '..');
const iconsPkg = resolve(pkgRoot, '../../web/adwaita-icons');
const staging = join(pkgRoot, 'tmp/icon-theme');

/**
 * THE MEMBERSHIP RULE: exactly the names `@gjsify/adwaita-web`'s own compiled subset
 * carries, so a name that draws on the web renderer draws here too.
 *
 * Not "every icon Adwaita ships" — that is 644 glyphs and 715.2 KiB of SVG source, and an
 * app pays for the whole GResource whether it names one icon or forty. Not a set chosen
 * fresh either: a THIRD independent subset is a third thing to drift, and the guarantee
 * being made across the three renderers is "same property, same name, same glyph". So the
 * list is the web pillar's, from the same vendored source, and
 * `scripts/check-bundled-icon-parity.mjs` fails when the two drift apart.
 *
 * `view-columns` is the one name in that map which is deliberately NOT here: it is in no
 * icon theme at all, `@gjsify/adwaita-icons` does not export it, and `build-scss.mjs`
 * hand-draws a substitute for the web only. Bundling a hand-drawn glyph here would make
 * GTK the second renderer with a private icon; `status/adwaita-web-icon-masks.json`
 * already carries that argument and its verdict.
 */
const SUBSET = [
    ['actions', 'contact-new'],
    ['actions', 'document-edit'],
    ['actions', 'document-open'],
    ['actions', 'document-save'],
    ['actions', 'edit-copy'],
    ['actions', 'go-down'],
    ['actions', 'go-home'],
    ['actions', 'go-next'],
    ['actions', 'go-previous'],
    ['actions', 'list-add'],
    ['actions', 'list-remove'],
    ['actions', 'mail-reply-sender'],
    ['actions', 'mail-send'],
    ['actions', 'open-menu'],
    ['actions', 'send-to'],
    ['actions', 'sidebar-show'],
    ['actions', 'system-search'],
    ['actions', 'view-conceal'],
    ['actions', 'view-grid'],
    ['actions', 'view-list'],
    ['actions', 'view-more'],
    ['actions', 'view-paged'],
    ['actions', 'view-refresh'],
    ['actions', 'view-reveal'],
    ['categories', 'preferences-system'],
    ['devices', 'camera-photo'],
    ['devices', 'network-wireless'],
    ['legacy', 'emblem-system'],
    ['mimetypes', 'application-x-executable'],
    ['places', 'folder'],
    ['places', 'folder-documents'],
    ['places', 'folder-download'],
    ['places', 'folder-music'],
    ['places', 'user-trash'],
    ['status', 'avatar-default'],
    ['status', 'image-missing'],
    ['status', 'mail-unread'],
    ['status', 'starred'],
    ['ui', 'window-close'],
    ['ui', 'window-maximize'],
    ['ui', 'window-minimize'],
];

/**
 * The `scalable/<context>` directories GTK will scan under a resource path.
 *
 * From the freedesktop icon-theme spec, and the list `hicolor`'s own `index.theme`
 * declares — a resource path's icons are looked up as part of hicolor, so a directory
 * hicolor does not define is a directory the scan never visits.
 */
const HICOLOR_CONTEXTS = new Set([
    'actions',
    'animations',
    'apps',
    'categories',
    'devices',
    'emblems',
    'emotes',
    'filesystems',
    'intl',
    'mimetypes',
    'places',
    'status',
    'stock',
]);

/**
 * Where a subpath of `@gjsify/adwaita-icons` maps to, when its own name is not a context.
 *
 * MEASURED, not assumed, and the first version of this was wrong in a way only a lookup
 * could show. Adwaita files `emblem-system-symbolic` under its own `legacy/` directory and
 * this generator copied that name across — but `legacy` is not in {@link HICOLOR_CONTEXTS},
 * so GTK never looked in it and the name fell through to GTK's OWN builtin resource icons
 * (`resource:///org/gtk/libgtk/icons/…`). Everything about that failure was silent: the
 * resource contained the glyph, the path was registered, and a different picture was
 * drawn. `ui` is the same shape — not a hicolor context — and a window control is an
 * action anyway.
 */
const CONTEXT_DIR = { ui: 'actions', legacy: 'emblems' };

/** `list-add` → `listAddSymbolic`, the icon generator's own rule. */
const exportNameFor = (name) => `${name.replace(/-([a-z0-9])/g, (_a, c) => c.toUpperCase())}Symbolic`;

/** The resource prefix. Namespaced to this package so no app can collide with it. */
const PREFIX = '/eu/jumplink/gjsify/adwaita-app/icons';

const generated = join(pkgRoot, 'src/icons.generated.ts');

/**
 * Whether `glib-compile-resources` is on PATH.
 *
 * IT IS NOT EVERYWHERE, and that is the whole reason the artifact is COMMITTED. This
 * generator runs from `build:gjsify` and `build:types`, which means it runs wherever the
 * package is built — including the Windows leg of `gtk-os-suites.yml`, a runner that
 * deliberately has no GTK toolchain at all (the job asserts a gvsbuild GTK is ABSENT,
 * because its whole subject is the shipped closure). A build step that hard-required a
 * GLib binary would fail there for a reason that has nothing to do with what the job
 * measures.
 */
function haveCompiler() {
    return spawnSync('glib-compile-resources', ['--version'], { stdio: 'ignore' }).status === 0;
}

if (!haveCompiler()) {
    if (!existsSync(generated)) {
        console.error(
            'build-icon-gresource: glib-compile-resources is not on PATH and src/icons.generated.ts is ' +
                'absent, so there is nothing to build the icon bundle from and nothing to fall back on.\n' +
                '  Install it (glib2 / libglib2.0-dev — the BINARY package, not just -devel), or restore ' +
                'the committed artifact with `git checkout -- packages/framework/adwaita-app/src`.',
        );
        process.exit(1);
    }
    // The committed artifact is the input to the TS program, exactly as
    // `adwaita-web/src/styles.generated.ts` is; regenerating it is how it CHANGES, not
    // how it is obtained. Staleness is not silent: `check-bundled-icon-parity.mjs` reads
    // the name list this file records and fails when it disagrees with SUBSET.
    console.log('✓ glib-compile-resources absent — keeping the committed src/icons.generated.ts');
    process.exit(0);
}

rmSync(staging, { recursive: true, force: true });

const modules = new Map();
const entries = [];
for (const [subpath, name] of SUBSET) {
    if (!modules.has(subpath)) modules.set(subpath, await import(join(iconsPkg, `${subpath}.ts`)));
    const glyph = modules.get(subpath)[exportNameFor(name)];
    if (typeof glyph !== 'string') {
        throw new Error(
            `build-icon-gresource: @gjsify/adwaita-icons/${subpath} exports no ${exportNameFor(name)} — ` +
                `the subset names a glyph the vendored theme does not have.`,
        );
    }
    const dir = CONTEXT_DIR[subpath] ?? subpath;
    if (!HICOLOR_CONTEXTS.has(dir)) {
        throw new Error(
            `build-icon-gresource: "${dir}" is not a hicolor context directory, so GTK would never scan it ` +
                `and ${name}-symbolic would resolve to something else with no error anywhere. Map ` +
                `"${subpath}" in CONTEXT_DIR to one of: ${[...HICOLOR_CONTEXTS].join(', ')}.`,
        );
    }
    // `-symbolic` back on: the FILE name is what GTK matches the looked-up name against,
    // and every one of these is looked up with the suffix.
    const rel = `scalable/${dir}/${name}-symbolic.svg`;
    mkdirSync(join(staging, `scalable/${dir}`), { recursive: true });
    writeFileSync(join(staging, rel), glyph);
    entries.push(rel);
}

// NO `preprocess="xml-stripblanks"`, and the reason is both halves of the trade.
// It shells out to `xmllint`, which the CI image does not declare — `.docker/
// ci-fedora.Dockerfile` names `glib2` for `glib-compile-resources` and `gettext` for
// `msgfmt` and says nothing about libxml2, so depending on it would be an undeclared
// toolchain requirement whose absence breaks the BUILD. And it does not even pay:
// measured over these 41 glyphs, xmllint's reformatting makes the compressed resource
// BIGGER (20 810 B with it, 20 349 B without), because it re-indents what zlib then has
// to carry. Compression is where the saving is: 43 377 B uncompressed, 20 349 B with
// `compressed="true"` — 53 % off.
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Generated by scripts/build-icon-gresource.mjs — DO NOT EDIT. -->
<gresources>
  <gresource prefix="${PREFIX}">
${entries.map((rel) => `    <file compressed="true">${rel}</file>`).join('\n')}
  </gresource>
</gresources>
`;
const xmlPath = join(staging, 'adwaita-icons.gresource.xml');
writeFileSync(xmlPath, xml);

// The CLI's own command, not a bare `glib-compile-resources`: one bundling mechanism, and
// it is the one that already reports a missing toolchain with an install hint.
const target = join(staging, 'adwaita-icons.gresource');
execFileSync('gjsify', ['gresource', xmlPath, `--sourcedir=${staging}`, `--target=${target}`], {
    stdio: 'inherit',
});

const bytes = readFileSync(target);
const base64 = Buffer.from(bytes).toString('base64');
const svgBytes = entries.reduce((n, rel) => n + Buffer.byteLength(readFileSync(join(staging, rel))), 0);

const contents = `// icons.generated.ts — auto-generated by scripts/build-icon-gresource.mjs
// DO NOT EDIT. Regenerated on every build from @gjsify/adwaita-icons.
//
// The compiled GResource, base64-encoded so it survives a single-file bundle. See the
// generator's header for why the bytes travel as a value rather than as a sibling file.

/** The resource prefix the icons are registered under. */
export const BUNDLED_ICON_RESOURCE_PATH = '${PREFIX}';

/** How many glyphs the bundle carries. */
export const BUNDLED_ICON_COUNT = ${entries.length};

/**
 * The names in the bundle, recorded so a STALE committed artifact is detectable without
 * \`glib-compile-resources\` — \`check-bundled-icon-parity.mjs\` holds this against SUBSET.
 */
export const BUNDLED_ICON_NAMES = ${JSON.stringify(SUBSET.map(([, name]) => name).sort())} as const;

/** The compiled \`.gresource\`, base64. ${bytes.length} bytes raw. */
export const BUNDLED_ICON_GRESOURCE_BASE64 =
    '${base64}';
`;
writeFileSync(generated, contents);

const kib = (n) => `${(n / 1024).toFixed(1)} KiB`;
console.log(
    `✓ bundled ${entries.length} icons — ${svgBytes} B of SVG source, ` +
        `${bytes.length} B compiled (${kib(bytes.length)}), ` +
        `${base64.length} B base64 (${kib(base64.length)})`,
);
