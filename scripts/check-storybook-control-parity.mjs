#!/usr/bin/env node
// Every control a story DECLARES is READ by all three of its renderings — and every
// property a NativeScript story WRITES is one its widget has.
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
import {
    membersOf,
    NS_CORE_TYPES,
    readCoreProperties,
    readNamespaceSpellings,
    readWidgets,
    widgetClassOf,
    WIDGET_REFERENCE,
} from './nativescript-xml-doors.mjs';

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
    {
        suffix: '.ns.ts',
        label: 'NativeScript',
        src: ADWAITA_NS_STORY_SRC,
        widgets: (root) =>
            new Map([...adwaitaNativeScriptWidgets(root)].map(([tag, file]) => [elementName(tag), file])),
    },
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

/**
 * A NativeScript story writing a property its widget does not have.
 *
 * SAME INCIDENT, ONE DIALECT OVER. The header above is about a control the story never
 * reads; this is about a control it reads and then writes into nothing. NativeScript
 * views take an unknown assignment as a dead own-property — no throw, no warning — and
 * the showcase is `private`, ships `@nativescript/core` as an optional peer and is
 * therefore type-checked by no CI job, so the compiler is not watching either.
 * MEASURED: ADR 0034 clause 1 renamed `AdwToggleGroup.selected` to `active` and
 * `toggle-group.ns.ts` kept assigning `.selected`, which every gate passed — the control
 * moved and did nothing, which is the sentence this file opens with.
 *
 * The widget class comes from the story's own field ANNOTATION, so the reach is every
 * package widget a story holds rather than only the one it is named after. `membersOf`
 * covers in-package ancestors; {@link readCoreProperties} covers what a NativeScript view
 * already carries, and nothing else is exempt.
 *
 * The annotation is the NAMESPACE member since ADR 0034 § Amendment 9 — `_row:
 * Adw.SwitchRow` — so the pattern reads both spellings and resolves through the package's
 * own barrels. Keyed on `WIDGET_CLASS` alone it matched nothing after the migration, and
 * an unmatched field is `continue`d rather than reported: the arm would have gone from
 * 117 held writes to 0 with the run still green, one story file at a time.
 */
const NS_WIDGET_FIELD = new RegExp(`\\b_([A-Za-z0-9_$]+)\\s*:\\s*(${WIDGET_REFERENCE})\\b`, 'g');

/**
 * The OTHER way a story holds a widget: a local `const row = new Adw.SpinRow()`.
 *
 * The field arm above sees only what a story keeps between renders. A widget built and
 * configured inside one method — which is most of the rows in a preferences page — has no
 * annotation to key on, and every write to it was invisible. MEASURED: ADR 0047 replaced
 * `AdwSpinRow.min`/`max`/`step` with one `adjustment`, and two stories kept assigning the
 * old three (`preferences-dialog.ns.ts`, `widgets.ns.ts`). Six dead writes, every gate
 * green, both rows silently rendering the default range — the same sentence this file
 * opens with, one binding form over.
 *
 * The CONSTRUCTOR is the annotation here, which makes this arm no more speculative than
 * the other: `new Adw.SpinRow()` says the class outright.
 */
const NS_WIDGET_LOCAL = new RegExp(
    `\\b(?:const|let|var)\\s+([A-Za-z0-9_$]+)\\s*(?::\\s*[^=;]+)?=\\s*new\\s+(${WIDGET_REFERENCE})\\s*\\(`,
    'g',
);

/**
 * ANY other binding of the same name, widget or not.
 *
 * The ambiguity test cannot be "bound to two different widget classes": a name bound once
 * as a widget and once as a plain object — `const row = new Adw.SpinRow()` in one method,
 * `const row = { … }` in another — would then be held against the widget for both, and a
 * perfectly correct write into the object reads as a dead one. This reader is LEXICAL and
 * has no scopes, so a name it sees bound twice is a name it cannot answer for.
 */
