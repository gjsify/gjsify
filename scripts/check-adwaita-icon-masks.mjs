#!/usr/bin/env node
// Every icon name a web-facing Adwaita surface emits has a mask class, or a reason.
//
// THE INCIDENT. A symbolic icon is a CSS mask, and a generated `.adw-icon--<name>` class
// supplies the `mask-image`. Its input is a HAND-WRITTEN map in
// `packages/web/adwaita-web/scripts/build-scss.mjs` — a SUBSET, because inlining all of
// `@gjsify/adwaita-icons` costs a measured ~1.07 MB of data-URI, some five times the
// stylesheet it would sit in. The run's own stdout line carries the counts.
//
// A name outside that map used to fail SILENTLY, painting a SOLID 16px square read as a
// deliberate swatch — measured in `adwaita-web/scss/_icon.scss`, beside the rule that
// ended it.
//
// No test could see it — `gtk-image.spec.ts` asserted the class STRING, which had always
// been applied, correctly, to nothing. The silence bought four renderer-comparison
// surfaces drawing a different glyph from the GTK pane they exist to be compared
// against: the browser storybook substituted `view-grid` for `view-paged-symbolic` under
// a comment blaming `@gjsify/adwaita-icons` for not having it (it exports
// `viewPagedSymbolic`, actions.ts:981 — the missing half was the mask class), and the
// toolbar-view story plus two website previews did the same for `folder-documents`.
//
// WHAT IT CHECKS, IN BOTH DIRECTIONS: a name a web-facing source EMITS must be a key in
// the ICONS map, and a key in the map must be emitted by one of them. The second arm is
// what makes the size constraint enforceable — an icon costs of the order of 1.5 KB of
// shipped stylesheet, and `edit-paste` was already in the map with nothing naming it.
// Either state can instead be listed in `status/adwaita-web-icon-masks.json` with a
// REASON; a listed name that has since resolved, or that nothing emits any more, fails
// too — an exemption may not outlive what it describes.
//
// THE MAP, NOT THE GENERATED PARTIAL. `scss/_icons.generated.scss` is gitignored and
// this gate runs in `audit-runtimes.yml`, which neither installs nor builds — reading
// the artifact would make the check pass by finding nothing.
//
// SCOPE: EVERY SHIPPING SURFACE THAT RENDERS THROUGH THIS STYLESHEET. `SOURCES` is that
// list, each entry saying why it is on it; a surface missing from it is a hole, not a
// decision. Deliberately out, each because its icon contract is a different one:
//   • a GTK story or a doc's `gjs` pane — `Gtk.IconTheme` resolves the name against the
//     SYSTEM theme, so `folder-documents-symbolic` there is correct and needs no class
//     here. This is also why a website `.mdx` is read only for `=`-form HTML attributes:
//     the same file carries GJS (`iconName: 'x-symbolic'`) and Blueprint
//     (`icon-name: "x-symbolic";`) panes, both colon-form, both about other renderers.
//   • the NativeScript port — its `AdwIcon` takes SVG SOURCE, not a name, so a missing
//     icon there is a missing import the compiler already rejects.
//   • FIXTURES: `*.spec.ts` anywhere, and adwaita-core's `conformance/` vector tables.
//     NOT because they are malformed — only `conformance/view-stack.ts` is; `action-row`
//     names `external-link-symbolic` and `split-button` names `help-about-symbolic`,
//     well formed and driving REAL widgets in the browser suite. They are out because a
//     fixture must not buy a shipped byte (arm 2), and a name a fixture merely feeds
//     through a widget is not a user-visible defect (arm 1). What one DRAWS is held at
//     runtime instead: the vector loops in `adw-action-rows.spec.ts`,
//     `adw-button-content.spec.ts` and `split-button.spec.ts` compare the computed
//     `mask-image` with `--icon-image-missing`.
//
// COMMENTS ARE STRIPPED FIRST, and only whole-line `//` ones — a bare `//` mid-line is
// a URL far more often than a comment. A name that appears only in prose is not
// emitted; before the strip, `gtk-image.spec.ts`' own explanation of the bug (a comment
// spelling `adw-icon--a b`) registered `a` as an emitted icon.
//
// STILL BLIND to a name assembled at runtime — `icon.iconName = someRecord.icon`, with
// no literal in the tree; `_icon.scss` covers that by falling back to `image-missing`.
// A name in a NAMED CONSTANT is NOT of that shape and IS read (`ICON_CONST`):
// `view-reveal`/`view-conceal` sat in the ledger claiming blindness "by construction"
// when the cause was a missing key shape — an exemption resting on a wrong cause is how
// a whole class stays unscanned.
//
// Usage: node scripts/check-adwaita-icon-masks.mjs [--root <dir>]

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CODE_SOURCE_EXTENSIONS } from '../packages/infra/manifest-conformance/lib/source-extensions.mjs';

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
/**
 * `const PASSWORD_REVEAL_ICON_NAME = 'view-reveal-symbolic'` — a name held in a
 * SCREAMING_SNAKE constant and reaching the element through a state property, so no
 * {@link KEYS} spelling appears at the point of use. The declaration is where it reads.
 */
