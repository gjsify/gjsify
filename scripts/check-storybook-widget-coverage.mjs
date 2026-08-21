#!/usr/bin/env node
// Every widget both renderers ship is either IN the storybook or in this ledger.
//
// WHAT THIS ADDS TO PARITY
//
// `check-storybook-story-parity.mjs` asks whether the three targets render the SAME
// stories. It is blind by construction to the story that exists nowhere: a widget with
// no `*.meta.ts` at all is perfectly symmetric across three targets, so parity is
// green and the reference storybook simply does not show it.
//
// Measured 2026-08-15, and the size of the hole is the argument for the check: of the
// 43 widgets implemented on BOTH renderers, NINE had no story anywhere — including
// `adw-entry`, `adw-drop-down`, `adw-menu-button` and `adw-view-switcher-bar`, four
// ordinary widgets a reader would expect to find first. The GTK storybook is the
// reference implementation the other two are aligned against; a widget it never shows
// is a widget with no reference.
//
// WHAT IT CHECKS
//
//   1. Every `adw-<name>` the browser DEFINES as a custom element and NativeScript
//      ships as an `Adw*` view class has a `<name>.meta.ts` in the GTK showcase — or
//      an entry below saying why not.
//   2. No ledger entry names a widget that HAS a story (a stale exemption reads as
//      considered when it is merely forgotten).
//   3. No ledger entry names a widget the rule cannot reach — one renderer only, or
//      no renderer at all. Same reason: it would look like cover it does not give.
//   4. STATUS.md's widget matrix agrees with the defines, per tag, both ways.
//
// The both-renderers scope is deliberate. A widget on ONE renderer cannot have a
// three-target story, so demanding one here would demand a port, and that is a
// product decision this check has no business making.
//
// (4) asks the same question of the surface that PUBLISHES the answer, and its scoping
// is measured. Forward: on the CELL, because `adw-preferences-page` HAD a row the whole
// time — the NativeScript scan put it there — beside an empty adwaita-web cell, so row
// presence stays green on the defect. Reverse: only a row CLAIMING a web cell with no
// define, since rows without one are ordinary NativeScript-only widgets and GTK stories.
//
// Plain Node over the repo's own files — no install, no build — so it runs in
// `audit-runtimes.yml` next to the other repo-scoped guards.
//
// Usage: node scripts/check-storybook-widget-coverage.mjs [--root <dir>]

import { readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    ADWAITA_NS_WIDGETS,
    ADWAITA_WEB_SRC,
    adwaitaNativeScriptWidgets,
    adwaitaWebElements,
    elementName,
} from './adwaita-elements.mjs';
import { collectAdwaitaCoverage } from './generate-status.mjs';

const args = process.argv.slice(2);
const rootFlag = args.indexOf('--root');
const ROOT = rootFlag === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : args[rootFlag + 1];

const GTK_SRC = join(ROOT, 'showcases/gtk/adwaita-storybook/src');

/**
 * Widgets on both renderers that deliberately have no story of their own, and why.
 *
 * The bar is: a reader looking for this widget in the storybook finds what they came
 * for, under another name — or there is nothing a GTK story could honestly show. "It
 * would be work" is not a reason; those get a story.
 */
const NO_STORY_OF_ITS_OWN = {
    button: 'Buttons/Button Styles IS the button story — its `component` is `Gtk.Button.$gtype`, and it renders the plain button beside .pill/.circular/.suggested-action/.destructive-action/.flat. A second story would show the same widget with fewer states.',
    'toast-overlay':
        'Feedback/Toast renders it. The overlay is only ever the surface a toast appears on, so the story is named after the thing the reader is looking for.',
    'preferences-page':
        'Feedback/Preferences Dialog renders it — the story builds an `Adw.PreferencesPage`, fills it with a group of rows and adds it to the dialog. A page only ever appears inside a preferences dialog, so the story is named after the thing the reader is looking for.',
    'view-stack':
        'A stack shows exactly one page and offers no way to change it — alone it is a blank preview. Every switcher story builds one and drives it: View Switcher, Inline View Switcher, View Switcher Bar.',
    icon: 'There is no Adwaita or GTK icon WIDGET to reference. GTK draws a `Gtk.Image` inline (the navigation stories do), and the browser element exists because CSS needs a box to hang a symbolic on. A story would demonstrate a GTK primitive, not an Adwaita widget.',
    'data-grid':
        'The one widget here with no GTK renderer at all — it is an original @gjsify widget, not a libadwaita port. A GTK story would have to hand-assemble a `Gtk.Grid`, i.e. put a fourth implementation in a showcase where no package owns it. If a GTK data grid is wanted it starts as a package (#1050).',
};

