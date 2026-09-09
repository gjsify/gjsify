#!/usr/bin/env node
// The GTK bundle and the web stylesheet compile the SAME icon names.
//
// WHY THIS IS A GATE AND NOT A COMMENT. Three renderers now promise the same thing about
// the same property: `icon-name: 'list-add-symbolic'` draws the Adwaita glyph, whatever
// the host has installed. `@gjsify/adwaita-web` keeps its subset in `build-scss.mjs`'s
// `ICONS` map, `@gjsify/adwaita-app` keeps the GTK one in
// `scripts/build-icon-gresource.mjs`' `SUBSET`, and the NativeScript port keeps a third.
// A promise made by three independently-edited lists is a promise that holds until
// somebody adds an icon to one of them — and the failure is silent on two renderers out
// of three, because each is individually correct.
//
// So the GTK bundle does not CHOOSE a subset: it takes the web pillar's, and this gate is
// what makes "takes" true. Adding an icon to `build-scss.mjs` fails here until the GTK
// bundle carries it too, which is one line, and removing one fails the same way.
//
// It reads committed SOURCE and neither installs nor builds, so it runs in
// `audit-runtimes.yml` beside `check-adwaita-icon-masks.mjs`, whose corpus is the same
// map read for a different question (which names the web renderer EMITS, in both
// directions). This one only compares the two compiled sets.
//
// Usage: node scripts/check-bundled-icon-parity.mjs [--root <dir>]

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { toPosixPath } from '../packages/infra/manifest-conformance/lib/index.mjs';
import { stripComments } from '../packages/infra/manifest-conformance/lib/strip-comments.mjs';

const args = process.argv.slice(2);
const rootFlag = args.indexOf('--root');
const ROOT = rootFlag === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : args[rootFlag + 1];

const WEB_MAP = join(ROOT, 'packages/web/adwaita-web/scripts/build-scss.mjs');
const GTK_MAP = join(ROOT, 'packages/framework/adwaita-app/scripts/build-icon-gresource.mjs');
const ICONS_PKG = join(ROOT, 'packages/web/adwaita-icons');

/**
 * Names the web pillar compiles that the GTK bundle deliberately does NOT, each with the
 * reason. An entry whose situation has resolved fails, the way every ledger here does.
 */
const GTK_EXCLUSIONS = {
    'view-columns': {
        why:
            'In no icon theme at all and not an @gjsify/adwaita-icons export — `find /usr/share/icons/Adwaita ' +
            '-name "view-columns*"` returns nothing. build-scss.mjs HAND-DRAWS a 3-column glyph so the web pane ' +
            'is not the odd one out; bundling that drawing here would make GTK the second renderer with a ' +
            'private icon, which is the trade status/adwaita-web-icon-masks.json already argues against in the ' +
            'other direction. GTK draws its broken-image paintable for this name, exactly as it does today.',
        // The gate can check this half itself: if adwaita-icons ever exports it, the
        // exclusion is over.
        untilExportedAs: 'viewColumnsSymbolic',
    },
};

/** Shortest reason that can plausibly say why a name is out. */
const MIN_REASON = 80;

/** Keys of a `const <NAME> = {` object literal in an .mjs source, comments stripped. */
function objectKeys(file, declaration) {
    const source = readFileSync(file, 'utf8');
    const open = source.indexOf(declaration);
    if (open === -1) {
        process.stderr.write(`check-bundled-icon-parity: no \`${declaration}\` in ${rel(file)}\n`);
        process.exit(1);
    }
    const start = source.indexOf('{', open);
    let depth = 0;
    let end = start;
    for (; end < source.length; end++) {
        if (source[end] === '{') depth++;
        else if (source[end] === '}' && --depth === 0) break;
    }
    const body = stripComments(source.slice(start, end));
    return new Set([...body.matchAll(/^ {4}'?([a-z0-9-]+)'?:\s*[A-Za-z_$]/gm)].map((m) => m[1]));
}