const ANY_LOCAL_BINDING = /\b(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*(?::\s*[^=;]+)?=/g;

/**
 * …and a reassignment, which `const` forbids but `let` does not.
 *
 * The lookbehind is what keeps a DECLARATION from counting twice: `const row = …` is a
 * binding the pattern above already counted, and counting it again here dropped every
 * widget local as ambiguous — the arm went silently back to holding nothing.
 */
const LOCAL_REASSIGNMENT = /(?<![.\w$])(?<!\b(?:const|let|var)\s)([A-Za-z0-9_$]+)\s*=[^=]/gm;
let nsWidgetSources = new Map();
let nsCoreProperties = new Set();
let nsSpellings = new Map();
try {
    ({ sources: nsWidgetSources } = readWidgets(ROOT));
    nsCoreProperties = readCoreProperties(ROOT);
    nsSpellings = readNamespaceSpellings(ROOT);
} catch (error) {
    console.error(`check-storybook-control-parity: ${error.message}`);
    process.exit(1);
}
if (nsWidgetSources.size === 0 || nsCoreProperties.size === 0) {
    console.error(
        'check-storybook-control-parity: the NativeScript widget index or the ambient core slice read as\n' +
            `  empty. Without both, the dead-write arm exempts everything — check ${NS_CORE_TYPES}.`,
    );
    process.exit(1);
}
let deadWriteChecked = 0;

/** Every write to a story-held widget — field or local — whose class has no such member. */
function deadWrites(code) {
    const fields = new Map();
    for (const [, field, spelling] of code.matchAll(NS_WIDGET_FIELD)) {
        const klass = widgetClassOf(spelling, nsSpellings);
        if (klass !== null && nsWidgetSources.has(klass)) fields.set(field, klass);
    }
    // A NAME BOUND TWICE IN ONE FILE IS DROPPED, because this reader is lexical and has no
    // scopes: `widgets.ns.ts` builds a `const child` as an `Adw.SwitchRow` in one branch and
    // as an `Adw.ActionRow` in the other, and holding `child.active` against whichever
    // binding came last reports a write that is perfectly correct. An ambiguous name is a
    // name this arm cannot answer for, and it says so by not answering.
    const locals = new Map();
    for (const [, local, spelling] of code.matchAll(NS_WIDGET_LOCAL)) {
        const klass = widgetClassOf(spelling, nsSpellings);
        if (klass !== null && nsWidgetSources.has(klass)) locals.set(local, klass);
    }
    // Count every binding of every name, then drop the widget locals bound more than once —
    // by a second widget, by a plain value, or by a bare reassignment.
    const bindings = new Map();
    const count = (name) => bindings.set(name, (bindings.get(name) ?? 0) + 1);
    for (const [, name] of code.matchAll(ANY_LOCAL_BINDING)) count(name);
    for (const [, name] of code.matchAll(LOCAL_REASSIGNMENT)) if (locals.has(name)) count(name);
    for (const [local] of locals) if ((bindings.get(local) ?? 0) > 1) locals.delete(local);
    const found = [];
    /** One write, held against the class the binding names. */
    const hold = (binding, klass, property) => {
        deadWriteChecked += 1;
        if (nsCoreProperties.has(property)) return;
        if (membersOf(nsWidgetSources, klass).has(property)) return;
        found.push({ binding, klass, property });
    };
    for (const [, field, property] of code.matchAll(/\bthis\._([A-Za-z0-9_$]+)\.([A-Za-z0-9_$]+)\s*=[^=]/g)) {
        const klass = fields.get(field);
        if (klass !== undefined) hold(`this._${field}`, klass, property);
    }
    // A bare `name.prop = …`, which matches every object write in the file — only the ones
    // whose receiver a `new Adw.*` bound above are held, so nothing else is reached. The
    // COMPOUND forms count as writes too: `row.prop += 1` and `row.prop ??= 1` reach the
    // same dead own-property, and `\s*=[^=]` alone sees neither.
    for (const [, local, property] of code.matchAll(
        /(?:^|[^.\w$])([A-Za-z0-9_$]+)\.([A-Za-z0-9_$]+)\s*(?:[-+*/%&|^]|\*\*|<<|>>>?|\?\?|\|\||&&)?=(?!=)/gm,
    )) {
        const klass = locals.get(local);
        if (klass !== undefined) hold(local, klass, property);
    }
    return found;
}

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

// Per FILE and not per control: a story that declares no control still writes to its
// widget, and the loop above skips a meta with an empty control set entirely.
const nativescript = renderings.find((target) => target.label === 'NativeScript');
for (const [name, file] of nativescript?.files ?? []) {
    for (const { binding, klass, property } of deadWrites(stripComments(readFileSync(file, 'utf8')))) {
        failures.push(
            `${name}@NativeScript: writes \`${binding}.${property}\`, and ${klass} has no such member.\n` +
                '    NativeScript takes the assignment as a dead own-property — no throw, no warning — so the\n' +
                '    control moves and does nothing. Check whether the property was RENAMED: this is what a\n' +
                '    converged name leaves behind at a call site the rename missed.',
        );
    }
}
if (deadWriteChecked === 0) {
    console.error(
        'check-storybook-control-parity: no write on a declared widget was found — neither a `this._field.prop =`\n' +
            '  nor a `local.prop =` on one a `new Adw.*` bound, in any NativeScript story. That is a broken\n' +
            '  scan, not a storybook that sets nothing.',
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
console.log(
    `check-storybook-control-parity: ${deadWriteChecked} write(s) to a declared NativeScript widget, ` +
        `each held against that widget's members and the ambient ${NS_CORE_TYPES} slice.`,
);
