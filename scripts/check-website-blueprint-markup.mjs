#!/usr/bin/env node
// Every one-Blueprint gallery block, on the BUILT site, shows its layout in each port's own
// markup — and that markup is what the block's `.blp` renders to, today.
//
// WHY THE BUILT SITE
//
// The markup is in no source file. `AdwWidget.astro` renders it on every build from the block's
// `?shared-tree` projection with `@gjsify/adwaita-core/markup`, and `blueprint-panes.mjs`
// composes each port binding's FILES from it and the page's slot code: Web Components as
// `index.html` (the `<adw-*>` markup, then a module script with the page's `webloader` code)
// and `main.js` (that code building the `.blp`); NativeScript as `views/<name>.xml` (the
// template), `app.ts` (the page's `nativescriptloader` code) and `app.ts` again building the
// `.blp`. The More menu lists them as a section of one row per file. The only place the result
// exists is `website/dist`, so that is what this reads, after `docs:build`, in the job that
// builds the site.
//
// WHAT IT CHECKS
//
//   1. For every `<AdwWidget … blueprint="…">` block of `website/src/content/docs/`, the built
//      page's `webloader` and `nativescriptloader` panes hold EXACTLY the files
//      `blueprint-panes.mjs` composes from the page's own slot code and the markup
//      `sharedTreeHtml` / `sharedTreeNativeScriptXml` render from the `.blp` — parsed and
//      projected HERE, with `@gjsify/blueprint`, not read back off the page: the same roles in
//      the same order, each file's code byte for byte, the More menu's SECTION naming the binding
//      and listing one row per file by its label, and the first file the one shown. A block whose
//      markup went missing or stale, a file dropped, renamed or reordered, or a composition the
//      component stopped applying, fails by block, binding and file.
//   2. Every `.blp` under `website/src/blueprints/` is in `GALLERY_BLUEPRINTS` of both round-trip
//      specs — `adwaita-web/src/blueprint-markup.spec.ts` (the markup parsed by the browser) and
//      `adwaita-nativescript/src/blueprint-markup.spec.ts` (the XML through NativeScript's XML
//      parser) — because a test bundle cannot glob, and a `.blp` added without its import
//      would be shown on the site and loaded by nothing.
//
// NEEDS: an installed workspace (`@gjsify/blueprint` reads the `@girs/*` vocabularies) and a
// built site plus `@gjsify/adwaita-core`'s `lib/` — both of which `docs:build` produces.
//
// Usage: node scripts/check-website-blueprint-markup.mjs [--dist website/dist]

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { BLUEPRINT_PANE_FILES } from '../website/src/components/blueprint-panes.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const distArg = process.argv.indexOf('--dist');
const DIST = join(ROOT, distArg === -1 ? 'website/dist' : process.argv[distArg + 1]);
const DOCS = join(ROOT, 'website/src/content/docs');
const BLUEPRINTS = join(ROOT, 'website/src/blueprints');
const SPECS = [
    'packages/web/adwaita-web/src/blueprint-markup.spec.ts',
    'packages/nativescript-bridge/adwaita/src/blueprint-markup.spec.ts',
];

// Imported by FILE, not by package name: the two are what this repository's own checkout
// builds, and a hoisted `node_modules` link may point somewhere else.
const MARKUP = join(ROOT, 'packages/web/adwaita-core/lib/esm/markup.js');
if (!existsSync(MARKUP)) {
    console.error(`${relative(ROOT, MARKUP)} is not built. Build the site first (gjsify run docs:build).`);
    process.exit(1);
}
const { sharedTreeHtml, sharedTreeNativeScriptXml } = await import(pathToFileURL(MARKUP).href);
const { gtypeName, parseBlueprint, projectToSharedNode } = await import(
    pathToFileURL(join(ROOT, 'packages/infra/blueprint/src/index.mjs')).href
);

/** Each pane, and the markup its files are composed from. */
const PANES = [
    { id: 'webloader', markup: sharedTreeHtml },
    { id: 'nativescriptloader', markup: sharedTreeNativeScriptXml },
];

const failures = [];

const walk = (dir, ext) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
            ? walk(join(dir, entry.name), ext)
            : entry.name.endsWith(ext)
              ? [join(dir, entry.name)]
              : [],
    );

/** `adwaita/layout.mdx` -> `adwaita/layout/index.html`, `adwaita/index.mdx` -> `adwaita/index.html`. */
const pageOf = (mdx) => {
    const slug = relative(DOCS, mdx).replace(/\.mdx?$/, '');
    return join(DIST, slug.endsWith('index') ? `${slug}.html` : `${slug}/index.html`);
};