/** The `[context, name]` pairs of the GTK bundle's SUBSET array. */
function gtkSubset() {
    const source = readFileSync(GTK_MAP, 'utf8');
    const open = source.indexOf('const SUBSET = [');
    if (open === -1) {
        process.stderr.write(`check-bundled-icon-parity: no \`const SUBSET = [\` in ${rel(GTK_MAP)}\n`);
        process.exit(1);
    }
    const body = stripComments(source.slice(open, source.indexOf('\n];', open)));
    return new Map([...body.matchAll(/\['([a-z]+)',\s*'([a-z0-9-]+)'\]/g)].map((m) => [m[2], m[1]]));
}

/** Every glyph `@gjsify/adwaita-icons` exports, by export name and by subpath. */
function vendoredGlyphs() {
    const bySubpath = new Map();
    for (const file of readdirSync(ICONS_PKG)) {
        if (!file.endsWith('.ts') || ['index.ts', 'utils.ts'].includes(file)) continue;
        const subpath = file.slice(0, -3);
        for (const m of readFileSync(join(ICONS_PKG, file), 'utf8').matchAll(/^export const ([A-Za-z0-9_]+)/gm)) {
            bySubpath.set(m[1], subpath);
        }
    }
    return bySubpath;
}

const rel = (p) => toPosixPath(relative(ROOT, p));
const exportNameFor = (name) => `${name.replace(/-([a-z0-9])/g, (_a, c) => c.toUpperCase())}Symbolic`;

const web = objectKeys(WEB_MAP, 'const ICONS = {');
const gtk = gtkSubset();
const vendored = vendoredGlyphs();
const excluded = new Set(Object.keys(GTK_EXCLUSIONS));

const failures = [];

for (const name of [...web].sort()) {
    if (gtk.has(name) || excluded.has(name)) continue;
    failures.push(
        `${name} is compiled into the web stylesheet and NOT into the GTK bundle, so the same icon-name ` +
            `draws on the browser and falls back to the host theme on GTK. Add it to SUBSET in ` +
            `${rel(GTK_MAP)}, or list it in GTK_EXCLUSIONS with the reason.`,
    );
}

for (const [name, subpath] of [...gtk].sort()) {
    if (!web.has(name)) {
        failures.push(
            `${name} is in the GTK bundle and not in the web stylesheet's ICONS map — every glyph is in every ` +
                `app's GResource, and the set is the web pillar's by construction. Add it to ${rel(WEB_MAP)} or ` +
                `drop it here.`,
        );
    }
    const exportName = exportNameFor(name);
    const home = vendored.get(exportName);
    if (home === undefined) {
        failures.push(`${name} names ${exportName}, which @gjsify/adwaita-icons does not export.`);
    } else if (home !== subpath) {
        failures.push(`${name} is taken from '${subpath}' but ${exportName} lives in '${home}'.`);
    }
}

// The ratchet: an exclusion may not outlive its reason.
for (const [name, entry] of Object.entries(GTK_EXCLUSIONS)) {
    if (!web.has(name)) {
        failures.push(`${name} is excluded from the GTK bundle and the web map no longer compiles it either.`);
    }
    if (typeof entry.why !== 'string' || entry.why.trim().length < MIN_REASON) {
        failures.push(`${name} is excluded with no real reason — say what GTK draws instead.`);
    }
    if (entry.untilExportedAs && vendored.has(entry.untilExportedAs)) {
        failures.push(
            `${name} is excluded because @gjsify/adwaita-icons had no ${entry.untilExportedAs}, and it now ` +
                `does — bundle it and delete the exclusion.`,
        );
    }
}

process.stdout.write(
    `check-bundled-icon-parity: ${gtk.size} glyph(s) in the GTK bundle, ${web.size} in the web stylesheet, ` +
        `${excluded.size} declared exclusion(s).\n`,
);

if (failures.length > 0) {
    process.stderr.write(`\ncheck-bundled-icon-parity: ${failures.length} problem(s):\n\n`);
    for (const failure of failures) process.stderr.write(`  - ${failure}\n`);
    process.stderr.write(
        `\nThe three renderers promise one glyph per icon-name. The GTK bundle does not choose its\n` +
            `own subset — it takes the web pillar's — and this gate is what makes that true rather\n` +
            `than a sentence in a header.\n`,
    );
    process.exit(1);
}

process.exit(0);
