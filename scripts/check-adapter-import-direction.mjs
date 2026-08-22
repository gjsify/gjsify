#!/usr/bin/env node
// The adapters carry no widget knowledge — mechanically.
//
// ADR 0027 § 7 decides that a framework adapter is a mapping and nothing else:
// the widget vocabulary, the property names and every insertion rule live in ONE
// descriptor table, because hand-maintained per-framework tables are what stalled
// react-gtk, react-native-gtk4 and svelte-gjs. A rule without a check is a rule
// that gets "simplified" back into the bug it prevents.
//
// This check deliberately did NOT ship with the host: a scan with nothing to scan
// reports green and proves nothing, which is the failure class this repository
// pays most for. It lands with the first adapter, and it refuses to run on an
// empty set.
//
//   node scripts/check-adapter-import-direction.mjs

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'packages/framework/gtk-host/src/adapters';

/** A widget name literal — the table's job, not an adapter's. */
const WIDGET_NAME = /'(?:Gtk|Adw|Gdk|Pango)[A-Z][A-Za-z]+'/;

/** Placement methods. Naming one here means an insertion rule leaked out of the table. */
const PLACEMENT = new RegExp(
    [
        'append', 'prepend', 'insert_child_after', 'set_child', 'set_content', 'set_titlebar',
        'pack_start', 'pack_end', 'set_title_widget', 'add_top_bar', 'add_bottom_bar',
        'add_prefix', 'add_suffix', 'add_titled', 'add_named', 'attach', 'reorder_child_after',
    ]
        .map((m) => `\\b${m}\\b`)
        .join('|'),
);

/** The table and the placement engine are the host's internals. */
const FORBIDDEN_IMPORT = /from\s+'\.\.\/(descriptors|policies|registry)(\/index)?\.js'/;

if (!existsSync(DIR)) {
    console.error(`check-adapter-import-direction: ${DIR} does not exist.`);
    console.error('  If the adapters moved, update this script — do not delete it.');
    process.exit(1);
}

const files = readdirSync(DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'));

// The vacuity guard. An empty scan is the exact shape of a check that proves
// nothing while reporting success.
if (files.length === 0) {
    console.error(`check-adapter-import-direction: no adapter found under ${DIR}.`);
    console.error('  This check exists to hold adapters to ADR 0027 § 7; with none present it');
    console.error('  would report green and verify nothing. Remove the check or add the adapter.');
    process.exit(1);
}

const problems = [];
for (const file of files) {
    const path = join(DIR, file);
    const lines = readFileSync(path, 'utf8').split('\n');
    lines.forEach((line, i) => {
        // Prose may name a widget or a method; code may not.
        const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
        const at = `${path}:${i + 1}`;
        if (WIDGET_NAME.test(code)) {
            problems.push(`${at}  names a widget type: ${code.trim()}`);
        }
        if (PLACEMENT.test(code)) {
            problems.push(`${at}  names a placement method: ${code.trim()}`);
        }
        if (FORBIDDEN_IMPORT.test(code)) {
            problems.push(`${at}  imports the host's internals: ${code.trim()}`);
        }
    });
}

if (problems.length > 0) {
    console.error(`check-adapter-import-direction: ${problems.length} problem(s).\n`);
    for (const p of problems) console.error(`  ${p}`);
    console.error('\nADR 0027 § 7: an adapter maps a framework contract onto the host ops and');
    console.error('carries no widget vocabulary and no insertion rule. Both live in the');
    console.error('descriptor table, so three adapters cannot disagree about GTK.');
    process.exit(1);
}

console.log(`check-adapter-import-direction: ${files.length} adapter(s) carry no widget knowledge.`);
