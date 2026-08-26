#!/usr/bin/env node
// ONE widget vocabulary across the surfaces that claim to share it — and the check proves
// itself on broken input before it looks at the repository.
//
// WHAT ADR 0027 § 9 PROMISED, and what was missing
//
// One vocabulary across native GTK, Blueprint/XML, TSX/JSX, Vue templates and the web
// pillar's `adw-*` elements is an explicit goal. ADR 0028 § 6 named the mechanism — a
// data-only vocabulary export plus "a cross-dialect NAME-AGREEMENT check against
// adwaita-web's custom elements, an independent source, which is the part that can
// actually go red" — and `status/open-todos.md` carried it as the missing piece, cheap
// once the generator existed. The generator exists. This is that check.
//
// THE TWO HALVES, and why only one of them can find a surprise
//
//  1. THE THREE DIALECTS. `jsx-runtime.ts`, `react-jsx-runtime.ts` and
//     `vue-components.ts` are mapped types over the GENERATED maps, so asking whether
//     they name the same widgets is, today, asking whether a mapped type agrees with its
//     own source: it does, by construction. Checking that would be the green-without-
//     measuring class this repository pays most for. So this half asserts the two things
//     that are NOT structural:
//
//       a) the four generated maps agree with the RUNTIME table and with the test-only
//          surface data — four separately emitted artifacts, three files, one generator
//          run. A tag in `WidgetPropsByTag` with no row in `generated/widgets.ts` is a
//          tag JSX accepts and `createElement` refuses, and nothing else notices;
//       b) each dialect module still DERIVES its element list from those maps. The day
//          one of them grows a list of its own, the mapped-type argument stops holding —
//          and that is exactly the hand-maintained per-framework table ADR 0027 § 7
//          exists to prevent. `src/adapters/` already has that guard
//          (`check-adapter-import-direction.mjs`); the dialect modules at `src/` did not.
//
//  2. THE WEB ELEMENTS. `packages/web/adwaita-web` registers its `adw-*` custom elements
//     from its own source, with no reference to the GIR, the descriptor table or any
//     generated file. It is the one INDEPENDENT source in the arrangement, and therefore
//     the only half whose failure carries information. Measured today: 65 `adw-*`
//     elements against 164 GTK tags, 43 sharing a spelling exactly, 22 not — and each of
//     those 22 has to be declared, either as naming the same widget under a different
//     spelling or as deliberately web-only.
//
// WHY THE TABLE IS NOT gtkx's `omittedProps`
//
// ADR 0029 § 4 refuses to copy gtkx's 40 hand-typed omissions because they are "two
// parallel hand-maintained tables joined by a shared `string[]` with no consistency
// check". The table below is hand-written too; the difference is that every entry is held
// against two live sets in both directions. A `gtk:` target that stops being a tag fails.
// An entry for an element that no longer exists fails. An element the table does not
// mention fails. An entry for an element whose spelling already matches a GTK tag fails as
// redundant. The table cannot rot quietly, which is the whole objection.
//
// SELF-TEST FIRST
//
// The rules are pure functions over plain data, and every one of them runs against a
// synthetic input that must FAIL before the real data is read. A check that cannot show
// its own red is asserting its own configuration.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { adwaitaWebElements } from './adwaita-elements.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOST = join('packages', 'framework', 'gtk-host', 'src');
const PROPS = join(HOST, 'generated', 'props.ts');
const WIDGETS = join(HOST, 'generated', 'widgets.ts');
const SURFACE_DATA = join(HOST, 'generated', 'surface-data.mts');

/**
 * The dialect modules, and the generated map each one must keep deriving from.
 *
 * Not `src/adapters/` — those are held by `check-adapter-import-direction.mjs`, which
 * reads the same rule from the other side (no widget knowledge in an adapter). These three
 * are the TYPE surfaces, they live one directory up, and nothing looked at them.
 */