const ICON_CONST = /(?:^|[^A-Za-z0-9_$])[A-Z][A-Z0-9_]*ICON(?:_NAME)?\s*=\s*(['"`])([^'"`]*)\1/g;
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
        for (const m of code.matchAll(ICON_CONST)) add(m[2]);
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

/** Every shape a surface that hands `<gtk-image>` a NAME can spell one in. */
const NAME_SHAPES = ['js', 'markup', 'setAttribute', 'createIcon', 'maskClass'];

/**
 * Where each shape is read, and why that surface renders through this stylesheet.
 * `only` (basename) / `onlyPath` (posix repo-relative path) / `skipDir` / `skipFile`
 * narrow a root; everything else under it is scanned.
 */
const SOURCES = [
    {
        // The widgets themselves and the partials that mask an icon without going
        // through `<gtk-image>` at all (`_combo_row.scss`' arrow).
        root: 'packages/web/adwaita-web/src',
        shapes: NAME_SHAPES,
        // The compiled stylesheet, inlined as a TS string, contains every mask class by
        // construction — reading it would make the second arm vacuous. Specs are
        // FIXTURES (header): they neither demand a class nor justify one.
        skipFile: ['styles.generated.ts', /\.spec\.ts$/],
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
        // The storybook SHELL: a published package that depends on `@gjsify/adwaita-web`
        // and hand-writes mask classes for its own controls — the counterpart of the
        // browser stories below, not an exclusion.
        root: 'packages/web/adwaita-storybook/src',
        shapes: NAME_SHAPES,
        skipFile: [/\.spec\.ts$/],
    },
    {
        root: 'showcases/gtk/adwaita-storybook/src/browser',
        shapes: NAME_SHAPES,
    },
    {
        // One meta drives all three renderings, so an icon control's option values are
        // names the BROWSER story sets when a reader picks one. Five map entries
        // (`camera-photo`, `contact-new`, `mail-reply-sender`, `user-trash`,
        // `view-more`, ~5 KB) exist for no other reason — the price of a demo dropdown
        // whose every option draws, and arm 2 keeps that set from growing unnoticed.
        root: 'showcases/gtk/adwaita-storybook/src',
        shapes: ['metaControl'],
        only: [/\.meta\.ts$/],
    },
    {
        // Published DOM showcases render adwaita-web in a real browser. Only the
        // `src/browser/` entry point — the sibling `src/gjs/` tree is another
        // renderer's and answers to its own icon contract.
        root: 'showcases/dom',
        shapes: NAME_SHAPES,
        onlyPath: [/\/src\/browser\//],
    },
    { root: 'website/src', shapes: ['markup', 'maskClass'] },
];

// The source half comes from the shared vocabulary and the rest are the markup and
// style formats these roots hold. The hand-written pair `.ts`/`.mts` was one `.tsx`
// showcase away from going blind — `showcases/gtk/adwaita-gallery-react/src/app.tsx` is
// one directory from a root already listed above.
const EXTENSIONS = [...CODE_SOURCE_EXTENSIONS.map((ext) => `.${ext}`), '.scss', '.astro', '.vue', '.mdx', '.html'];

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
            // POSIX-spelled, because a `\` in the path would make every `onlyPath` on a
            // Windows runner match nothing and the root scan silently empty.
            if (source.onlyPath && !source.onlyPath.some((re) => re.test(toPosixPath(relative(ROOT, path))))) continue;
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
                // `<gtk-image>` draws nothing for it — there is no class to demand.
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
    return new Map([...body.matchAll(/^ {4}'?([a-z0-9-]+)'?:\s*([A-Za-z_$][\w$]*)\s*,/gm)].map((m) => [m[1], m[2]]));
}

/** Every binding `build-scss.mjs` imports from `@gjsify/adwaita-icons`. */
function vendoredGlyphs() {
    const source = readFileSync(ICONS_MAP, 'utf8');
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

const emitted = emittedNames();
const compiled = compiledNames();
const vendored = vendoredGlyphs();

/** Every name in an unhappy state, mapped to what is unhappy about it. */
const problems = new Map();
const note = (name, message) => problems.set(name, [...(problems.get(name) ?? []), message]);

for (const name of [...emitted.keys()].sort()) {
    if (compiled.has(name)) continue;
    note(
        name,
        `emitted by ${[...emitted.get(name)].sort().join(', ')} and the ICONS map has no entry, ` +
            'so it draws the image-missing fallback',
    );
}

for (const [name, glyph] of compiled) {
    if (!emitted.has(name)) {
        note(name, 'is in the ICONS map and nothing emits it — every entry costs ~1.5 KB of the stylesheet');
    }
    // ARM 3: a glyph the map does not take from `@gjsify/adwaita-icons` is one only the
    // WEB has, so the GTK and Blueprint panes it is compared against draw the theme's
    // broken image for the same name. Arms 1 and 2 are blind to it — both directions
    // agree, and the divergence is in the VALUE.
    if (!vendored.has(glyph)) {
        note(name, `is drawn from a local \`${glyph}\`, not from @gjsify/adwaita-icons — no other renderer has it`);
    }
}

const ledger = JSON.parse(readFileSync(LEDGER, 'utf8'));
const reviewed = ledger.reviewed ?? {};
const listed = new Set(Object.keys(reviewed));

const failures = [];

for (const [name, messages] of problems) {
    if (listed.has(name)) continue;
    for (const message of messages) failures.push(`${name} ${message}.`);
}

// The ratchet: an entry whose situation has resolved has to leave the ledger, or it
// keeps claiming an exemption for a state that no longer exists.
for (const name of listed) {
    if (!problems.has(name)) {
        failures.push(`${name} is listed, but nothing about it needs an exemption any more — remove the entry.`);
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
