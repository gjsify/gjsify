#!/usr/bin/env node
// Every icon name a NativeScript-facing surface emits is in the port's compiled subset.
//
// WHY THIS EXISTS AS A SECOND GATE. `check-adwaita-icon-masks.mjs` holds the same claim
// for the WEB pillar and its header used to list the NativeScript port among the things
// deliberately out of scope, with a reason: "its `GtkImage` takes SVG SOURCE, not a name,
// so a missing icon there is a missing import the compiler already rejects". That reason
// died the day `packages/nativescript-bridge/adwaita/src/widgets/icon-theme.ts` landed. A
// name is now a STRING, the compiler has nothing to say about it, and an unresolvable one
// draws the `image-missing` glyph — visible, but not what was asked for, and nothing else
// in this repository can see the difference.
//
// It is a second gate rather than a second pillar inside the first one because the two
// pillars' INPUTS are not the same shape: the web map is a data-URI generator in an
// `.mjs` build script and its `.mdx` corpus is read for `=`-form attributes only —
// precisely because colon-form `iconName:` belongs to another renderer. Here it is a
// `Record` in a `.ts` module, and colon-form inside a `<Fragment slot="nativescript">`
// is exactly what has to be read. One gate over both would spend more on branching
// between them than the ~80 shared lines of directory walking are worth.
//
// WHAT IT CHECKS, IN BOTH DIRECTIONS, and the reason each direction is load-bearing:
//
//   1. A name a NativeScript surface EMITS is a key of `COMPILED_ICONS`. Without this a
//      pane on the website can name any glyph in the theme — `weather-clear-symbolic` is
//      in `@gjsify/adwaita-icons`, `check-doc-fences.mjs` is happy with it, and the
//      reader who copies the line gets a broken-image box. That is the same class the
//      web gate's own incident describes, one renderer over.
//
//   2. A key of `COMPILED_ICONS` is emitted by one of them. This is the arm that makes
//      the SIZE argument in that module's header enforceable rather than aspirational.
//      An entry costs of the order of 900 bytes of every NativeScript app's bundle — a
//      bundler cannot tree-shake a property out of an object literal, so the map is
//      all-or-nothing — and the whole point of a subset is that it stays a subset. Seven
//      of the current entries exist only because a storybook control offers them.
//
//   3. A key's glyph is the export the KEY DERIVES (`list-add` → `listAddSymbolic`),
//      imported from `@gjsify/adwaita-icons`. Arms 1 and 2 are blind to a key whose value
//      is some OTHER icon: it resolves, it reports available, and it draws the wrong
//      picture. Measured instances of exactly that shipped on the web renderer and in
//      three of this port's own panes — `view-grid` drawn for `view-paged-symbolic`,
//      `preferences-system` for `emblem-system-symbolic`. The derivation is the icon
//      generator's own rule, so this also pins the two renderers to one meaning for one
//      name: both resolve through `normalizeIconName` and both key on the same spelling.
//
// SCOPE. `SOURCES` is every shipping surface that reaches an icon property of this port,
// each entry saying why it is on the list; a surface missing from it is a hole, not a
// decision. Deliberately out:
//   • the PORT'S OWN CHROME GLYPHS — a combo row's `pan-down`, a spin row's
//     `value-increase`, a split button's arrow, the preferences dialog's `window-close`.
//     They are imported at their point of use and no caller names them, so they are not
//     in the subset and must not be demanded of it. This is why the port's own source is
//     read for NAMES only and `icon-theme.ts` itself is skipped: reading the map would
//     make arm 2 vacuous.
//   • `*.spec.ts` and the conformance vectors. A fixture must not buy a shipped byte —
//     the same rule, and the same wording, the web gate reached first.
//   • the GJS, Blueprint, web and React Native panes of a gallery block. Those name
//     icons their own renderer resolves; `Gtk.IconTheme` reads the system theme.
//
// Usage: node scripts/check-nativescript-icon-names.mjs [--root <dir>]

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CODE_SOURCE_EXTENSIONS } from '../packages/infra/manifest-conformance/lib/source-extensions.mjs';
import { toPosixPath } from '../packages/infra/manifest-conformance/lib/index.mjs';
import { stripComments } from '../packages/infra/manifest-conformance/lib/strip-comments.mjs';

