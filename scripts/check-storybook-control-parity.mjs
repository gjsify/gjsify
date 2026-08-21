#!/usr/bin/env node
// Every control a story DECLARES is READ by all three of its renderings.
//
// THE INCIDENT
//
// `entry-row.meta.ts` declared a `showApplyButton` boolean. All three targets
// share that one meta, so all three drew the switch — and only the GTK rendering
// ever read it. On the browser and on NativeScript the user flipped a switch that
// moved, latched, and did nothing whatever: both renderers implement
// `show-apply-button` in full (`AdwEntryRow.showApplyButton`, the
// `show-apply-button` attribute), the STORY simply never wired it.
//
// This is the repo's most expensive failure class in miniature — a control that
// measurably switches and is measurably inert. Nothing could see it: story-set
// parity compares the story SET, category order the sidebar, widget coverage the
// widget SET, and a shared meta makes the three panels IDENTICAL by construction,
// which is exactly what makes the divergence invisible.
//
// WHAT IT CHECKS
//
// For each `<name>.meta.ts`, every `controls[].name` in it must appear as an
// `args.<name>` read in `<name>.story.ts`, `<name>.web.ts` and `<name>.ns.ts` —
// or be ledgered in {@link CANNOT_HONOUR} with the reason that target cannot.
//
// READING IT IS THE BAR, not honouring it, because honouring is not derivable
// from source and reading is. A target that genuinely cannot honour a control
// still reads it, with the reason beside the read — `drop-down.ns.ts` already
// does exactly that for `enableSearch` (`void (this.args.enableSearch …)`, the
// platform action sheet has no search field). That convention is what keeps the
// ledger here nearly empty: the answer to "this target cannot do it" is a read
// and a sentence in the file, not an entry in a list nobody opens.
//
// AND THE SENTENCE IS HELD, because "this target cannot honour it" IS derivable —
// not from the story, from the WIDGET it drives. A `void`-only read whose renderer
// declares a settable property of that name is a control the target CAN honour and
// the story did not wire; five were, three of the sentences measurably false
// (`AdwTabView.autohide` hides the very bar its comment said NativeScript cannot).
// Same shape as `coreReach`'s `CORE-VIA:` arm: a claim in a comment needs an edge
// in the tree behind it. Comments are stripped first, because that reason sits
// beside the read it explains and the comment ALONE satisfied the raw-file scan.
//
// Plain Node over the repo's own files — no install, no build — so it runs in
// `audit-runtimes.yml` next to the other repo-scoped guards.
//
// Usage: node scripts/check-storybook-control-parity.mjs [--root <dir>]

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    ADWAITA_NS_STORY_SRC,
    ADWAITA_STORY_SRC,
    adwaitaNativeScriptWidgets,
    adwaitaStoryMetas,
    adwaitaWebElements,
    elementName,
    settableProperties,
    storyFilesWith,
    stripComments,
} from './adwaita-elements.mjs';

const args = process.argv.slice(2);
const rootFlag = args.indexOf('--root');
const ROOT = rootFlag === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : args[rootFlag + 1];

/**
 * `<meta>.<control>@<target>` a target cannot read at all, and why.
 *
 * The bar is high on purpose, and it is NOT "this target cannot honour the
 * control": that answer is a `void (this.args.x)` read with the reason in a
 * comment, which keeps the control bound to the file that explains it. An entry
 * belongs here only when the rendering cannot mention the name at all.
 */
const CANNOT_HONOUR = {};

/**
 * Where each rendering lives, and — where the widgets it drives are in THIS repo —
 * how to find the widget file behind a story name. GTK has none: its stories build
 * `@girs/*` classes out of the GNOME typelibs, so nothing here can read what
 * `Adw.Sidebar` accepts, and its `void` reads are taken at their word.
 */
const TARGETS = [
    { suffix: '.story.ts', label: 'GTK', src: ADWAITA_STORY_SRC, widgets: null },
    {
        suffix: '.web.ts',
        label: 'browser',
        src: ADWAITA_STORY_SRC,
        widgets: (root) => new Map([...adwaitaWebElements(root)].map(([tag, file]) => [elementName(tag), file])),
    },
    { suffix: '.ns.ts', label: 'NativeScript', src: ADWAITA_NS_STORY_SRC, widgets: adwaitaNativeScriptWidgets },
];