const DIALECTS = [
    { name: 'jsx/solid', file: join(HOST, 'jsx-runtime.ts'), needs: ['WidgetPropsByTag', 'WidgetClassByTag'] },
    { name: 'react', file: join(HOST, 'react-jsx-runtime.ts'), needs: ['WidgetPropsByTag', 'WidgetClassByTag'] },
    { name: 'vue', file: join(HOST, 'vue-components.ts'), needs: ['WidgetPropsByGType', 'WidgetPropsVueAliases'] },
];

/**
 * Every `adw-*` element whose spelling is NOT a GTK tag, and what it is instead.
 *
 * `gtk` — the same widget under a different name, so the vocabularies agree on the THING
 * and differ on the spelling. `webOnly` — no GTK widget behind it at all, with the reason,
 * because "web-only" without one is indistinguishable from an oversight.
 *
 * The GObject-but-not-GtkWidget group is the interesting one: `AdwToggle`,
 * `AdwTabPage`, `AdwViewStackPage`, `AdwSidebarItem` and `AdwSidebarSection` are real
 * libadwaita types that descend from `GObject.Object` and not from `GtkWidget`, so they
 * have no tag in a table of concrete widgets — measured against the Adw-1 GIR. On the web
 * they must be elements, because a declarative child is the only way to write them in
 * HTML.
 */
const WEB_ELEMENT_ALIGNMENT = {
    // Same widget, different spelling.
    'adw-button': { gtk: 'gtk-button' },
    'adw-checkbox': { gtk: 'gtk-check-button' },
    'adw-drop-down': { gtk: 'gtk-drop-down' },
    'adw-entry': { gtk: 'gtk-entry' },
    'adw-icon': { gtk: 'gtk-image' },
    'adw-menu-button': { gtk: 'gtk-menu-button' },
    'adw-popover': { gtk: 'gtk-popover' },
    'adw-progress-bar': { gtk: 'gtk-progress-bar' },
    'adw-radio': { gtk: 'gtk-check-button' },
    'adw-switch': { gtk: 'gtk-switch' },
    // A libadwaita GObject that is not a GtkWidget, so it has no tag here.
    'adw-sidebar-item': { webOnly: 'AdwSidebarItem descends from GObject.Object, not GtkWidget' },
    'adw-sidebar-section': { webOnly: 'AdwSidebarSection descends from GObject.Object, not GtkWidget' },
    'adw-tab-page': { webOnly: 'AdwTabPage descends from GObject.Object, not GtkWidget' },
    'adw-toggle': { webOnly: 'AdwToggle descends from GObject.Object, not GtkWidget' },
    'adw-view-stack-page': { webOnly: 'AdwViewStackPage descends from GObject.Object, not GtkWidget' },
    // Declarative children with no GObject of their own: on GTK these are method calls.
    'adw-alert-response': { webOnly: 'a declarative form of Adw.AlertDialog.add_response()' },
    'adw-bottom-sheet-content': { webOnly: 'a slot wrapper; on GTK the slot is set_content()' },
    'adw-bottom-sheet-sheet': { webOnly: 'a slot wrapper; on GTK the slot is set_sheet()' },
    'adw-view-switcher-page': { webOnly: 'a declarative page of the bundled switcher+stack; GTK keeps them apart' },
    // No widget behind them at all.
    'adw-card': { webOnly: 'the .adw-card style class as an element; GTK styles a container instead' },
    'adw-data-grid': { webOnly: 'a presentational aligned grid; the GTK counterpart is a plain Gtk.Grid' },
    'adw-source-view': { webOnly: 'GtkSourceView lives in the GtkSource namespace, outside the Gtk+Adw table' },
};

// ------------------------------------------------------------------ readers

/**
 * Strip comments so a rule about DECLARATIONS is not answered by prose.
 *
 * These files explain what they deliberately do not contain, and they name those things.
 * A naive match reports the explanation as the violation — measured on the sibling check
 * for the generated surface, whose first run failed on a word inside its own header.
 */
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

