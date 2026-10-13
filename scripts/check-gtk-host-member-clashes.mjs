#!/usr/bin/env node
// No GTK property lands on a platform member's name undecided (ADR 0109).
//
// WHY. A port widget is a GTK widget AND a platform object, and the two vocabularies overlap.
// `AdwSplitButton:direction` is a `Gtk.ArrowType`; `ViewCommon.direction` is NativeScript's CSS
// layout direction. The port re-declared four such names as JS accessors (`direction`, `modal`,
// `rows`, `columns`): every consumer compiling our typings without `skipLibCheck` got TS2416,
// and at runtime NativeScript's own machinery lost the member. Nothing measured the overlap, so
// the fifth one would have shipped the same way.
//
// WHAT IT CHECKS
//
//   1. NATIVESCRIPT. Every port class's GTK-side properties — its GIR properties (inherited
//      ones included), the accessors the port declares, and the shadowed keys of its
//      `ConstructProps<Self, { … }>` bag — are intersected with the members its platform base
//      declares, read off `@nativescript/core`'s own typings into
//      `status/nativescript-base-members.json`. The resulting `Declarer.prop` set must EQUAL
//      the keys `widgets/shadowed-properties.ts` decides: a new collision and a stale entry
//      both fail.
//   2. THE RULE, per routed entry: no class on the routed type's chain declares an accessor
//      of that name, and the class declares both `get_<p>` and `set_<p>` — the door the
//      router sends every builder write to.
//   3. WEB. The same intersection against `HTMLElement` (`status/html-element-members.json`,
//      from TypeScript's `lib.dom.d.ts`) for every `@gjsify/adwaita-web` element, held
//      against {@link WEB_OVERLAPS} by property name.
//   2b. THE XML WRITER. `NATIVESCRIPT_HOST_MEMBERS` in `adwaita-core/src/markup.ts` lists exactly
//      the shadowed names, so the gallery never prints an attribute NativeScript would take.
//   4. SELF-TEST. Each reader is handed a broken input first and must report it, so a reader
//      that stopped seeing anything cannot print a clean bill.
//
// Plain Node over the repo's own files and two committed ledgers — no install, no build.
// Regenerate the ledgers with `scripts/generate-nativescript-member-snapshot.mjs`.
//
// Usage: node scripts/check-gtk-host-member-clashes.mjs [--root <dir>]

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    clashesOf,
    DOM_SNAPSHOT,
    GIR_PROPS,
    MARKUP,
    NS_SNAPSHOT,
    NS_TABLE,
    portChainOf,
    readAllPortClasses,
    readGirProps,
    readPortClasses,
    readShadowedTable,
    snake,
    tableKeys,
    WEB_ELEMENT_DIRS,
    webClashesOf,
} from './gtk-host-member-clashes.mjs';

/**
 * Where a GTK property name on a web element is an `HTMLElement` member too. The element's
 * accessor (when it has one) overrides the DOM member, which TypeScript allows when the types
 * agree; these are the names where that is a decision rather than an accident.
 */
const WEB_OVERLAPS = {
    attributes:
        '`Element.attributes` is a read-only NamedNodeMap. The Pango attribute list of GtkLabel, ' +
        'GtkEntry, GtkText, GtkInscription and AdwEntryRow is not implemented on web.',
    id: "`AdwLayoutSlot:id` is carried on the element's `id` attribute — the slot name and the " + 'DOM id coincide.',
    popover:
        '`HTMLElement.popover` is the HTML Popover API. GtkMenuButton:popover and ' +
        'AdwSplitButton:popover are not implemented as properties; the menu is `menuModel`.',
    prefix:
        '`Element.prefix` is the read-only namespace prefix. The `prefix` of AdwSidebar and ' +
        'AdwSidebarItem is not implemented on web.',
    title:
        "The GTK title is the element's `title` attribute, which is also HTML's advisory tooltip: " +
        'hovering the element shows the title natively. Known divergence (ADR 0109).',
};

const rootFlag = process.argv.indexOf('--root');
const ROOT = rootFlag === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : process.argv[rootFlag + 1];

const failures = [];
const notes = [];
const read = (file) => readFileSync(join(ROOT, file), 'utf8');

// 4. SELF-TEST — before any real input is trusted.
{
    const broken =
        'export class Probe extends withSignals(\n    GridLayout,\n) {\n' +
        "    static readonly GTypeName: string = 'Probe';\n    get rows(): string {\n        return '';\n    }\n}\n";
    const [probe] = readPortClasses('probe.ts', broken);
    if (probe?.base !== 'GridLayout' || !probe.accessors.has('rows')) {
        failures.push(
            'self-test: readPortClasses no longer reads a multi-line `withSignals(…)` head or its accessors.',
        );
    }
    const found = clashesOf(new Map([['Probe', probe]]), new Map(), { classes: { GridLayout: ['rows'] } });
    if (!found.has('Probe.rows'))
        failures.push('self-test: clashesOf missed an accessor named after a platform member.');
    try {
        readShadowedTable(
            "export const SHADOWED_PROPERTIES = {\n    rows: {\n        routed: 'x',\n    },\n} as const",
        );
        failures.push('self-test: readShadowedTable accepted an entry with no `routed: [...]` list.');
    } catch {
        // expected
    }
}