const args = process.argv.slice(2);
const rootFlag = args.indexOf('--root');
const ROOT = rootFlag === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : args[rootFlag + 1];

const ICON_THEME = join(ROOT, 'packages/nativescript-bridge/adwaita/src/widgets/icon-theme.ts');
const LEDGER = join(ROOT, 'status/nativescript-icon-names.json');

/** Shortest reason that can plausibly name the surface and say what it draws instead. */
const MIN_REASON = 40;

/** The property/field names that carry an icon NAME into a widget of this port. */
const KEYS = ['icon', 'iconName', 'startIconName', 'endIconName', 'defaultIcon', 'indicatorIcon', 'peekIconName'];
const KEY_ALT = KEYS.join('|');

/** `iconName: 'go-next-symbolic'` / `x.iconName = 'go-next-symbolic'` — the TS forms. */
const JS_ASSIGN = new RegExp(`(?:^|[^A-Za-z0-9_$-])(?:${KEY_ALT})\\s*[:=]\\s*(['"\`])([^'"\`]*)\\1`, 'g');
/** `iconName="go-next-symbolic"` — the XML-template attribute form. */
const ATTR = new RegExp(`(?:^|[^A-Za-z0-9_$-])(?:${KEY_ALT})=(['"])([^'"]*)\\1`, 'g');
/**
 * A name held in a SCREAMING_SNAKE constant, so no {@link KEYS} spelling appears at the
 * point of use — `AVATAR_DEFAULT_ICON = 'avatar-default-symbolic'`. The declaration is
 * where it reads, the same key shape the web gate had to grow for `view-reveal`.
 */