/** The body of `export interface <name> { … }`, or null. */
function interfaceBody(text, name) {
    const start = text.indexOf(`export interface ${name} {`);
    if (start < 0) return null;
    const open = text.indexOf('{', start);
    const close = text.indexOf('\n}', open);
    if (close < 0) return null;
    return text.slice(open + 1, close);
}

/** `'adw-box': AdwBoxProps;` and `AdwBox: AdwBoxProps;` alike -> Map(key, value). */
function readMembers(text, name) {
    const body = interfaceBody(text, name);
    if (body === null) return null;
    const out = new Map();
    for (const [, quoted, bare, value] of body.matchAll(/^\s*(?:'([^']+)'|([A-Za-z_$][\w$]*)):\s*([^;]+);/gm)) {
        out.set(quoted ?? bare, value.trim());
    }
    return out;
}

/** The runtime table: GType -> tag, from the emitted rows. */
function readRuntimeTable(text) {
    const out = new Map();
    for (const [, gtype, tag] of text.matchAll(/\{\s*gtype:\s*'([^']+)',\s*tag:\s*'([^']+)'/g)) out.set(gtype, tag);
    return out;
}

/** `export const TAGS … = { AdwBox: 'adw-box', … }` from the test-only surface data. */
function readTagsConst(text) {
    const start = text.indexOf('export const TAGS');
    if (start < 0) return null;
    const close = text.indexOf('\n}', start);
    if (close < 0) return null;
    const out = new Map();
    for (const [, gtype, tag] of text.slice(start, close).matchAll(/^\s*([A-Za-z_$][\w$]*):\s*'([^']+)',/gm)) {
        out.set(gtype, tag);
    }
    return out;
}

/** Which generated maps a dialect module imports, and any widget name it spells itself. */
function readDialect(source) {
    const code = stripComments(source);
    const imported = new Set();
    for (const [, names] of code.matchAll(/import\s+type\s*\{([^}]+)\}\s*from\s*'\.\/generated\/props\.js'/g)) {
        for (const name of names.split(',')) imported.add(name.trim());
    }
    // A tag or GType literal in a dialect module is the start of a per-framework table.
    // Type ANNOTATIONS are not matched: every module writes `Gtk.Widget`, so a bare
    // `Gtk\.[A-Z]` would flag all three and be switched off within a day.
    const literals = [...code.matchAll(/'(?:gtk|adw)-[a-z0-9-]+'/g), ...code.matchAll(/'(?:Gtk|Adw)[A-Z]\w*'/g)].map(
        ([literal]) => literal,
    );
    return { imported, literals };
}

// ------------------------------------------------------------------ rules

/**
 * Every rule, as one pure function over plain data.
 *
 * Pure so the self-test can hand it a broken world without materialising files, and so a
 * rule that cannot fail is visible as a rule with no failing vector.
 *
 * @param {{
 *   runtime: Map<string,string>, tags: Map<string,string>|null,
 *   byTag: Map<string,string>|null, byGType: Map<string,string>|null,
 *   classByTag: Map<string,string>|null, vueAliases: Map<string,string>|null,
 *   dialects: {name: string, needs: string[], imported: Set<string>, literals: string[]}[],
 *   webElements: string[], table: Record<string, {gtk?: string, webOnly?: string}>,
 * }} world
 * @returns {string[]} problems, empty when aligned
 */