const interfaces = readGirProps(read(GIR_PROPS));
if (interfaces.size < 100) failures.push(`${GIR_PROPS}: only ${interfaces.size} GIR interface(s) read.`);

// 1. NATIVESCRIPT
const nsSnapshot = JSON.parse(read(NS_SNAPSHOT));
const nsClasses = readAllPortClasses(ROOT);
const measured = clashesOf(nsClasses, interfaces, nsSnapshot);
let table = null;
try {
    table = readShadowedTable(read(NS_TABLE));
} catch (error) {
    failures.push(`${NS_TABLE}: ${error.message}`);
}
if (table !== null) {
    const decided = tableKeys(table);
    for (const [key, { platform, classes }] of measured) {
        if (decided.has(key)) continue;
        failures.push(
            `${key} lands on ${platform}.${key.split('.')[1]} (on ${[...classes].slice(0, 3).join(', ')}) and ` +
                `${NS_TABLE} does not decide it: route it, refuse it, or record it as shared.`,
        );
    }
    for (const key of decided) {
        if (!measured.has(key)) failures.push(`${NS_TABLE} decides ${key}, which collides with nothing — stale entry.`);
    }

    // 2. THE RULE
    const byGtype = new Map([...nsClasses.values()].filter((cls) => cls.gtype !== null).map((cls) => [cls.gtype, cls]));
    let routed = 0;
    for (const [prop, entry] of table.shadowed) {
        for (const gtype of entry.routed) {
            const cls = byGtype.get(gtype);
            if (cls === undefined) {
                failures.push(`${NS_TABLE}: ${prop} is routed for ${gtype}, which no port class registers.`);
                continue;
            }
            for (const link of portChainOf(nsClasses, cls.name)) {
                if (link.accessors.has(prop)) {
                    failures.push(
                        `${link.file}: ${link.name} declares an accessor \`${prop}\` — the name is ` +
                            `${nsSnapshot.package}'s; carry the GTK property behind get_/set_${snake(prop)}().`,
                    );
                }
            }
            for (const verb of [`get_${snake(prop)}`, `set_${snake(prop)}`]) {
                if (!cls.methods.has(verb))
                    failures.push(`${cls.file}: ${cls.name} routes ${prop} but has no ${verb}().`);
            }
            routed++;
        }
    }
    // The XML writer cannot import the port, so it carries the names as a literal list.
    const markup = read(MARKUP);
    const list = /export const NATIVESCRIPT_HOST_MEMBERS[^=]*=\s*\[([^\]]*)\]/.exec(markup);
    const xmlRefused = new Set([...(list?.[1] ?? '').matchAll(/'(\w+)'/g)].map((match) => match[1]));
    const shadowedNames = [...table.shadowed.keys()].sort();
    if (list === null || [...xmlRefused].sort().join() !== shadowedNames.join()) {
        failures.push(
            `${MARKUP}: NATIVESCRIPT_HOST_MEMBERS is [${[...xmlRefused].join(', ')}], ${NS_TABLE} shadows ` +
                `[${shadowedNames.join(', ')}] — the NativeScript XML writer must refuse exactly those.`,
        );
    }

    notes.push(
        `${measured.size} GTK property name(s) land on ${nsSnapshot.package} ${nsSnapshot.version} members ` +
            `across ${nsClasses.size} port classes — ${routed} routed, ` +
            `${[...table.shadowed.values()].reduce((n, e) => n + e.refused.length, 0)} refused, ` +
            `${table.shared.size} shared`,
    );
}

// 3. WEB
const dom = JSON.parse(read(DOM_SNAPSHOT));
const webClasses = readAllPortClasses(ROOT, WEB_ELEMENT_DIRS);
const webMeasured = webClashesOf(webClasses, interfaces, dom.members);
const webNames = new Map();
for (const [key, { implementers }] of webMeasured) {
    const prop = key.split('.')[1];
    if (!webNames.has(prop)) webNames.set(prop, { declarers: [], implemented: 0 });
    webNames.get(prop).declarers.push(key.split('.')[0]);
    webNames.get(prop).implemented += implementers.size;
}
for (const [prop, { declarers }] of webNames) {
    if (!Object.hasOwn(WEB_OVERLAPS, prop)) {
        failures.push(
            `web: ${declarers.join(', ')}.${prop} is also HTMLElement.${prop} and WEB_OVERLAPS does not decide it.`,
        );
    }
}
for (const prop of Object.keys(WEB_OVERLAPS)) {
    if (!webNames.has(prop)) failures.push(`web: WEB_OVERLAPS decides ${prop}, which overlaps nothing — stale entry.`);
}
notes.push(
    `web: ${webNames.size} GTK property name(s) are HTMLElement members (typescript ${dom.version}) across ` +
        `${webClasses.size} element classes: ` +
        [...webNames]
            .map(([prop, { declarers, implemented }]) => `${prop}×${declarers.length}/${implemented} own`)
            .join(', '),
);

for (const note of notes) console.log(`check-gtk-host-member-clashes: ${note}`);

if (failures.length > 0) {
    console.error(`\ncheck-gtk-host-member-clashes: ${failures.length} problem(s):\n`);
    for (const line of failures) console.error(`  ${line}`);
    process.exit(1);
}

console.log('check-gtk-host-member-clashes: OK — every collision is decided, and every routed one follows the rule.');