/** What Expressive Code writes into `data-code`: newlines as U+007F, numeric entities. */
const decodeDataCode = (value) =>
    value
        .replaceAll('\u007f', '\n')
        .replaceAll(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
        .replaceAll(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(Number(dec)));

/** What Astro writes into an attribute value: `&`, `"` and `<` as named entities. */
const decodeAttribute = (value) =>
    value.replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');

/**
 * The More menu's rows for the FILES of a binding, in the order the menu lists them.
 *
 * A binding whose program is several files is a SECTION of the menu — a dim heading, then one
 * row per file — and each of those rows carries `data-pane` (the binding) and `data-file-role`
 * (the file within it). A single-file binding is one row with no `data-file-role`, so it is no
 * row here.
 *
 * The menu is the window's LAST child, so its body is the window's own tail; the page chrome
 * after the last window carries no `data-file-role` and contributes nothing.
 */
const MENU_ROW = /<button\b([^>]*)>([\s\S]*?)<\/button>/g;

const menuRowsOf = (window) => {
    const at = window.indexOf('<div class="adw-widget-menu"');
    // A window with no menu has no file rows, and `slice(-1)` would read the page around it.
    if (at === -1) return [];
    const rows = [];
    for (const [, attributes, text] of window.slice(at).matchAll(MENU_ROW)) {
        const role = decodeAttribute(/\bdata-file-role="([^"]*)"/.exec(attributes)?.[1] ?? '');
        if (role === '') continue;
        rows.push({
            pane: decodeAttribute(/\bdata-pane="([^"]*)"/.exec(attributes)?.[1] ?? ''),
            role,
            // The check span is decoration; the row's own text is the file's name.
            label: decodeAttribute(text.replace(/<[^>]*>/g, '')).trim(),
        });
    }
    return rows;
};

/** The files of one pane as the built page holds them: the menu's rows and the panels. */
const filesOf = (page, pane, rows) => {
    const starts = [...page.matchAll(/<div class="adw-widget-file[^"]*"([^>]*)>/g)];
    const panels = starts.map((start, index) => {
        const body = page.slice(start.index, starts[index + 1]?.index ?? page.length);
        const code = /data-code="([^"]*)"/.exec(body);
        return {
            role: decodeAttribute(/\bdata-file-role="([^"]*)"/.exec(start[1])?.[1] ?? ''),
            shown: /\bdata-active\b/.test(start[1]),
            code: code === null ? null : decodeDataCode(code[1]),
        };
    });
    return { rows: rows.filter((row) => row.pane === pane), panels };
};

/**
 * Each built source window that holds a loader binding: the pane ids and each pane's files, in
 * order. The panes are the window's tab panels (`data-pane`), the More menu's among them.
 */