export function alignmentProblems(world) {
    const problems = [];
    const { runtime, tags, byTag, byGType, classByTag, vueAliases, dialects, webElements, table } = world;

    // A reader that found nothing makes every set difference empty, so the whole check
    // passes vacuously. That is the one failure this file exists to avoid.
    if (runtime.size === 0) problems.push('the runtime widget table is empty — the reader or the file moved');
    for (const [name, map] of [
        ['WidgetPropsByTag', byTag],
        ['WidgetPropsByGType', byGType],
        ['WidgetClassByTag', classByTag],
        ['WidgetPropsVueAliases', vueAliases],
        ['TAGS', tags],
    ]) {
        if (map === null) problems.push(`${name} not found — the generated shape changed and this reader did not`);
    }
    if (webElements.length === 0) problems.push('no adw-* web elements found — the independent half is not being read');
    if (problems.length > 0) return problems;

    const runtimeTags = new Set(runtime.values());
    const runtimeGTypes = new Set(runtime.keys());

    const compare = (label, actual, expected) => {
        const missing = [...expected].filter((key) => !actual.has(key));
        const extra = [...actual].filter((key) => !expected.has(key));
        if (missing.length > 0)
            problems.push(`${label} is missing ${missing.length}: ${missing.slice(0, 8).join(', ')}`);
        if (extra.length > 0)
            problems.push(`${label} has ${extra.length} nothing else knows: ${extra.slice(0, 8).join(', ')}`);
    };

    compare('WidgetPropsByTag', new Set(byTag.keys()), runtimeTags);
    compare('WidgetClassByTag', new Set(classByTag.keys()), runtimeTags);
    compare('WidgetPropsByGType', new Set(byGType.keys()), runtimeGTypes);
    compare('surface-data TAGS', new Set(tags.keys()), runtimeGTypes);

    // The join: for one GType the tag map, the props maps and the class map must all be
    // talking about the same widget. A tag/GType pair that drifts apart would let the JSX
    // and Vue dialects accept different sets while every key set still matched.
    for (const [gtype, tag] of runtime) {
        if (tags.get(gtype) !== tag) {
            problems.push(
                `surface-data TAGS maps ${gtype} to ${tags.get(gtype) ?? '(nothing)'}, the table says ${tag}`,
            );
        }
        const byTagIface = byTag.get(tag);
        const byGTypeIface = byGType.get(gtype);
        if (byTagIface !== undefined && byGTypeIface !== undefined && byTagIface !== byGTypeIface) {
            problems.push(`${tag} offers ${byTagIface} to JSX and ${byGTypeIface} to Vue`);
        }
    }

    // The Vue aliases exist only to reach widgets Volar's camelize cannot; each must still
    // be a real tag offering the same interface its GType does.
    for (const [tag, iface] of vueAliases) {
        if (!runtimeTags.has(tag)) problems.push(`Vue alias '${tag}' is not a tag in the widget table`);
        else if (byTag.get(tag) !== iface) {
            problems.push(`Vue alias '${tag}' offers ${iface}, JSX offers ${byTag.get(tag)}`);
        }
    }

    // Each dialect still derives its element list from the generated maps, and spells no
    // widget of its own.
    for (const dialect of dialects) {
        for (const need of dialect.needs) {
            if (!dialect.imported.has(need)) {
                problems.push(
                    `the ${dialect.name} surface no longer imports ${need} from generated/props.js — ` +
                        'a dialect with its own element list is the hand-maintained per-framework table ' +
                        'ADR 0027 § 7 refuses',
                );
            }
        }
        for (const literal of dialect.literals) {
            problems.push(`the ${dialect.name} surface spells a widget itself: ${literal}`);
        }
    }

    // The independent half.
    const declared = new Set(Object.keys(table));
    for (const element of webElements) {
        const entry = table[element];
        if (runtimeTags.has(element)) {
            if (entry) {
                problems.push(
                    `<${element}> already shares its spelling with a GTK tag, so its alignment entry is ` +
                        'redundant — delete it rather than leaving two answers',
                );
            }
            continue;
        }
        if (!entry) {
            problems.push(
                `<${element}> has no GTK tag of the same name and no alignment entry. Give it a 'gtk' ` +
                    "target if it is the same widget, or a 'webOnly' reason if it is not.",
            );
            continue;
        }
        if (entry.gtk && entry.webOnly) problems.push(`<${element}> is declared both an alias and web-only`);
        else if (entry.gtk && !runtimeTags.has(entry.gtk)) {
            problems.push(`<${element}> aliases '${entry.gtk}', which is not a tag in the widget table`);
        } else if (!entry.gtk && !entry.webOnly) {
            problems.push(`<${element}> has an alignment entry with neither a 'gtk' target nor a 'webOnly' reason`);
        }
    }
    const present = new Set(webElements);
    for (const element of declared) {
        if (!present.has(element)) {
            problems.push(`the alignment table declares <${element}>, which adwaita-web no longer registers`);
        }
    }

    return problems;
}

