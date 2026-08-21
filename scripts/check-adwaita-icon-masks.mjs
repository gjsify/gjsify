#!/usr/bin/env node
// Every icon name a web-facing Adwaita surface emits has a mask class, or a reason.
//
// THE INCIDENT
//
// `@gjsify/adwaita-web` draws a symbolic icon as a CSS mask: `_icon.scss` gives
// `.adw-icon` a box and `background-color: currentColor`, and a generated
// `.adw-icon--<name>` class supplies the `mask-image`. The generator's input is a
// HAND-WRITTEN map in `packages/web/adwaita-web/scripts/build-scss.mjs` holding 41
// of the 644 icons `@gjsify/adwaita-icons` exports — it has to be a subset, because
// inlining all of them costs a measured 1 095 098 bytes of data-URI against a
// 190 KB stylesheet.
//
// A name outside that map used to fail SILENTLY, and in the worst possible shape:
// with no `mask-image` the box kept `background-color: currentColor` and painted a
// SOLID 16px square in the widget's text colour — read as a deliberate swatch, not
// as a missing glyph. Measured in Firefox: `.adw-icon.adw-icon--dialog-error`
// reported `mask-image: none`, `background-color: rgb(0, 128, 0)`, box 16x16, beside
// a `go-next` control whose mask was an 825-character data URI.
//
// No test could see it. `adw-icon.spec.ts` asserted that the class STRING had been
// applied — which it always had been, correctly, to nothing. What the silence bought
// was four renderer-comparison surfaces drawing a different glyph from the GTK pane
// they exist to be compared against: the browser storybook substituted `view-grid`
// for `view-paged-symbolic` under a comment blaming `@gjsify/adwaita-icons` for not
// having it (it exports `viewPagedSymbolic` at actions.ts:981 — the mask class was
// what was missing), the browser toolbar-view story and two website previews did the
// same for `folder-documents` with no note at all.
//
// WHAT IT CHECKS, IN BOTH DIRECTIONS
//
// - a name a web-facing source EMITS must be a key in the ICONS map, and
// - a key in the ICONS map must be emitted by one of them.
//
// The second arm is what makes the 1 MB constraint enforceable. Each icon costs a
// mean 1484 bytes of the shipped stylesheet, so a map that only ever grows is how
// the subset stops being a subset; `edit-paste` was already in it with nothing in
// the tree naming it. Either state can instead be listed in
// `status/adwaita-web-icon-masks.json` with a REASON, and a listed name that has
// since resolved — or that nothing emits any more — is a failure too: an exemption
// may not outlive the situation it describes.
//
// THE MAP, NOT THE GENERATED PARTIAL. `scss/_icons.generated.scss` is gitignored and
// this gate runs in `audit-runtimes.yml`, which neither installs nor builds — reading
// the artifact would make the check pass by finding nothing.
//
// SCOPE, AND WHY IT IS NARROW. Only surfaces that render THROUGH this stylesheet: the
// widgets and partials in `packages/web/adwaita-web`, the `@gjsify/adwaita-core`
// substitutions the web renderer turns into classes, the browser storybook, the story
// metas' icon control values (a control the browser story reads), and the website's
// rendered web panes. Deliberately excluded, each because its icon contract is a
// different one:
//   • a GTK story or a doc's `gjs` pane — `Gtk.IconTheme` resolves the name against
//     the SYSTEM theme, so `folder-documents-symbolic` there is correct and needs no
//     class here. This is also why a website `.mdx` is read only for `=`-form HTML
//     attributes: the same file carries GJS (`iconName: 'x-symbolic'`) and Blueprint
//     (`icon-name: "x-symbolic";`) panes, both colon-form, both about other renderers.
//   • the NativeScript port — its `AdwIcon` takes SVG SOURCE, not a name, so a
//     missing icon there is a missing import the compiler already rejects.
//   • `@gjsify/adwaita-core`'s `conformance/` tables and specs — those are
//     `normalizeIconName` VECTORS, deliberately malformed (`go_next`, `GoNext2`,
//     `go-symbolic-next`). Demanding a mask class for them would be demanding one for
//     inputs whose whole point is that they resolve to no icon.
//
// COMMENTS ARE STRIPPED FIRST, and only whole-line `//` ones — a bare `//` mid-line is
// a URL far more often than a comment. A name that appears only in prose is not
// emitted; before the strip, `adw-icon.spec.ts`' own explanation of the bug (a comment
// spelling `adw-icon--a b`) registered `a` as an emitted icon.
//
// STILL BLIND to a name assembled at runtime — `icon.iconName = someRecord.icon`, where
// no literal in the tree is the name; the two in the ledger are of that shape. The
// RUNTIME half covers it: `_icon.scss` falls back to the `image-missing` glyph, so an
// unresolvable name is visible rather than a solid block.
//
// Usage: node scripts/check-adwaita-icon-masks.mjs [--root <dir>]

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { toPosixPath } from '../packages/infra/manifest-conformance/lib/index.mjs';

