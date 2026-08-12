#!/usr/bin/env node
// The NativeScript accent override covers every accent the theme declares.
//
// WHY. `theme/adwaita.css` inlines the accent as a literal in every rule that uses
// it, because the NativeScript CSS subset has no custom properties. Switching the
// accent at runtime therefore means generating overrides for those exact selectors,
// from a table in `widgets/accent-theme.ts`.
//
// A hand-listed selector table with nothing checking it is how the two drift: add a
// rule to the theme and the override silently keeps painting that widget blue,
// which looks like "the accent almost works" and is invisible in a diff. Both
// directions fail here — a theme declaration with no table entry, and a table entry
// for a selector the theme no longer has.
//
// Plain Node over the repo's own files — no install, no build.
//
// Usage: node scripts/check-nativescript-accent-rules.mjs [--root <dir>]

import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const rootFlag = args.indexOf('--root');
const ROOT = rootFlag === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : args[rootFlag + 1];

const THEME = join(ROOT, 'packages/nativescript-bridge/adwaita/src/theme/adwaita.css');
const TABLE = join(ROOT, 'packages/nativescript-bridge/adwaita/src/widgets/accent-theme.ts');

/** The two literals the theme uses for the accent, and the role each stands for. */
const ACCENT_LITERALS = { '#3584e4': 'fill', '#1c71d8': 'shade' };

/** Every accent declaration in the stylesheet, as `selector|property|role`. */
function themeDeclarations(css) {
    const found = [];
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        // A rule can follow a comment block; the selector is what comes after it.
        const selector = match[1].split('*/').pop().trim().split(/\s+/).join(' ');
        const body = match[2];
        for (const [, property, value] of body.matchAll(/(color|background-color)\s*:\s*(#[0-9a-fA-F]{6})/g)) {
            const role = ACCENT_LITERALS[value.toLowerCase()];
            if (role) found.push(`${selector}|${property}|${role}`);
        }
    }
    return found;
}

/** Every entry of `ADWAITA_NS_ACCENT_RULES`, in the same shape. */
function tableEntries(source) {
    const block = /ADWAITA_NS_ACCENT_RULES[^=]*=\s*\[([\s\S]*?)\n\];/.exec(source);
    if (!block) {
        console.error('check-nativescript-accent-rules: could not find ADWAITA_NS_ACCENT_RULES — the scan is broken.');
        process.exit(1);
    }
    const found = [];
    for (const entry of block[1].matchAll(/\{[\s\S]*?\}/g)) {
        const selector = /selector:\s*'([^']+)'/.exec(entry[0]);
        const property = /property:\s*'([^']+)'/.exec(entry[0]);
        const role = /role:\s*'([^']+)'/.exec(entry[0]);
        if (selector && property && role) found.push(`${selector[1]}|${property[1]}|${role[1]}`);
    }
    return found;
}

const declarations = themeDeclarations(readFileSync(THEME, 'utf8'));
const entries = tableEntries(readFileSync(TABLE, 'utf8'));

if (declarations.length === 0) {
    console.error('check-nativescript-accent-rules: found no accent declarations in the theme — the scan is broken.');
    process.exit(1);
}

const declared = new Set(declarations);
const tabled = new Set(entries);

const failures = [];
for (const item of declared) {
    if (!tabled.has(item))
        failures.push(`the theme declares ${item.split('|').join('  ')} — the override table does not`);
}
for (const item of tabled) {
    if (!declared.has(item))
        failures.push(`the table covers ${item.split('|').join('  ')} — the theme no longer declares it`);
}

console.log(
    `check-nativescript-accent-rules: ${declared.size} accent declaration(s) in the theme, ` +
        `${tabled.size} in the override table.`,
);

if (failures.length > 0) {
    console.error(`\ncheck-nativescript-accent-rules: ${failures.length} mismatch(es):\n`);
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error(
        `\nA runtime accent that misses a rule leaves that widget painted the default blue, which\n` +
            `reads as "the accent almost works" and is invisible in a diff.\n` +
            `  theme: ${relative(ROOT, THEME)}\n  table: ${relative(ROOT, TABLE)}\n`,
    );
    process.exit(1);
}

process.exit(0);