// ------------------------------------------------------------------ self-test

const WORLD = () => ({
    runtime: new Map([
        ['GtkBox', 'gtk-box'],
        ['GtkButton', 'gtk-button'],
    ]),
    tags: new Map([
        ['GtkBox', 'gtk-box'],
        ['GtkButton', 'gtk-button'],
    ]),
    byTag: new Map([
        ['gtk-box', 'GtkBoxProps'],
        ['gtk-button', 'GtkButtonProps'],
    ]),
    byGType: new Map([
        ['GtkBox', 'GtkBoxProps'],
        ['GtkButton', 'GtkButtonProps'],
    ]),
    classByTag: new Map([
        ['gtk-box', 'Gtk.Box'],
        ['gtk-button', 'Gtk.Button'],
    ]),
    vueAliases: new Map(),
    dialects: [
        { name: 'jsx/solid', needs: ['WidgetPropsByTag'], imported: new Set(['WidgetPropsByTag']), literals: [] },
    ],
    webElements: ['adw-box', 'adw-button'],
    table: { 'adw-box': { webOnly: 'a fixture' }, 'adw-button': { gtk: 'gtk-button' } },
});

/** Each vector breaks exactly one rule, and names the substring its failure must contain. */
const VECTORS = [
    ['the aligned baseline', (w) => w, null],
    ['an empty runtime table', (w) => ({ ...w, runtime: new Map() }), 'runtime widget table is empty'],
    ['a generated map the reader cannot find', (w) => ({ ...w, byTag: null }), 'WidgetPropsByTag not found'],
    ['no web elements at all', (w) => ({ ...w, webElements: [] }), 'independent half is not being read'],
    [
        'a tag in the props map with no runtime row',
        (w) => ({ ...w, byTag: new Map([...w.byTag, ['gtk-ghost', 'GtkGhostProps']]) }),
        'nothing else knows',
    ],
    [
        'a runtime row the props map lost',
        (w) => ({ ...w, byTag: new Map([['gtk-box', 'GtkBoxProps']]) }),
        'WidgetPropsByTag is missing 1',
    ],
    [
        'TAGS disagreeing with the table',
        (w) => ({ ...w, tags: new Map([...w.tags, ['GtkButton', 'gtk-btn']]) }),
        'the table says gtk-button',
    ],
    [
        'JSX and Vue offered different interfaces for one widget',
        (w) => ({ ...w, byGType: new Map([...w.byGType, ['GtkButton', 'GtkOtherProps']]) }),
        'to JSX and GtkOtherProps to Vue',
    ],
    [
        'a Vue alias for a tag that does not exist',
        (w) => ({ ...w, vueAliases: new Map([['gtk-ghost', 'GtkGhostProps']]) }),
        "Vue alias 'gtk-ghost' is not a tag",
    ],
    [
        'a dialect that stopped importing the generated map',
        (w) => ({ ...w, dialects: [{ ...w.dialects[0], imported: new Set() }] }),
        'no longer imports WidgetPropsByTag',
    ],
    [
        'a dialect spelling a widget itself',
        (w) => ({ ...w, dialects: [{ ...w.dialects[0], literals: ["'gtk-box'"] }] }),
        'spells a widget itself',
    ],
    ['an undeclared web element', (w) => ({ ...w, table: {} }), 'no alignment entry'],
    [
        'a web element aliasing a tag that does not exist',
        (w) => ({ ...w, table: { ...w.table, 'adw-button': { gtk: 'gtk-ghost' } } }),
        "aliases 'gtk-ghost'",
    ],
    [
        'a redundant entry for an element that already matches',
        (w) => ({
            ...w,
            webElements: [...w.webElements, 'gtk-box'],
            table: { ...w.table, 'gtk-box': { webOnly: 'redundant' } },
        }),
        'alignment entry is redundant',
    ],
    [
        'a stale entry for an element that is gone',
        (w) => ({ ...w, table: { ...w.table, 'adw-vanished': { webOnly: 'gone' } } }),
        'no longer registers',
    ],
    [
        'an entry that is both an alias and web-only',
        (w) => ({ ...w, table: { ...w.table, 'adw-button': { gtk: 'gtk-button', webOnly: 'both' } } }),
        'both an alias and web-only',
    ],
];

