#!/usr/bin/env node
// Every class an Adwaita NativeScript widget puts on a view is styled, or listed.
//
// THE INCIDENT
//
// `@gjsify/adwaita-nativescript`'s theme is one flat CSS file and its widgets set
// `className` from string literals. Nothing connects the two. Renaming
// `SHORTCUT_LABEL_KEYCAP_CLASS` from `keycap` to `adw-keycap` was measured
// against the full suite: 3221 tests stayed GREEN while every keycap lost its
// fill, its radius, its padding and its 20-unit minimum width — the widget
// emitted one name and the theme styled another.
//
// The suites cannot see this by construction. A renderer spec compares the tree
// against the class-name CONSTANT, so it agrees with whatever the constant says;
// the stylesheet is the only other reader and it holds a literal. #1123 found the
// same shape on the browser side, where `.osd` and `.linked` read as implemented
// because their names appeared in a comment while the code spelled
// `.adw-linked`.
//
// WHAT IT CHECKS
//
// For every class name a widget source emits, the theme must carry a `.name`
// selector — unless `status/nativescript-theme-classes.json` lists it. A listed
// class that has since become styled, or that no widget emits any more, is also a
// failure: the ledger is a ratchet and may only shrink.
//
// SCOPE, AND WHY IT IS NARROW. Only the `adw-` namespace plus the handful of
// unprefixed libadwaita names this port uses ({@link UNPREFIXED}). A bare-word
// heuristic would sweep up every lowercase string in the tree; naming them is
// reviewable, and a missing one shows up as a class nothing gates rather than as
// a false failure.
//
// KNOWN BLIND SPOT: a class assembled by interpolation (`adw-${kind}-row`) is not
// a literal and is not seen. This catches the common case, not every case.
//
// Comments are stripped before the scan. A class named only in prose is not
// emitted, and counting it would reproduce exactly the #1123 misreading in
// reverse.
//
// Usage: node scripts/check-nativescript-theme-classes.mjs [--root <dir>] [--update]

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const rootFlag = args.indexOf('--root');
const ROOT = rootFlag === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : args[rootFlag + 1];
const UPDATE = args.includes('--update');

const SRC = join(ROOT, 'packages/nativescript-bridge/adwaita/src');
const THEME = join(SRC, 'theme/adwaita.css');
const LEDGER = join(ROOT, 'status/nativescript-theme-classes.json');

/** libadwaita's own unprefixed class names, which this port keeps verbatim. */
const UNPREFIXED = new Set(['keycap', 'dimmed']);

const isTracked = (name) => name.startsWith('adw-') || UNPREFIXED.has(name);

function widgetSources() {
    const found = [];
    const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const path = join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name !== 'theme') walk(path);
            } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') && !entry.name.includes('.spec.')) {
                found.push(path);
            }
        }
    };
    walk(SRC);
    return found;
}

/** Class names in string literals, one entry per name with the files that emit it. */
function emittedClasses(files) {
    // A literal holding one class, or several separated by spaces as NS holds them.
    const LITERAL = /['"`]([a-z][a-z0-9-]*(?: [a-z][a-z0-9-]*)*)['"`]/g;
    const emitted = new Map();

    for (const file of files) {
        const code = readFileSync(file, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '');

        for (const match of code.matchAll(LITERAL)) {
            for (const name of match[1].split(' ')) {
                if (!isTracked(name)) continue;
                if (!emitted.has(name)) emitted.set(name, new Set());
                emitted.get(name).add(relative(ROOT, file));
            }
        }
    }
    return emitted;
}

const theme = readFileSync(THEME, 'utf8');
const styled = new Set([...theme.matchAll(/\.([a-z][a-z0-9-]*)/g)].map((match) => match[1]));

const emitted = emittedClasses(widgetSources());
const unstyled = [...emitted.keys()].filter((name) => !styled.has(name)).sort();

if (UPDATE) {
    const previous = (() => {
        try {
            return JSON.parse(readFileSync(LEDGER, 'utf8'));
        } catch {
            return { reviewed: {}, unreviewedBaseline: [] };
        }
    })();
    const reviewed = Object.fromEntries(
        Object.entries(previous.reviewed ?? {}).filter(([name]) => unstyled.includes(name)),
    );
    const baseline = unstyled.filter((name) => !(name in reviewed));
    writeFileSync(LEDGER, `${JSON.stringify({ reviewed, unreviewedBaseline: baseline }, null, 4)}\n`);
    process.stdout.write(
        `check-nativescript-theme-classes: wrote ${relative(ROOT, LEDGER)} ` +
            `(${Object.keys(reviewed).length} reviewed, ${baseline.length} baseline)\n`,
    );
    process.exit(0);
}

const ledger = JSON.parse(readFileSync(LEDGER, 'utf8'));
const reviewed = ledger.reviewed ?? {};
const baseline = ledger.unreviewedBaseline ?? [];
const listed = new Set([...Object.keys(reviewed), ...baseline]);

const failures = [];

for (const name of unstyled) {
    if (listed.has(name)) continue;
    failures.push(`${name} — emitted by ${[...emitted.get(name)].join(', ')} and the theme has no \`.${name}\` rule.`);
}

// The ratchet: a listed class that is now styled, or that nothing emits, has to
// leave the list. Otherwise the ledger keeps claiming an exemption for a
// situation that no longer exists, which is how a cleanup grows back.
for (const name of listed) {
    if (!emitted.has(name)) {
        failures.push(`${name} is listed, but no widget emits it any more — remove the entry.`);
    } else if (styled.has(name)) {
        failures.push(`${name} is listed as unstyled, but the theme now styles it — remove the entry.`);
    }
}

process.stdout.write(
    `check-nativescript-theme-classes: ${emitted.size} classes emitted, ` +
        `${emitted.size - unstyled.length} styled, ${Object.keys(reviewed).length} reviewed exemption(s), ` +
        `${baseline.length} unreviewed baseline.\n`,
);

if (failures.length > 0) {
    process.stderr.write(`\ncheck-nativescript-theme-classes: ${failures.length} problem(s):\n\n`);
    for (const failure of failures) process.stderr.write(`  - ${failure}\n`);
    process.stderr.write(
        `\nA widget's class name and the theme's selector are two halves of one decision, and no test\n` +
            `compares them — a rename leaves the suite green and the widget unstyled.\n` +
            `  If the class is a styling HOOK with no look of its own (the widget sets the property\n` +
            `  imperatively, or a parent selector carries the rule), add it to "reviewed" in\n` +
            `  ${relative(ROOT, LEDGER)} with the reason. Otherwise give it a rule in\n` +
            `  ${relative(ROOT, THEME)}.\n`,
    );
    process.exit(1);
}

process.exit(0);