const ICON_CONST = /(?:^|[^A-Za-z0-9_$])[A-Z][A-Z0-9_]*ICON(?:_NAME)?\s*=\s*(['"`])([^'"`]*)\1/g;
/** `setPageIcon('overview', 'view-paged-symbolic')` — the id-then-icon method shape. */
const SET_PAGE_ICON = /set(?:Page|Indicator)Icon\(\s*[^,)]*,\s*(['"`])([^'"`]*)\1/g;
/** `value: 'camera-photo-symbolic'` inside a story control — see {@link metaControlNames}. */
const CONTROL_VALUE = /(?:^|[^A-Za-z0-9_$])(?:value|defaultValue):\s*(['"`])([^'"`]*)\1/g;
/** The control whose values ARE icon names: its own `name` says so. */
const ICON_CONTROL = /name:\s*['"`][^'"`]*[Ii]con[^'"`]*['"`]/g;

/**
 * The icon names an icon CONTROL offers.
 *
 * ONE meta drives all three renderings, so an icon control's option values are names the
 * NATIVESCRIPT story sets when a reader picks one — which is why seven of the compiled
 * entries exist and nothing else names them. A meta is data, so the control object is
 * found by its own `name:` mentioning "icon" and read to its matching brace: the values
 * of a `label` or `text` control are prose and must not be read as icon names.
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

const SHAPES = {
    js: (code, add) => {
        for (const m of code.matchAll(JS_ASSIGN)) add(m[2]);
        for (const m of code.matchAll(ICON_CONST)) add(m[2]);
        for (const m of code.matchAll(SET_PAGE_ICON)) add(m[2]);
    },
    attr: (code, add) => {
        for (const m of code.matchAll(ATTR)) add(m[2]);
    },
    /** The same JS shapes, but ONLY inside a `<Fragment slot="nativescript">` fence. */
    nativescriptFence: (code, add) => {
        for (const chunk of nativescriptSlots(code)) SHAPES.js(chunk, add);
    },
    metaControl: (code, add) => {
        for (const name of metaControlNames(code)) add(name);
    },
};

const ALL_SHAPES = ['js', 'attr'];

const SOURCES = [
    {
        // The port itself: its substitutions (`ICON_FALLBACK_NAME`, the avatar default,
        // the password row's peek pair) are names it hands to its own widgets, so they
        // are exactly what the subset has to carry.
        root: 'packages/nativescript-bridge/adwaita/src',
        shapes: ALL_SHAPES,
        // The map is the CLAIM, not the corpus. Specs are fixtures (header).
        skipFile: ['icon-theme.ts', /\.spec\.ts$/],
    },
    {
        // The NativeScript storybook RENDERER — a published package that builds its own
        // chrome out of this port's widgets.
        root: 'packages/nativescript-bridge/storybook/src',
        shapes: ALL_SHAPES,
        skipFile: [/\.spec\.ts$/],
    },
    {
        // The two shipping NativeScript apps: the storybook showcase (one story per
        // widget, driven by the shared metas) and the gallery probe the website's XML tab
        // is generated from.
        root: 'showcases/dom/adwaita-storybook-nativescript',
        shapes: ALL_SHAPES,
        skipDir: ['node_modules', 'platforms'],
    },
    {
        root: 'showcases/dom/adwaita-gallery-nativescript/app',
        shapes: ALL_SHAPES,
        skipDir: ['node_modules'],
    },
    {
        // The ONE source the gallery's XML templates are emitted from — read here rather
        // than the generated `.xml`, so a name is caught where it is authored.
        root: 'scripts',
        shapes: ALL_SHAPES,
        only: ['adwaita-gallery-ns-templates.mjs'],
    },
    {
        // The renderer-neutral substitutions this port hands STRAIGHT to a widget now
        // that it resolves names: the password row's reveal/conceal pair, and the view
        // switcher's `image-missing` for a NULL icon. The literals live in the core
        // because both renderers read them — the web gate lists this root for the same
        // reason, one renderer over.
        root: 'packages/web/adwaita-core/src',
        shapes: ['js'],
        skipDir: ['conformance'],
        skipFile: [/\.spec\.ts$/],
    },
    {
        // The story METAS, which are renderer-agnostic and drive the NativeScript stories
        // as well as their GTK and browser twins: an icon control's option values are
        // names a reader can pick, so every one of them has to draw.
        root: 'showcases/gtk/adwaita-storybook/src',
        shapes: ['metaControl'],
        only: [/\.meta\.ts$/],
    },
    {
        // The website: the `nativescript` fences ONLY. Every other pane on the same page
        // names icons for a renderer with its own contract, and judging them against this
        // subset is how a GTK pane would be failed for naming a system-theme icon.
        root: 'website/src/content/docs',
        shapes: ['nativescriptFence'],
    },
];

const EXTENSIONS = [...CODE_SOURCE_EXTENSIONS.map((ext) => `.${ext}`), '.xml', '.mdx'];

/** `normalizeIconName` from `@gjsify/adwaita-core`, in the spelling a script can read. */
const ICON_NAME_TOKEN = /^[A-Za-z0-9_-]+$/;
function normalizeIconName(icon) {
    const base = (icon ?? '').replace(/-symbolic$/, '');
    return ICON_NAME_TOKEN.test(base) ? base : '';
}

/** `list-add` → `listAddSymbolic` — the icon generator's own rule (arm 3's oracle). */
function exportNameFor(icon) {
    return `${icon.replace(/-([a-z0-9])/g, (_all, char) => char.toUpperCase())}Symbolic`;
}

/**
 * The bodies of every `<Fragment slot="nativescript">` on a page, concatenated.
 *
 * Line-based and brace-free on purpose: a fence body is indented markdown inside JSX, so
 * there is no expression to parse, and the only question is which slot a line sits in.
 * The same read `check-doc-fences.mjs` makes, and for the same reason — the page carries
 * four renderers' snippets and only one of them answers to this subset.
 */
function nativescriptSlots(page) {
    const chunks = [];
    let current = null;
    for (const line of page.split('\n')) {
        const open = /<Fragment\s+slot="(\w+)"/.exec(line);
        if (open) {
            current = open[1] === 'nativescript' ? [] : null;
            continue;
        }
        if (/<\/Fragment>/.test(line)) {
            if (current) chunks.push(current.join('\n'));
            current = null;
            continue;
        }
        if (current) current.push(line);
    }
    if (current) chunks.push(current.join('\n'));
    return chunks;
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
            if (
                source.only &&
                !source.only.some((s) => (typeof s === 'string' ? entry.name === s : s.test(entry.name)))
            )
                continue;
            if (source.skipFile?.some((s) => (typeof s === 'string' ? entry.name === s : s.test(entry.name)))) continue;
            found.push(path);
        }
    };
    walk(base);
    return found;
}

/**
 * Every emitted name mapped to the files that emit it, plus how many names each SHAPE
 * contributed.
 *
 * THE SHAPE TALLY IS A DISCRIMINATOR, not a statistic — the web gate learned this the
 * expensive way: its `createIcon` shape spelled a helper name that a rename had retired,
 * so that arm scanned NOTHING while the gate printed the same counts and exited 0.
 * A shape that matches nowhere is the only observable separating "this spelling is absent
 * from the tree" from "this reader is broken", and it cannot be read off the name set.
 */
function emittedNames() {
    const emitted = new Map();
    const shapeHits = new Map(Object.keys(SHAPES).map((shape) => [shape, 0]));
    for (const source of SOURCES) {
        for (const file of filesUnder(source)) {
            const raw = readFileSync(file, 'utf8');
            for (const shape of source.shapes) {
                // Comments are stripped, or a doc comment naming an icon registers it as
                // emitted — `icon-theme.ts`' own header would demand half the barrel.
                // An `.mdx` is stripped too: its fences are TypeScript.
                const code = stripComments(raw);
                const add = (value) => {
                    shapeHits.set(shape, shapeHits.get(shape) + 1);
                    const name = normalizeIconName(value);
                    // `''` is what the port reads as "no icon", and an unusable string
                    // draws the fallback by design — neither demands an entry.
                    if (name === '') return;
                    if (!emitted.has(name)) emitted.set(name, new Set());
                    emitted.get(name).add(toPosixPath(relative(ROOT, file)));
                };
                SHAPES[shape](code, add);
            }
        }
    }
    return { emitted, shapeHits };
}

/** The keys of `COMPILED_ICONS`, and the binding each maps to, from committed source. */
function compiledIcons() {
    const source = readFileSync(ICON_THEME, 'utf8');
    const open = source.indexOf('const COMPILED_ICONS');
    if (open === -1) {
        process.stderr.write(
            `check-nativescript-icon-names: no \`const COMPILED_ICONS\` in ` +
                `${toPosixPath(relative(ROOT, ICON_THEME))}\n`,
        );
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
    return new Map([...body.matchAll(/^ {4}'?([a-z0-9-]+)'?:\s*([A-Za-z_$][\w$]*)\s*,/gm)].map((m) => [m[1], m[2]]));
}

/** Every binding `icon-theme.ts` imports from `@gjsify/adwaita-icons`. */
function vendoredGlyphs() {
    const source = readFileSync(ICON_THEME, 'utf8');
    const names = new Set();
    for (const block of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*'@gjsify\/adwaita-icons[^']*'/g)) {
        for (const spec of block[1].split(',')) {
            const local = spec
                .trim()
                .split(/\s+as\s+/)
                .pop()
                ?.trim();
            if (local) names.add(local);
        }
    }
    return names;
}

const { emitted, shapeHits } = emittedNames();
const compiled = compiledIcons();
const vendored = vendoredGlyphs();

/**
 * The fallback name is emitted BY CONSTRUCTION, and reading it off the module is what
 * keeps that honest.
 *
 * `resolveIconSource` substitutes it for every unresolvable name, so its entry is
 * load-bearing no matter what any surface writes — but the only literal is in
 * `icon-theme.ts`, which is skipped as a source precisely so that reading the map cannot
 * make arm 2 vacuous. A ledger exemption would say "reviewed" for something that is a
 * RULE, so the rule is stated here instead: the name is taken from the module's own
 * `ICON_FALLBACK_NAME`, so renaming the constant moves this with it, and DELETING it
 * fails arm 2 for the entry rather than passing quietly.
 */
const fallback = /ICON_FALLBACK_NAME = '([a-z0-9-]+)'/.exec(readFileSync(ICON_THEME, 'utf8'))?.[1];
if (fallback === undefined) {
    process.stderr.write(
        "check-nativescript-icon-names: no `ICON_FALLBACK_NAME = '…'` in the icon theme — the " +
            'substitution every unresolvable name relies on cannot be identified.\n',
    );
    process.exit(1);
}
emitted.set(normalizeIconName(fallback), new Set(['icon-theme.ts (the substitution for an unresolvable name)']));

/** Every name in an unhappy state, mapped to what is unhappy about it. */
const problems = new Map();
const note = (name, message) => problems.set(name, [...(problems.get(name) ?? []), message]);

for (const name of [...emitted.keys()].sort()) {
    if (compiled.has(name)) continue;
    note(
        name,
        `is emitted by ${[...emitted.get(name)].sort().join(', ')} and COMPILED_ICONS has no ` +
            'entry, so it draws the image-missing fallback',
    );
}

for (const [name, glyph] of compiled) {
    if (!emitted.has(name)) {
        note(name, 'is in COMPILED_ICONS and nothing emits it — every entry is in every NativeScript bundle');
    }
    const expected = exportNameFor(name);
    if (glyph !== expected) {
        note(name, `is drawn from \`${glyph}\` where the name derives \`${expected}\` — the icon would be wrong`);
    }
    if (!vendored.has(glyph)) {
        note(name, `is drawn from a local \`${glyph}\`, not imported from @gjsify/adwaita-icons`);
    }
}

const ledger = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')) : { reviewed: {} };
const reviewed = ledger.reviewed ?? {};
const listed = new Set(Object.keys(reviewed));

const failures = [];

// A shape that reads nothing is a broken reader, not an absent spelling. No exemption
// list: a shape nothing spells any more is a shape to DELETE, and that is one line.
for (const [shape, hits] of shapeHits) {
    if (hits === 0) {
        failures.push(
            `the \`${shape}\` shape matched nothing in any of the ${SOURCES.length} sources — it reads a ` +
                'spelling the tree no longer has, so that whole arm is scanning nothing. Repair the regex ' +
                'in SHAPES, or delete the shape and the sources that name it',
        );
    }
}

for (const [name, messages] of problems) {
    if (listed.has(name)) continue;
    for (const message of messages) failures.push(`${name} ${message}.`);
}

// The ratchet: an entry whose situation has resolved has to leave the ledger, or it keeps
// claiming an exemption for a state that no longer exists.
for (const name of listed) {
    if (!problems.has(name)) {
        failures.push(`${name} is listed, but nothing about it needs an exemption any more — remove the entry.`);
    } else if (typeof reviewed[name] !== 'string' || reviewed[name].trim().length < MIN_REASON) {
        failures.push(`${name} is listed with no real reason — say what draws it instead, or why nothing needs to.`);
    }
}

process.stdout.write(
    `check-nativescript-icon-names: ${emitted.size} icon name(s) emitted across ${SOURCES.length} surface(s), ` +
        `${compiled.size} compiled into the port, ${Object.keys(reviewed).length} reviewed exemption(s).\n`,
);

if (failures.length > 0) {
    process.stderr.write(`\ncheck-nativescript-icon-names: ${failures.length} problem(s):\n\n`);
    for (const failure of failures) process.stderr.write(`  - ${failure}\n`);
    process.stderr.write(
        `\nAn icon NAME and the glyph the port compiles for it are two halves of one decision.\n` +
            `A name with no entry applies correctly and draws image-missing, which is visible but\n` +
            `still not what the snippet promised — and on this renderer no compiler sees it.\n` +
            `  To make a name resolve, add it to COMPILED_ICONS in\n` +
            `  packages/nativescript-bridge/adwaita/src/widgets/icon-theme.ts, importing the glyph\n` +
            `  the name derives. Every entry is in every NativeScript bundle — the header carries\n` +
            `  the measurement.\n` +
            `  To retire one, delete the entry and whatever still names it.\n` +
            `  A consumer's OWN glyph needs no entry: pass the SVG source, or registerIcon() it.\n` +
            `  If the situation is deliberate, add the name to "reviewed" in\n` +
            `  ${toPosixPath(relative(ROOT, LEDGER))} with the reason.\n`,
    );
    process.exit(1);
}

process.exit(0);
