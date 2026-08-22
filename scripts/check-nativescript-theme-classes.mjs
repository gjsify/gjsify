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
// selector — unless `status/nativescript-theme-classes.json` gives it a REASON.
// A listed class that has since become styled, or that no widget emits any more,
// is also a failure: an exemption may not outlive the situation it describes.
//
// THERE IS NO UNREVIEWED LIST. The ledger was seeded with 22 measured names and
// no judgement; #1126 worked those plus the ten the blind spot below was hiding
// down to zero — 27 hooks, 5 missing rules. Keeping the bucket would keep the
// escape hatch, since a name is added to a list far more easily than a sentence
// is written about it, and "unreviewed" is the state this file exists to end.
//
// THE SECOND INCIDENT, and why the showcase is in scope. The reader saw only the
// PACKAGE's widget sources, so a class an APP sets went unchecked — and the
// storybook showcase is an app. `carousel.ns.ts` builds every carousel page with
// `className = 'adw-card …'` and nothing anywhere styled `.adw-card`, so three
// pages that the browser twin draws as rounded white cards rendered as
// transparent square boxes; `widgets.ns.ts` names `adw-action-buttons` on a
// horizontal StackLayout whose browser twin carries `gap: 12px; margin: 6px 0`,
// so its two buttons sat flush. Both were invisible here for the same reason the
// keycap rename was invisible to the suite: nothing compared the two halves.
//
// SCOPES ARE PAIRED WITH WHAT LOADS THEM, because "styled" is not one question.
// A consumer installs `@gjsify/adwaita-nativescript` and gets `theme/adwaita.css`
// and nothing else, so a BRIDGE class satisfied by a showcase's own stylesheet
// would be a rule that ships to nobody. A SHOWCASE class may be satisfied by any
// of the three files its `app.css` imports. Hence {@link SCOPES}: same reader,
// same ledger, different stylesheet set per source tree.
//
// SCOPE, AND WHY IT IS NARROW. Only the `adw-` namespace plus the handful of
// unprefixed libadwaita names this port uses ({@link UNPREFIXED}). A bare-word
// heuristic would sweep up every lowercase string in the tree; naming them is
// reviewable, and a missing one shows up as a class nothing gates rather than as
// a false failure. It is also why the unprefixed style classes the showcase's
// carousel reaches for — `.title-1`, `.success`, `.warning` — are NOT held here
// even though nothing styles them either; that gap is in `status/open-todos.md`
// with its measurement.
//
// TEMPLATE LITERALS ARE READ TOO, interpolations blanked out first. `` `${b.className}
// adw-entry-apply` `` is how a widget ADDS a class to an inherited list, the dominant
// shape here — reading only single-quoted strings missed 24 classes, 10 unstyled and
// so gated by nothing at all (#1126). Blanking an interpolation is the whole of what
// a static reader may claim about it. STILL BLIND to a name assembled ACROSS a
// boundary (`adw-${kind}-row`), where no substring of it is the class: narrower than
// the gap it replaced, and the tree holds no instance of it today.
//
// Comments are stripped before the scan. A class named only in prose is not
// emitted, and counting it would reproduce exactly the #1123 misreading in
// reverse.
//
// Usage: node scripts/check-nativescript-theme-classes.mjs [--root <dir>]

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const rootFlag = args.indexOf('--root');
const ROOT = rootFlag === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : args[rootFlag + 1];

const SRC = join(ROOT, 'packages/nativescript-bridge/adwaita/src');
const THEME = join(SRC, 'theme/adwaita.css');
const SHOWCASE = join(ROOT, 'showcases/dom/adwaita-storybook-nativescript');
const LEDGER = join(ROOT, 'status/nativescript-theme-classes.json');

/**
 * Source tree → the stylesheets a view built from it can actually be styled by,
 * and the file a missing rule belongs in.
 *
 * The showcase's three are exactly what its `app/app.css` imports: the bridge
 * theme and the storybook chrome (both copied in by its `sync:theme` script,
 * which is why they are read from the PACKAGES rather than from the gitignored
 * copies) plus `app.css` itself.
 */
const SCOPES = [
    { label: 'bridge widget', sources: SRC, stylesheets: [THEME], home: THEME },
    {
        label: 'showcase view',
        sources: join(SHOWCASE, 'src'),
        stylesheets: [
            THEME,
            join(ROOT, 'packages/nativescript-bridge/storybook/src/theme/storybook.css'),
            join(SHOWCASE, 'app/app.css'),
        ],
        home: join(SHOWCASE, 'app/app.css'),
    },
];

/** libadwaita's own unprefixed class names, which this port keeps verbatim. */
const UNPREFIXED = new Set(['keycap', 'dimmed']);

/** Shortest reason that can plausibly name a node or a C rule. */
const MIN_REASON = 40;