const args = process.argv.slice(2);
const rootFlag = args.indexOf('--root');
const ROOT = rootFlag === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : args[rootFlag + 1];

const ICONS_MAP = join(ROOT, 'packages/web/adwaita-web/scripts/build-scss.mjs');
const LEDGER = join(ROOT, 'status/adwaita-web-icon-masks.json');

/** Shortest reason that can plausibly name the surface and say what it draws instead. */
const MIN_REASON = 40;

/**
 * The attribute/property names that carry an icon NAME into the web renderer. Every
 * one is a real attribute of an `adw-*` element or a key of a menu/page descriptor.
 */
const KEYS = [
    'icon',
    'icon-name',
    'iconName',
    'start-icon-name',
    'startIconName',
    'end-icon-name',
    'endIconName',
    'application-icon',
    'applicationIcon',
    'indicator-icon',
    'indicatorIcon',
];
const KEY_ALT = KEYS.join('|');

/** `iconName: 'go-next'` / `el.iconName = 'go-next'` — the JS/TS forms. */
const JS_ASSIGN = new RegExp(`(?:^|[^A-Za-z0-9_$-])(?:${KEY_ALT})\\s*[:=]\\s*(['"\`])([^'"\`]*)\\1`, 'g');
/** `icon="go-next"` — the markup form, and the ONLY one read in a `.mdx`/`.astro`. */
const MARKUP_ATTR = new RegExp(`(?:^|[^A-Za-z0-9_$-])(?:${KEY_ALT})=(['"])([^'"]*)\\1`, 'g');
/** `el.setAttribute('icon', 'go-next')`. */
const SET_ATTRIBUTE = new RegExp(`setAttribute\\(\\s*(['"\`])(?:${KEY_ALT})\\1\\s*,\\s*(['"\`])([^'"\`]*)\\2`, 'g');
/** `createAdwIcon('go-next', …)`. */
const CREATE_ICON = /createAdwIcon\(\s*(['"`])([^'"`]*)\1/g;
/** A hand-written `class="adw-icon adw-icon--window-close"`, as the website writes it. */
const MASK_CLASS = /adw-icon--([a-z0-9-]+)/g;
/** `mask-image: var(--icon-sidebar-show)` — a partial consuming an icon without the class. */
const CSS_VAR = /var\(\s*--icon-([a-z0-9-]+)/g;
/** `value: 'camera-photo-symbolic'` inside a story control — see {@link metaControlNames}. */
const CONTROL_VALUE = /(?:^|[^A-Za-z0-9_$])(?:value|defaultValue):\s*(['"`])([^'"`]*)\1/g;
/** The control whose values ARE icon names: its own `name` says so. */
const ICON_CONTROL = /name:\s*['"`][^'"`]*[Ii]con[^'"`]*['"`]/g;

const SHAPES = {
    js: (code, add) => {
        for (const m of code.matchAll(JS_ASSIGN)) add(m[2]);
    },
    markup: (code, add) => {
        for (const m of code.matchAll(MARKUP_ATTR)) add(m[2]);
    },
    setAttribute: (code, add) => {
        for (const m of code.matchAll(SET_ATTRIBUTE)) add(m[3]);
    },
    createIcon: (code, add) => {
        for (const m of code.matchAll(CREATE_ICON)) add(m[2]);
    },
    maskClass: (code, add) => {
        for (const m of code.matchAll(MASK_CLASS)) add(m[1]);
    },
    cssVar: (code, add) => {
        for (const m of code.matchAll(CSS_VAR)) add(m[1]);
    },
    metaControl: (code, add) => {
        for (const name of metaControlNames(code)) add(name);
    },
};

/**
 * Where each shape is read, and why that surface renders through this stylesheet.
 * `only`/`skipDir`/`skipFile` narrow a root; everything else under it is scanned.
 */
const SOURCES = [
    {
        // The widgets themselves, their specs, and the partials that mask an icon
        // without going through `<adw-icon>` at all (`_combo_row.scss`' arrow).
        root: 'packages/web/adwaita-web/src',
        shapes: ['js', 'markup', 'setAttribute', 'createIcon', 'maskClass'],
        // The compiled stylesheet, inlined as a TS string — it contains every mask
        // class by construction, so reading it would make the second arm vacuous.
        skipFile: ['styles.generated.ts'],
    },
    { root: 'packages/web/adwaita-web/scss', shapes: ['cssVar', 'maskClass'], skipFile: ['_icons.generated.scss'] },
    {
        // The renderer-neutral substitutions the web renderer turns into classes —
        // `image-missing` for a NULL name, the password row's reveal/conceal pair.
        root: 'packages/web/adwaita-core/src',
        shapes: ['js'],
        skipDir: ['conformance'],
        skipFile: [/\.spec\.ts$/],
    },
    {
        root: 'showcases/gtk/adwaita-storybook/src/browser',
        shapes: ['js', 'markup', 'setAttribute', 'createIcon', 'maskClass'],
    },
    {
        // One meta drives all three renderings, so an icon control's option values are
        // names the BROWSER story sets — `camera-photo`, `user-trash` and two more are
        // in the map for no other reason.
        root: 'showcases/gtk/adwaita-storybook/src',
        shapes: ['metaControl'],
        only: [/\.meta\.ts$/],
    },
    { root: 'website/src', shapes: ['markup', 'maskClass'] },
];

const EXTENSIONS = ['.ts', '.mts', '.scss', '.astro', '.mdx', '.html'];

/** `normalizeIconName` from `@gjsify/adwaita-core`, in the spelling a script can read. */
const ICON_NAME_TOKEN = /^[A-Za-z0-9_-]+$/;
function normalizeIconName(icon) {
    const base = (icon ?? '').replace(/-symbolic$/, '');
    return ICON_NAME_TOKEN.test(base) ? base : '';
}

/**
 * The icon names an icon CONTROL offers. A meta is data, so the control object is
 * found by its own `name:` mentioning "icon" and read to its matching brace — the
 * values of a `label`/`text` control are prose and must not be read as icon names.
 */
function metaControlNames(code) {
    const names = [];
    for (const match of code.matchAll(ICON_CONTROL)) {
        const open = code.lastIndexOf('{', match.index);
        if (open === -1) continue;
        let depth = 0;
        let end = open;
        for (; end < code.length; end++) {
            if (code[end] === '{') depth++;
            else if (code[end] === '}' && --depth === 0) break;
        }
        for (const value of code.slice(open, end).matchAll(CONTROL_VALUE)) names.push(value[2]);
    }
    return names;
}

/** Whole-line `//` and every `/* *\/` — see the header on why not mid-line `//`. */
function stripComments(code) {
    return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function filesUnder(source) {
    const found = [];
    const base = join(ROOT, source.root);
    if (!existsSync(base)) return found;
    const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const path = join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === 'node_modules') continue;
                if (source.skipDir?.includes(entry.name)) continue;
                walk(path);
                continue;
            }
            if (!EXTENSIONS.some((ext) => entry.name.endsWith(ext))) continue;
            if (source.only && !source.only.some((re) => re.test(entry.name))) continue;
            if (source.skipFile?.some((s) => (typeof s === 'string' ? entry.name === s : s.test(entry.name)))) continue;
            found.push(path);
        }
    };
    walk(base);
    return found;
}

/** Every emitted icon name, mapped to the posix-spelled files that emit it. */
function emittedNames() {
    const emitted = new Map();
    for (const source of SOURCES) {
        for (const file of filesUnder(source)) {
            const code = stripComments(readFileSync(file, 'utf8'));
            const add = (raw) => {
                const name = normalizeIconName(raw);
                // `''` is the guard's own answer for an absent or unusable name, and
                // `<adw-icon>` draws nothing for it — there is no class to demand.
                if (name === '') return;
                if (!emitted.has(name)) emitted.set(name, new Set());
                emitted.get(name).add(toPosixPath(relative(ROOT, file)));
            };
            for (const shape of source.shapes) SHAPES[shape](code, add);
        }
    }
    return emitted;
}

/** The keys of the ICONS map in `build-scss.mjs`, read from the committed source. */
function compiledNames() {
    const source = readFileSync(ICONS_MAP, 'utf8');
    const open = source.indexOf('const ICONS = {');
    if (open === -1) {
        process.stderr.write(
            `check-adwaita-icon-masks: no \`const ICONS = {\` in ${toPosixPath(relative(ROOT, ICONS_MAP))}\n`,
        );
        process.exit(1);
    }
    let depth = 0;
    let end = source.indexOf('{', open);
    const start = end;
    for (; end < source.length; end++) {
        if (source[end] === '{') depth++;
        else if (source[end] === '}' && --depth === 0) break;
    }
    const body = stripComments(source.slice(start, end));
    return new Set([...body.matchAll(/^ {4}'?([a-z0-9-]+)'?:/gm)].map((match) => match[1]));
}

const emitted = emittedNames();
const compiled = compiledNames();

const unresolved = [...emitted.keys()].filter((name) => !compiled.has(name)).sort();
const unused = [...compiled].filter((name) => !emitted.has(name)).sort();

const ledger = JSON.parse(readFileSync(LEDGER, 'utf8'));
const reviewed = ledger.reviewed ?? {};
const listed = new Set(Object.keys(reviewed));

const failures = [];

for (const name of unresolved) {
    if (listed.has(name)) continue;
    failures.push(
        `${name} — emitted by ${[...emitted.get(name)].sort().join(', ')} and the ICONS map has no entry, ` +
            'so it draws the image-missing fallback.',
    );
}

for (const name of unused) {
    if (listed.has(name)) continue;
    failures.push(`${name} is in the ICONS map and nothing emits it — every entry costs ~1.5 KB of the stylesheet.`);
}

// The ratchet: an entry whose situation has resolved has to leave the ledger, or it
// keeps claiming an exemption for a state that no longer exists.
for (const name of listed) {
    if (emitted.has(name) && compiled.has(name)) {
        failures.push(`${name} is listed, but it is now both emitted and compiled — remove the entry.`);
    } else if (!emitted.has(name) && !compiled.has(name)) {
        failures.push(`${name} is listed, but nothing emits it and nothing compiles it — remove the entry.`);
    } else if (typeof reviewed[name] !== 'string' || reviewed[name].trim().length < MIN_REASON) {
        // A placeholder entry is an unreviewed list again, one key at a time. The floor
        // is crude by design: it cannot judge a sentence, only refuse a blank.
        failures.push(`${name} is listed with no real reason — say what draws it instead, or why nothing needs to.`);
    }
}

process.stdout.write(
    `check-adwaita-icon-masks: ${emitted.size} icon name(s) emitted, ${compiled.size} compiled into the ` +
        `stylesheet, ${Object.keys(reviewed).length} reviewed exemption(s).\n`,
);

if (failures.length > 0) {
    process.stderr.write(`\ncheck-adwaita-icon-masks: ${failures.length} problem(s):\n\n`);
    for (const failure of failures) process.stderr.write(`  - ${failure}\n`);
    process.stderr.write(
        `\nAn icon name and the mask class that draws it are two halves of one decision, and no test\n` +
            `compares them — a name with no class applies its class correctly and draws the\n` +
            `image-missing fallback, which is visible but still not what was asked for.\n` +
            `  To make a name resolve, add it to ICONS in\n` +
            `  packages/web/adwaita-web/scripts/build-scss.mjs (one entry, ~1.5 KB of stylesheet).\n` +
            `  To retire one, delete that entry.\n` +
            `  If the situation is deliberate — a name a consumer registers at runtime with\n` +
            `  registerIcon(), an entry kept for a reason the tree cannot show — add it to\n` +
            `  "reviewed" in ${toPosixPath(relative(ROOT, LEDGER))} with the reason.\n`,
    );
    process.exit(1);
}

process.exit(0);