// The sanctioned "cannot honour it" read. Stripping these is how the arm above
// asks whether anything ELSE in the rendering reads the arg.
const VOID_READ = /\bvoid\s*\([^;]*\);?/g;

// A control is an object literal carrying `type: ControlType.…`, and the set is
// read from THOSE rather than from the `controls: [ … ]` array around them. The
// array is not a reliable anchor: `spinner`, `tab-view` and `view-switcher-bar`
// write it on one line, and `carousel` does not write an array at all — its two
// metas both say `controls: carouselControls`, a const declared above. A block
// matcher scored all four as having no controls, which is the silent-under-count
// this check exists to catch, one level up.
const CONTROL_TYPE = /\btype:\s*ControlType\./g;
const CONTROL_NAME = /\bname:\s*'([A-Za-z0-9_]+)'/;

/** Index of the `{` that opens the literal `from` sits in, or -1. */
function openingBrace(source, from) {
    let depth = 0;
    for (let i = from; i >= 0; i--) {
        if (source[i] === '}') depth += 1;
        else if (source[i] === '{') {
            if (depth === 0) return i;
            depth -= 1;
        }
    }
    return -1;
}

/** Index just past the `}` closing the literal that opens at `open`, or -1. */
function closingBrace(source, open) {
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (source[i] === '{') depth += 1;
        else if (source[i] === '}') {
            depth -= 1;
            if (depth === 0) return i + 1;
        }
    }
    return -1;
}

/**
 * Every control name a meta file declares, plus how many control literals could
 * NOT be read.
 *
 * The unreadable count is the discriminator, and it is not hypothetical: the first
 * cut of this check read `controls: [ … ]` blocks and scored four metas as having
 * no controls at all, silently. A control this cannot name is a control nothing
 * here holds, so it FAILS rather than shrinking the set.
 *
 * `name` is taken at brace depth 1 of the control literal, never deeper: a SELECT
 * carries an `options: [ … ]` array of its own objects, and matching the first
 * `name:` anywhere inside would depend on key order.
 */
function controlNames(source) {
    const names = new Set();
    let unreadable = 0;
    for (const match of source.matchAll(CONTROL_TYPE)) {
        const open = openingBrace(source, match.index);
        const close = open === -1 ? -1 : closingBrace(source, open);
        if (close === -1) {
            unreadable += 1;
            continue;
        }
        let depth = 0;
        let name = null;
        const literal = source.slice(open, close);
        for (let i = 0; i < literal.length && name === null; i++) {
            if (literal[i] === '{') depth += 1;
            else if (literal[i] === '}') depth -= 1;
            else if (depth === 1 && literal.startsWith('name:', i)) name = CONTROL_NAME.exec(literal.slice(i));
        }
        if (name === null) unreadable += 1;
        else names.add(name[1]);
    }
    return { names, unreadable };
}

/** `this.args.x`, `args.x`, `args?.x`, `args['x']` — any read of the arg by name. */
const readsArg = (source, name) =>
    new RegExp(`\\bargs\\s*(?:\\?\\.|\\.)\\s*${name}\\b|\\bargs\\s*\\[\\s*['"\`]${name}['"\`]\\s*\\]`).test(source);

/** @type {Map<string, {path: string, file: string, titles: string[], source: string}>} */
let metas;
try {
    metas = adwaitaStoryMetas(ROOT);
} catch (error) {
    // The reader throws on a vacuous scan by design; catch to keep this script's prefix.
    console.error(`check-storybook-control-parity: ${error.message}`);
    process.exit(1);
}

let renderings;
try {
    renderings = TARGETS.map((target) => ({
        ...target,
        files: storyFilesWith(join(ROOT, target.src), target.suffix),
        widgetFiles: target.widgets === null ? null : target.widgets(ROOT),
    }));
} catch (error) {
    // The widget readers throw on a vacuous scan and on a broken `CORE-VIA:`, by design.
    console.error(`check-storybook-control-parity: ${error.message}`);
    process.exit(1);
}

