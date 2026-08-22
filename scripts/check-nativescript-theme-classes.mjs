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
// MARKUP COUNTS TOO. A NativeScript app declares part of its tree in XML, and
// `app/storybook-page.xml` carries `class="adw-window"` — a class emission no reader
// of `.ts` files can see. That one happens to be styled, so it is a blind spot rather
// than a live defect, which is the only reason it is worth writing down: the next one
// will not be. `.xml` templates are read for their `class` attributes, and the
// showcase's `app/` directory is in scope alongside its `src/` because that is where
// its templates and its entry point live.
//
// A SCOPE THAT EMITS NOTHING IS A FAILURE, not a pass. Every path here is a string in
// this file; a renamed directory, a moved showcase or a reader that stopped matching
// would otherwise print OK over a tree it never looked at. That is the same vacuity
// `check-adwaita-keyboard-contract.mjs` fails on, and widening from one source tree to
// two doubled the surface for it.
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
 * The showcase's three are the ones this repository owns out of the FOUR that
 * `app/app.css` imports: the bridge theme and the storybook chrome (both copied in by
 * its `sync:theme` script, which is why they are read from the PACKAGES rather than
 * from the gitignored copies) plus `app.css` itself. The fourth,
 * `@nativescript/theme/css/core.css`, is deliberately out: it is a 971-selector utility
 * sheet in `node_modules`, so reading it would make this gate depend on an install. The
 * error direction is the safe one — a class satisfied only by the NS core theme is
 * REPORTED rather than passed — and checked once by hand: none of
 * `card / dimmed / success / warning / accent / title-1 / heading` has a rule there.
 */
const SCOPES = [
    { label: 'bridge widget', sources: [SRC], stylesheets: [THEME], home: THEME },
    {
        label: 'showcase view',
        // `app/` as well as `src/`: the XML templates and the entry point live there.
        sources: [join(SHOWCASE, 'src'), join(SHOWCASE, 'app')],
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

function widgetSources(roots) {
    const found = [];
    const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const path = join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name !== 'theme') walk(path);
            } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') && !entry.name.includes('.spec.')) {
                found.push(path);
            } else if (entry.name.endsWith('.xml')) {
                found.push(path);
            }
        }
    };
    for (const root of roots) walk(root);
    return found;
}

/**
 * The colour-scheme switch, which the app puts on the page (`page.className = 'ns-dark'`).
 * An ancestor that is only this is not a PLACE requirement — it is the same node in the
 * other scheme — so a rule under it still styles its subject unconditionally.
 */
const SCHEME_COMPOUND = /^[A-Za-z]*(?:\.ns-dark)+$/;

/**
 * Every class a stylesheet styles UNCONDITIONALLY: the classes of a selector's LAST
 * compound, and only when every ancestor compound before it is the scheme switch.
 *
 * The first draft collected every `.name` occurrence in the file, which is two mistakes
 * at once. It counted names that appear only in PROSE — 24 of them across these three
 * sheets, `activatable`, `circular`, `numeric` and the rest — the exact
 * name-in-a-comment misreading #1123 cost a PR. And it dropped the ancestor, which is
 * how `.dimmed` passed: the theme's only rule for it was `.adw-shortcut-label .dimmed`,
 * and the showcase sets `dimmed` on a Label that is a SIBLING of the shortcut label, not
 * a descendant. Measured against the browser twin, which sets the same class and hits
 * adwaita-web's UNSCOPED `.dimmed` (`scss/_labels.scss:48`): one renderer dimmed that
 * column and the other did not.
 *
 * An ancestor-scoped rule is not a bug — `.adw-shortcut-label .keycap` is exactly right,
 * because nothing sets `keycap` anywhere else — it is a DECISION, so it belongs in the
 * ledger with its reason rather than passing as if unconditional. Three classes were in
 * that position and all three now say which they are.
 *
 * The parser is brace-based and these stylesheets are flat, with `@import` the only
 * at-rule. A nested rule or an `@media` block would need teaching it first.
 */
function styledClasses(stylesheets) {
    const styled = new Set();
    for (const sheet of stylesheets) {
        const css = readFileSync(sheet, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*@[^;{]*;\s*$/gm, '');
        for (const block of css.split('}')) {
            const brace = block.indexOf('{');
            if (brace === -1) continue;
            for (const selector of block.slice(0, brace).split(',')) {
                const compounds = selector.trim().split(/\s+/).filter(Boolean);
                const subject = compounds.pop();
                if (subject === undefined) continue;
                // A `>` or `+` ancestor is a place requirement like any other; these
                // sheets have none, and treating one as unconditional would be the bug
                // this function exists to remove.
                if (!compounds.every((compound) => SCHEME_COMPOUND.test(compound))) continue;
                for (const name of subject.matchAll(/\.([a-z][a-z0-9-]*)/g)) styled.add(name[1]);
            }
        }
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
/** `class="a b"` in a NativeScript XML template. Single quotes are legal XML too. */
const CLASS_ATTRIBUTE = /\bclass\s*=\s*["']([^"']*)["']/g;

/** Class names in string literals, one entry per name with the files that emit it. */
function emittedClasses(files) {
    const emitted = new Map();
    const record = (name, file) => {
        if (!isTracked(name)) return;
        if (!emitted.has(name)) emitted.set(name, new Set());
        emitted.get(name).add(relative(ROOT, file));
    };

    for (const file of files) {
        if (file.endsWith('.xml')) {
            // A template's `class="a b"`, comments stripped first for the same reason
            // the TS reader strips them: a name in prose is not an emission.
            const markup = readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
            for (const match of markup.matchAll(CLASS_ATTRIBUTE)) {
                for (const name of match[1].trim().split(/\s+/)) record(name, file);
            }
            continue;
        }

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
    const sources = widgetSources(scope.sources);
    const emitted = emittedClasses(sources);
    // A scope with nothing in it passes vacuously, and every path above is a string in
    // this file — so an empty scan is a failure, not an OK.
    if (emitted.size === 0) {
        process.stderr.write(
            `check-nativescript-theme-classes: the ${scope.label} scope emitted NO tracked class ` +
                `from ${sources.length} file(s) under ${scope.sources.map((dir) => relative(ROOT, dir)).join(', ')}. ` +
                'Either the tree moved or the reader stopped matching; a scan with nothing in scope ' +
                'would otherwise pass without looking at anything.\n',
        );
        process.exit(1);
    }
    const styled = styledClasses(scope.stylesheets);
    return { scope, emitted, unstyled: [...emitted.keys()].filter((name) => !styled.has(name)).sort() };
});

/**
 * Union across scopes — the ratchet asks "does ANYTHING still emit this?".
 *
 * This LOOSENS the staleness arm, and the loosening is the `LITERAL` heuristic's rather
 * than this union's: any tracked string in any scanned file reads as an emission, so a
 * bare `const LEGACY = 'adw-menu-button'` in a showcase file would keep a ledger entry
 * alive after the widget stopped emitting it. Widening from one source tree to two
 * tripled the string surface without changing the reader. The rename itself is still
 * caught — the NEW name arrives unstyled — so what survives is a stale reason.
 * Tightening it means telling a `className` assignment from any other string, the same
 * parser the `style-classes.md` widening in `status/open-todos.md` is waiting on.
 */
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
        // "every scope that emits it", not "the theme": the rule may have landed in any
        // of that scope's stylesheets, and naming the wrong file sends the next reader
        // to the wrong place.
        failures.push(`${name} is listed as unstyled, but every scope that emits it now styles it — remove the entry.`);
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