const loaderWindows = (html) => {
    const windows = [];
    const starts = [...html.matchAll(/<div class="command-tabs adw-widget-window adw-widget-code-window/g)];
    for (const [index, start] of starts.entries()) {
        const end = starts[index + 1]?.index ?? html.length;
        const window = html.slice(start.index, end);
        const panes = window.split('<div class="adw-widget-pane"').slice(1);
        const ids = panes.map((pane) => /\bdata-pane="([^"]*)"/.exec(pane)?.[1] ?? '');
        if (!PANES.some((pane) => ids.includes(pane.id))) continue;
        const rows = menuRowsOf(window);
        windows.push({ ids, files: panes.map((pane, at) => filesOf(pane, ids[at], rows)) });
    }
    return windows;
};

/** Every way `shown` differs from the files `expected`, as lines naming the file. */
const fileDifferences = (shown, expected) => {
    const problems = [];
    const want = expected.map((file) => file.role).join(', ');
    const rowRoles = shown.rows.map((row) => row.role).join(', ');
    const panelRoles = shown.panels.map((panel) => panel.role).join(', ');
    if (rowRoles !== want) problems.push(`the menu section lists ${rowRoles || 'nothing'}, expected ${want}`);
    if (panelRoles !== want) problems.push(`the files are ${panelRoles || 'none'}, expected ${want}`);
    for (const [at, file] of expected.entries()) {
        const row = shown.rows[at];
        if (row !== undefined && row.label !== file.label) {
            problems.push(`file ${at + 1} is labelled "${row.label}", expected "${file.label}"`);
        }
        const panel = shown.panels.find((candidate) => candidate.role === file.role);
        if (panel === undefined) continue;
        if (panel.shown !== (at === 0)) {
            problems.push(`${file.label} is ${panel.shown ? '' : 'not '}the file shown first`);
        }
        if (panel.code !== file.source) {
            problems.push(
                `${file.label} is not what ${file.role === 'markup' ? 'the .blp renders to' : 'the page composes'}.\n` +
                    `        shown:\n${(panel.code ?? '(no code block)').replace(/^/gm, '          ')}\n` +
                    `        expected:\n${file.source.replace(/^/gm, '          ')}`,
            );
        }
    }
    return problems;
};

/** The body of the one fence inside `<Fragment slot="…">`, de-indented as MDX does. */
const slotFence = (block, slot) => {
    const fragment = new RegExp(`<Fragment slot="${slot}">([\\s\\S]*?)</Fragment>`).exec(block);
    if (fragment === null) return null;
    const lines = fragment[1].split('\n');
    const open = lines.findIndex((line) => /^\s*```\w+/.test(line));
    if (open === -1) return null;
    const indent = /^\s*/.exec(lines[open])[0].length;
    const close = lines.findIndex((line, at) => at > open && /^\s*```\s*$/.test(line));
    return lines
        .slice(open + 1, close)
        .map((line) => line.slice(Math.min(indent, /^\s*/.exec(line)[0].length)))
        .join('\n');
};

// --- 1. every one-Blueprint block shows the composed panes ---
let blocks = 0;
for (const mdx of walk(DOCS, '.mdx')) {
    const source = readFileSync(mdx, 'utf8');
    const authored = [...source.matchAll(/<AdwWidget\b[^>]*\bblueprint="([^"]+)"[^>]*>([\s\S]*?)<\/AdwWidget>/g)].map(
        (match) => ({
            title: /\btitle="([^"]+)"/.exec(match[0])?.[1] ?? '(untitled)',
            blueprint: match[1],
            body: match[2],
        }),
    );
    if (authored.length === 0) continue;
    const page = pageOf(mdx);
    if (!existsSync(page)) {
        failures.push(`${relative(ROOT, mdx)}: no built page at ${relative(ROOT, page)}`);
        continue;
    }
    const windows = loaderWindows(readFileSync(page, 'utf8'));
    if (windows.length !== authored.length) {
        failures.push(
            `${relative(ROOT, page)}: ${authored.length} one-Blueprint block(s) in the page source, ` +
                `${windows.length} window(s) with a loader pane on the built page`,
        );
        continue;
    }
    for (const [index, block] of authored.entries()) {
        blocks += 1;
        const file = join(BLUEPRINTS, block.blueprint);
        const { node, lost } = projectToSharedNode(parseBlueprint(readFileSync(file, 'utf8'), file), { gtypeName });
        if (lost.length > 0) {
            failures.push(`${block.title}: ${block.blueprint} projects with losses; the site build refuses it too`);
            continue;
        }
        const window = windows[index];
        for (const pane of PANES) {
            const access = slotFence(block.body, pane.id);
            const at = window.ids.indexOf(pane.id);
            const shown = at === -1 ? undefined : window.files[at];
            if (access === null) {
                failures.push(`${block.title}: the page writes no "${pane.id}" fence`);
                continue;
            }
            if (shown === undefined) {
                failures.push(`${block.title}: the built window has no "${pane.id}" pane`);
                continue;
            }
            let expected;
            try {
                expected = BLUEPRINT_PANE_FILES[pane.id]({
                    markup: pane.markup(node),
                    access,
                    file: block.blueprint.split('/').pop(),
                    tree: node,
                });
            } catch (error) {
                failures.push(`${block.title}: the "${pane.id}" slot cannot be composed: ${error.message}`);
                continue;
            }
            for (const problem of fileDifferences(shown, expected)) {
                failures.push(`${block.title}, "${pane.id}" pane: ${problem}`);
            }
        }
    }
}
if (blocks === 0) failures.push('no one-Blueprint block found under website/src/content/docs — the scan is broken');

// --- 2. every .blp is loaded by both round-trip specs ---
const blps = walk(BLUEPRINTS, '.blp').map((file) => relative(BLUEPRINTS, file));
for (const spec of SPECS) {
    const text = readFileSync(join(ROOT, spec), 'utf8');
    for (const blp of blps) {
        if (!text.includes(`'${blp}':`) || !text.includes(`website/src/blueprints/${blp}?shared-tree'`)) {
            failures.push(`${spec}: ${blp} is not imported and listed in GALLERY_BLUEPRINTS`);
        }
    }
}

if (failures.length > 0) {
    console.error(`check-website-blueprint-markup: ${failures.length} failure(s)\n`);
    for (const failure of failures) console.error(`  ✗ ${failure}`);
    process.exit(1);
}
console.log(
    `check-website-blueprint-markup: ${blocks} one-Blueprint block(s) list their generated markup and ` +
        `composed files in the More menu of both port bindings; ${blps.length} .blp file(s) are loaded by both ` +
        'round-trip specs.',
);