function selfTest() {
    const failures = [];
    // The baseline has to be GREEN, or every vector below "fails" for the wrong reason and
    // the suite reports a working check over a world that was already broken.
    for (const [label, mutate, expected] of VECTORS) {
        const problems = alignmentProblems(mutate(WORLD()));
        if (expected === null) {
            if (problems.length > 0) failures.push(`${label} should be clean, got: ${problems.join(' | ')}`);
            continue;
        }
        if (problems.length === 0) failures.push(`${label} produced NO problem — that rule is not holding`);
        else if (!problems.some((problem) => problem.includes(expected))) {
            failures.push(`${label} failed for the wrong reason (wanted "${expected}"): ${problems.join(' | ')}`);
        }
    }
    return failures;
}

// ------------------------------------------------------------------ run

const selfTestFailures = selfTest();
if (selfTestFailures.length > 0) {
    console.error('check-vocabulary-alignment: SELF-TEST failed — the check itself is broken:');
    for (const failure of selfTestFailures) console.error(`  - ${failure}`);
    process.exit(1);
}

const read = (relativePath) => readFileSync(join(ROOT, relativePath), 'utf8');

let world;
try {
    const props = read(PROPS);
    world = {
        runtime: readRuntimeTable(read(WIDGETS)),
        tags: readTagsConst(read(SURFACE_DATA)),
        byTag: readMembers(props, 'WidgetPropsByTag'),
        byGType: readMembers(props, 'WidgetPropsByGType'),
        classByTag: readMembers(props, 'WidgetClassByTag'),
        vueAliases: readMembers(props, 'WidgetPropsVueAliases'),
        dialects: DIALECTS.map((dialect) => ({ ...dialect, ...readDialect(read(dialect.file)) })),
        webElements: [...adwaitaWebElements(ROOT).keys()],
        table: WEB_ELEMENT_ALIGNMENT,
    };
} catch (error) {
    console.error(`check-vocabulary-alignment: cannot read an input — ${error.message}`);
    console.error('If a file moved, teach this check where it went. Do not delete it.');
    process.exit(1);
}

const problems = alignmentProblems(world);
if (problems.length > 0) {
    console.error('check-vocabulary-alignment: the surfaces do not name the same widgets:');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
}

const aliased = Object.values(WEB_ELEMENT_ALIGNMENT).filter((entry) => entry.gtk).length;
const webOnly = Object.values(WEB_ELEMENT_ALIGNMENT).filter((entry) => entry.webOnly).length;
const shared = world.webElements.filter((element) => new Set(world.runtime.values()).has(element)).length;
console.log(
    `check-vocabulary-alignment: self-test green — ${VECTORS.length - 1} failing vector(s). ` +
        `${world.runtime.size} GTK tags across ${DIALECTS.length} dialect surfaces + the runtime table + the ` +
        `surface data; ${world.webElements.length} adw-* web elements — ${shared} share a spelling, ` +
        `${aliased} alias one, ${webOnly} declared web-only.`,
);
