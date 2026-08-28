#!/usr/bin/env node
// A custom element that reaches for an ANCESTOR element is registered after it.
//
// THE INCIDENT
//
// `customElements.define` upgrades every matching element already in the document,
// immediately, so two `define` calls at the foot of one module are a SEQUENCE and not a
// pair. `elements/adw-tab-view.ts` registered `adw-tab-page` first, and every declared
// `<adw-tab-page>` therefore ran its `attributeChangedCallback` while its
// `<adw-tab-view>` parent was still an ordinary HTMLElement — a parent that callback
// reaches for. Measured on the built documentation site: 337 uncaught
// `syncDeclaredPage is not a function` across 22 pages, one per declared page per
// observed attribute, `/getting-started/` alone accounting for 19.
//
// `elements/adw-navigation-view.ts` had the identical shape and was NOT found by the
// same reading, because nobody looked twice: `adw-navigation-page` reaches
// `closest('adw-navigation-view')` and was registered first. It reproduced at four
// uncaught `syncPageProperty is not a function` against declared markup parsed before
// the module loaded. The site never hit it only because its live navigation pages are
// cloned from a `<template>` AFTER both names are registered — an accident of one
// component, not a property of the widget.
//
// WHY A READER OF THE TREE AND NOT A SPEC. With the guard below in place the order is
// UNOBSERVABLE: registering the page first renders identically, because the view reads
// every attribute back off the element when it adopts it, and the whole browser suite
// stays green. Measured, by swapping the two defines back with the guard kept. So there
// is no behaviour left for a spec to hold, and the only honest place to hold the order
// is the text that spells it.
//
// TWO ARMS, one invariant at two spellings.
//
// ORDER — for every `closest('<tag>')` inside a class in a file that also registers
// `<tag>`, the ancestor's `define` comes first. Derived from the tree, so a third pair
// is covered the day it lands.
//
// GUARD — `closest('adw-…')` may not be type-ASSERTED. `as AdwTabView | null` plus `?.`
// conflates the two failures that are not the same: a MISSING ancestor, and one that is
// present but not yet upgraded. `?.` guards the first and the cast asserts the second
// away, which is how the un-upgraded parent reached a call at all. `instanceof` narrows
// for real and costs nothing. ZERO reaching calls fails too: a reader that finds nothing
// has either lost the spelling or lost the tree, and both are the blindness this removes.
//
// WHAT IT DOES NOT CLAIM. That the guard WORKS. That is
// `packages/web/adwaita-web/src/adw-tab-view.spec.ts` (a page beside a view an inert
// document left un-upgraded) and `tests/browser/specs/adwaita-upgrade-order.spec.ts`
// (declared markup parsed BEFORE the package loads — the one order no spec inside the
// bundle can reach). The second file is asserted to exist for the reason the keyboard
// contract asserts its own: a pointer at a file nobody holds is how a check that was
// never written ended up cited as if it ran.
//
// Usage: node scripts/check-adwaita-upgrade-order.mjs [--root <dir>]

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ADWAITA_WEB_SRC, adwaitaWebSources, stripComments } from './adwaita-elements.mjs';
import { toPosixPath } from '../packages/infra/manifest-conformance/lib/index.mjs';

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const ROOT = rootIndex === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : args[rootIndex + 1];

/** Repo-relative and forward-slash: these strings are PRINTED and compared. */
const rel = (file) => toPosixPath(relative(ROOT, file));

/** The behavioural half this script points at, which must therefore exist. */
const ORDER_SPECS = [`${ADWAITA_WEB_SRC}/adw-tab-view.spec.ts`, 'tests/browser/specs/adwaita-upgrade-order.spec.ts'];

const DEFINE = /customElements\.define\(\s*['"]([a-z][a-z0-9-]*)['"]\s*,\s*([A-Za-z0-9_$]+)\s*\)/g;
const CLASS_HEAD = /(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)\s+extends\b/g;
/** The reaching call, with whatever follows it on the same statement (for the cast arm). */
const REACH = /\.closest\(\s*['"](adw-[a-z0-9-]*)['"]\s*\)([^\n;]*)/g;

/**
 * Class bodies by name, as `[name, start, end]` spans over the stripped source.
 *
 * Boundaries are the next class HEAD, not a brace match: a brace matcher has to
 * understand template literals and regex literals to be right, and every file in this
 * tree declares its classes at top level one after another. A nested class would be
 * attributed to its enclosing one, which is the safe direction — it over-reports the
 * reach, and over-reporting fails loudly instead of going quiet.
 */
function classSpans(code) {
    const heads = [...code.matchAll(CLASS_HEAD)].map((match) => ({ name: match[1], at: match.index }));
    return heads.map((head, index) => ({
        name: head.name,
        start: head.at,
        end: index + 1 < heads.length ? heads[index + 1].at : code.length,
    }));
}

const failures = [];
let reaching = 0;

for (const file of adwaitaWebSources(ROOT)) {
    const code = stripComments(readFileSync(file, 'utf8'));

    /** tag → position of its `define` call; also class → tag, to order a REACHING class. */
    const defineAt = new Map();
    const tagOfClass = new Map();
    for (const match of code.matchAll(DEFINE)) {
        defineAt.set(match[1], match.index);
        tagOfClass.set(match[2], match[1]);
    }
    if (defineAt.size === 0) continue;

    const spans = classSpans(code);
    for (const match of code.matchAll(REACH)) {
        const [, ancestorTag, trailer] = match;
        const owner = spans.find((span) => match.index >= span.start && match.index < span.end);
        reaching += 1;

        if (/\bas\s+[A-Za-z0-9_$]/.test(trailer)) {
            failures.push(
                `${rel(file)}: closest('${ancestorTag}') is type-ASSERTED — an ancestor that is present but ` +
                    'not yet upgraded satisfies the cast and fails at the call. Narrow with `instanceof`.',
            );
        }

        // Only a reach at an element the SAME file registers is orderable here; a reach
        // across modules is ordered by the import graph, which this reader cannot see.
        const ancestorAt = defineAt.get(ancestorTag);
        if (ancestorAt === undefined) continue;
        const childTag = owner === undefined ? undefined : tagOfClass.get(owner.name);
        if (childTag === undefined) continue;
        const childAt = defineAt.get(childTag);
        if (childAt !== undefined && ancestorAt > childAt) {
            failures.push(
                `${rel(file)}: '${childTag}' is registered before '${ancestorTag}', which ${owner.name} reaches ` +
                    'with closest(). `define` upgrades matching elements in the document IMMEDIATELY, so every ' +
                    `declared <${childTag}> meets an un-upgraded <${ancestorTag}>. Register the ancestor first.`,
            );
        }
    }
}

for (const spec of ORDER_SPECS) {
    if (!existsSync(join(ROOT, spec))) {
        failures.push(`${spec}: missing — this script's header names it as the half that proves the guard works.`);
    }
}

if (reaching === 0) {
    failures.push(
        `${ADWAITA_WEB_SRC}: found no closest('adw-…') call at all. The tree changed or the spelling did; ` +
            'either way this check is reading nothing.',
    );
}

if (failures.length > 0) {
    console.error(`check-adwaita-upgrade-order: ${failures.length} finding(s):\n`);
    for (const failure of failures) console.error(`  ${failure}`);
    process.exit(1);
}

console.log(
    `check-adwaita-upgrade-order: ${reaching} ancestor-reaching call(s) in ${ADWAITA_WEB_SRC} are guarded and ` +
        'registered after the ancestor they reach.',
);