const isTracked = (name) => name.startsWith('adw-') || UNPREFIXED.has(name);

function widgetSources(root) {
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
    walk(root);
    return found;
}

/** Every `.name` a stylesheet selects on, across the set one scope may draw from. */
function styledClasses(stylesheets) {
    const styled = new Set();
    for (const sheet of stylesheets) {
        for (const match of readFileSync(sheet, 'utf8').matchAll(/\.([a-z][a-z0-9-]*)/g)) styled.add(match[1]);
    }
    return styled;
}

/** A literal holding one class, or several separated by spaces as NS holds them. */
const LITERAL = /['"`]([a-z][a-z0-9-]*(?: [a-z][a-z0-9-]*)*)['"`]/g;
/** A template literal, read for the class names AROUND its interpolations. */
const TEMPLATE = /`([^`]*)`/g;
/** One `${…}` — blanked first. Nested braces end it early, which can only drop a name. */
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
            // Held to the SAME shape a plain literal must have, which is what keeps
            // prose out: `Toast: ${text}` fails it and is skipped.
            if (!CLASS_LIST.test(remainder)) continue;
            for (const name of remainder.split(' ')) record(name, file);
        }
    }
    return emitted;
}

/** Per scope: what it emits, and which of those names it can be styled by. */
const scanned = SCOPES.map((scope) => {
    const emitted = emittedClasses(widgetSources(scope.sources));
    const styled = styledClasses(scope.stylesheets);
    return { scope, emitted, unstyled: [...emitted.keys()].filter((name) => !styled.has(name)).sort() };
});

/** Union across scopes — the ratchet asks "does ANYTHING still emit this?". */
const emitted = new Map();
for (const { emitted: found } of scanned) {
    for (const [name, files] of found) {
        if (!emitted.has(name)) emitted.set(name, new Set());
        for (const file of files) emitted.get(name).add(file);
    }
}
/** Unstyled in ANY scope that emits it: one satisfied scope does not cover another. */
const unstyled = [...new Set(scanned.flatMap((entry) => entry.unstyled))].sort();

const ledger = JSON.parse(readFileSync(LEDGER, 'utf8'));
const reviewed = ledger.reviewed ?? {};
const listed = new Set(Object.keys(reviewed));

const failures = [];

for (const { scope, emitted: found, unstyled: missing } of scanned) {
    for (const name of missing) {
        if (listed.has(name)) continue;
        failures.push(
            `${name} — emitted by ${scope.label} ${[...found.get(name)].join(', ')}, and none of ` +
                `${scope.stylesheets.map((sheet) => relative(ROOT, sheet)).join(', ')} has a \`.${name}\` rule.`,
        );
    }
}

// The ratchet: a listed class that is now styled, or that nothing emits, has to
// leave the list. Otherwise the ledger keeps claiming an exemption for a
// situation that no longer exists, which is how a cleanup grows back.
for (const name of listed) {
    if (!emitted.has(name)) {
        failures.push(`${name} is listed, but no widget emits it any more — remove the entry.`);
    } else if (!unstyled.includes(name)) {
        failures.push(`${name} is listed as unstyled, but the theme now styles it — remove the entry.`);
    } else if (typeof reviewed[name] !== 'string' || reviewed[name].trim().length < MIN_REASON) {
        // A placeholder entry is the unreviewed list again, one key at a time.
        // The floor is crude by design: it cannot judge a sentence, only refuse a blank.
        failures.push(`${name} is listed with no real reason — say what carries its look, or why nothing does.`);
    }
}

process.stdout.write(
    `check-nativescript-theme-classes: ${emitted.size} classes emitted across ${SCOPES.length} scope(s) ` +
        `(${scanned.map((entry) => `${entry.scope.label}: ${entry.emitted.size}`).join(', ')}), ` +
        `${emitted.size - unstyled.length} styled, ${Object.keys(reviewed).length} reviewed exemption(s).\n`,
);

if (failures.length > 0) {
    process.stderr.write(`\ncheck-nativescript-theme-classes: ${failures.length} problem(s):\n\n`);
    for (const failure of failures) process.stderr.write(`  - ${failure}\n`);
    process.stderr.write(
        `\nA widget's class name and the theme's selector are two halves of one decision, and no test\n` +
            `compares them — a rename leaves the suite green and the widget unstyled.\n` +
            `  If the class is a styling HOOK with no look of its own (the widget sets the property\n` +
            `  imperatively, or a parent selector carries the rule), add it to "reviewed" in\n` +
            `  ${relative(ROOT, LEDGER)} with the reason. Otherwise give it a rule in the\n` +
            `  stylesheet its scope names above — ${SCOPES.map((scope) => relative(ROOT, scope.home)).join(' or ')}.\n`,
    );
    process.exit(1);
}

process.exit(0);