const failures = [];
/** Every `<meta>.<control>@<target>` key the walk below actually reached. */
const visited = new Set();
/** widget file → the properties it lets a caller set; read once per file. */
const setters = new Map();
const settersOf = (file) => {
    if (!setters.has(file)) setters.set(file, settableProperties(readFileSync(join(ROOT, file), 'utf8')));
    return setters.get(file);
};

let declared = 0;
let held = 0;
let voided = 0;

for (const [name, meta] of metas) {
    // Per FILE, not per meta: three files declare two metas each, and the matching
    // rendering file holds both of their stories. Splitting the union would need
    // real parsing to say which story reads what, and every control in a file IS
    // drawn by one of the panels that file feeds.
    const { names: controls, unreadable } = controlNames(meta.source);
    if (unreadable > 0) {
        failures.push(
            `${meta.file}: ${unreadable} control literal(s) this check cannot name. A control it cannot\n` +
                '    read is a control it silently does not hold — fix the reader, do not let the set shrink.',
        );
    }
    if (controls.size === 0) continue;

    for (const target of renderings) {
        const file = target.files.get(name);
        if (file === undefined) {
            // A missing rendering is `check-storybook-story-parity.mjs`'s finding, not
            // this one's — reporting it twice would make one fix look like two.
            continue;
        }
        const code = stripComments(readFileSync(file, 'utf8'));
        const live = code.replaceAll(VOID_READ, '');
        const widgetFile = target.widgetFiles?.get(name);
        for (const control of controls) {
            declared += 1;
            const key = `${name}.${control}@${target.label}`;
            visited.add(key);
            if (readsArg(code, control)) {
                if (key in CANNOT_HONOUR) {
                    failures.push(`${key}: ledgered as unreadable, but the rendering reads it — drop the stale entry.`);
                } else if (readsArg(live, control)) {
                    held += 1;
                } else if (widgetFile !== undefined && settersOf(widgetFile).has(control)) {
                    failures.push(
                        `${key}: read with \`void\` and a sentence saying this target cannot honour the\n` +
                            `    control — but ${widgetFile} declares \`set ${control}\`, so it can. The switch still\n` +
                            '    moves and still does nothing. Wire it, and delete the sentence that says otherwise.',
                    );
                } else {
                    voided += 1;
                }
                continue;
            }
            if (key in CANNOT_HONOUR) continue;
            failures.push(
                `${key}: ${meta.file} declares the control, so all three panels draw it, and\n` +
                    `    ${target.suffix} never reads args.${control}. On this target the control moves and does\n` +
                    '    nothing. Wire it, or — if the target cannot honour it — read it anyway with the reason\n' +
                    '    beside the read, the way drop-down.ns.ts does for `enableSearch`.',
            );
        }
    }
}

if (declared === 0) {
    console.error(
        'check-storybook-control-parity: no control found in any meta — that is a broken scan, not a\n' +
            '  storybook without controls.',
    );
    process.exit(1);
}

// Against the keys the walk REACHED, not against the meta names: an entry naming a
// deleted control, or a target label spelled `web` instead of `browser`, passed a
// meta-only test and was counted in the summary — a ledger figure naming nothing.
for (const key of Object.keys(CANNOT_HONOUR)) {
    if (visited.has(key)) continue;
    failures.push(
        `${key}: ledgered here, but no rendering declares that control — the entry covers nothing.\n` +
            '    Check the meta name, the control name and the target label against the summary line.',
    );
}

if (failures.length > 0) {
    console.error(`check-storybook-control-parity: ${failures.length} inert control(s):\n`);
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error(
        '\nOne meta drives three panels, so the three ALWAYS look identical — which is precisely why a\n' +
            'control wired on one target and not the others cannot be seen. A switch that measurably\n' +
            'moves and is measurably inert is the most expensive shape this repo ships.',
    );
    process.exit(1);
}

const ledgered = Object.keys(CANNOT_HONOUR).length;
console.log(
    `check-storybook-control-parity: ${declared} (control, rendering) pairs — ${held} wired, ` +
        `${voided} read for parity where the target has no property to set, ` +
        `${ledgered} ledgered as unreadable.`,
);