/** Story names — every `<name>.meta.ts` anywhere under the GTK showcase. */
function storyNames(dir) {
    const found = new Set();
    const walk = (current) => {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            const path = join(current, entry.name);
            if (entry.isDirectory()) walk(path);
            else if (entry.name.endsWith('.meta.ts')) found.add(entry.name.slice(0, -'.meta.ts'.length));
        }
    };
    walk(dir);
    return found;
}

/** @type {Map<string, string>} */
let defines;
/** @type {Map<string, string>} */
let ns;
try {
    defines = adwaitaWebElements(ROOT);
    ns = adwaitaNativeScriptWidgets(ROOT);
} catch (error) {
    // Both readers throw on a vacuous scan by design; catch to keep this script's prefix.
    console.error(`check-storybook-widget-coverage: ${error.message}`);
    process.exit(1);
}

const web = new Set([...defines.keys()].map(elementName));
const stories = storyNames(GTK_SRC);

if (stories.size === 0) {
    console.error(
        'check-storybook-widget-coverage: the story scan came back empty — that is a broken scan, not a clean tree.',
    );
    process.exit(1);
}

// Rule 4, first: a matrix that disagrees about what adwaita-web ships makes every
// verdict below a claim about a different tree than the one readers are shown.
const matrix = new Map(collectAdwaitaCoverage(ROOT).map((row) => [row.name, row]));
const mismatches = [];

for (const [tag, file] of defines) {
    const row = matrix.get(elementName(tag));
    if (row === undefined) {
        mismatches.push(`${tag}: defined in ${file}, and the widget matrix has no row for it at all.`);
    } else if (!row.web) {
        mismatches.push(`${tag}: defined in ${file}, and the widget matrix leaves its adwaita-web cell empty.`);
    }
}

for (const row of matrix.values()) {
    if (!row.web || defines.has(`adw-${row.name}`)) continue;
    mismatches.push(`adw-${row.name}: the widget matrix claims an adwaita-web cell, but nothing defines that tag.`);
}

if (mismatches.length > 0) {
    console.error(`check-storybook-widget-coverage: ${mismatches.length} widget-matrix mismatch(es):\n`);
    for (const mismatch of mismatches) console.error(`  - ${mismatch}`);
    console.error(
        '\nSTATUS.md is where this fact is published, and `collectAdwaitaCoverage()` in\n' +
            'scripts/generate-status.mjs builds that column. It must read the same defines this check\n' +
            `does (scripts/adwaita-elements.mjs, over ${ADWAITA_WEB_SRC}) — the two derivations disagreeing\n` +
            'silently, one by define and one by filename, is the whole reason this arm exists.',
    );
    process.exit(1);
}

const onBothRenderers = [...web].filter((name) => ns.has(name)).sort();
const failures = [];

for (const name of onBothRenderers) {
    if (stories.has(name)) continue;
    if (name in NO_STORY_OF_ITS_OWN) continue;
    failures.push(
        `adw-${name}: shipped by both renderers, rendered by no story. Add ${name}.meta.ts + its three\n` +
            '    renderings, or add it to NO_STORY_OF_ITS_OWN in this script with the reason.',
    );
}

for (const name of Object.keys(NO_STORY_OF_ITS_OWN)) {
    if (stories.has(name)) {
        failures.push(`adw-${name}: exempted here, but ${name}.meta.ts exists — drop the stale exemption.`);
    } else if (!web.has(name) || !ns.has(name)) {
        const where = web.has(name) ? 'the browser only' : ns.has(name) ? 'NativeScript only' : 'neither renderer';
        failures.push(
            `adw-${name}: exempted here, but it is on ${where} — outside this check's scope, so the entry covers nothing.`,
        );
    }
}

if (failures.length > 0) {
    console.error(`check-storybook-widget-coverage: ${failures.length} problem(s):\n`);
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error(
        '\nThe GTK storybook is the reference the other two targets are aligned against, so a widget it\n' +
            'never shows is a widget with no reference — and story-set parity cannot see that, because a\n' +
            'story missing from all three targets is perfectly symmetric.\n' +
            `  elements: ${ADWAITA_WEB_SRC}    widgets: ${ADWAITA_NS_WIDGETS}    stories: ${relative(ROOT, GTK_SRC)}`,
    );
    process.exit(1);
}

const exempt = Object.keys(NO_STORY_OF_ITS_OWN).length;
console.log(
    `check-storybook-widget-coverage: ${onBothRenderers.length} widgets on both renderers — ` +
        `${onBothRenderers.length - exempt} with a story, ${exempt} ledgered with a reason; ` +
        `${defines.size} defined tags, each with its adwaita-web cell in the widget matrix.`,
);
