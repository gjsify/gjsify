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
// TEMPLATE LITERALS ARE READ TOO, with their interpolations blanked out first.
// `` `${button.className} adw-entry-apply` `` is how a widget ADDS a class to an
// inherited list, and it is the dominant shape in this tree — reading only
// single-quoted strings missed 24 classes, 10 of them unstyled and therefore
// gated by nothing at all (#1126). An interpolation contributes no class name
// this scan can know, so blanking it is not an approximation of the value: it is
// the whole of what a static reader may claim about it.
//
// REMAINING BLIND SPOT: a name assembled ACROSS an interpolation boundary
// (`adw-${kind}-row`) still cannot be read, because no substring of it is the
// class. That is a narrower gap than the one this replaced — it needs the name
// itself to be computed, not merely concatenated onto other classes — and the
// tree currently holds no instance of it.
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

/** A literal holding one class, or several separated by spaces as NS holds them. */
const LITERAL = /['"`]([a-z][a-z0-9-]*(?: [a-z][a-z0-9-]*)*)['"`]/g;
/** A template literal, read for the class names AROUND its interpolations. */
const TEMPLATE = /`([^`]*)`/g;
/** One `${…}` — blanked before the class list is read. Nested braces end the scan early,
 *  which can only drop names, never invent one. */
const INTERPOLATION = /\$\{[^{}]*\}/g;
/** The same shape {@link LITERAL} accepts, anchored, for a template's remainder. */
const CLASS_LIST = /^[a-z][a-z0-9-]*(?: [a-z][a-z0-9-]*)*$/;

/** Class names in string literals, one entry per name with the files that emit it. */
function emittedClasses(files) {
    const emitted = new Map();
    const record = (name, file) => {
        if (!isTracked(name)) return;
        if (!emitted.has(name)) emitted.set(name, new Set());
        emitted.get(name).add(relative(ROOT, file));
    };

    for (const file of files) {
        const code = readFileSync(file, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '');

        for (const match of code.matchAll(LITERAL)) {
            for (const name of match[1].split(' ')) record(name, file);
        }

        for (const match of code.matchAll(TEMPLATE)) {
            const remainder = match[1].replace(INTERPOLATION, ' ').trim().replace(/\s+/g, ' ');
            // Hold the remainder to the SAME shape a plain literal must have. A
            // template carrying prose (`Toast: ${text}`) fails it and is skipped,
            // which is what keeps this from sweeping up arbitrary strings.
            if (!CLASS_LIST.test(remainder)) continue;
            for (const name of remainder.split(' ')) record(name, file);
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
