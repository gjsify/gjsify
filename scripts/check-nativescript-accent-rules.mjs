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

/** The literals the theme uses for the accent, and the role each stands for. */
const ACCENT_LITERALS = { '#3584e4': 'fill', '#1c71d8': 'shade', '#78aeed': 'standalone-dark' };

/**
 * Every OTHER opaque colour the theme is allowed to contain, with the reason.
 *
 * WHY A CLOSED LIST. The scan used to classify two literals and IGNORE the rest, so
 * an accent-derived colour that was not one of those two was not a mismatch — it was
 * invisible. That is how `#2c75d6` (a hand-picked dark press) and `#78aeed` (accent
 * TEXT on dark, four rules) survived: the gate reported counts, never coverage. Now
 * a colour is either an accent role or listed here, and a new one fails until
 * someone says which it is.
 *
 * Alpha colours are deliberately out of scope: `rgba(255,255,255,.1)` and friends are
 * overlays over whatever is behind them, so they cannot encode an accent.
 */
const NON_ACCENT_LITERALS = {
    '#ffffff': 'plain white — accent foregrounds, dark-mode text',
    '#fafafb': 'light $window_bg',
    '#ebebed': 'light $view/$card shade',
    '#e6e6e9': 'light pressed row',
    '#222226': 'dark $window_bg',
    '#2e2e32': 'dark $sidebar_bg',
    '#2a2a2e': 'dark $view_bg',
    '#303034': 'dark elevated surface',
    '#34343a': 'dark $card_bg',
    '#3a3a40': 'dark banner strip — neutral by design, not an accent',
    '#45454c': 'dark separator/border',
    '#c01c28': 'libadwaita $destructive_bg (red_4)',
    '#ff7b80': 'libadwaita destructive foreground on dark',
};

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

/**
 * Every opaque colour literal in the theme that is neither an accent nor listed.
 *
 * Comments are blanked first, newlines kept, so line numbers stay true while a
 * colour NAMED in prose — explaining what a rule replaced, say — does not read as a
 * declaration the gate has to classify.
 */
function unclassifiedLiterals(css) {
    const found = new Map(); // literal -> first line it appears on
    const lines = css.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' ')).split('\n');
    for (let i = 0; i < lines.length; i++) {
        for (const [literal] of lines[i].matchAll(/#[0-9a-fA-F]{6}/g)) {
            const key = literal.toLowerCase();
            if (key in ACCENT_LITERALS || key in NON_ACCENT_LITERALS) continue;
            if (!found.has(key)) found.set(key, i + 1);
        }
    }
    return found;
}

const css = readFileSync(THEME, 'utf8');
const declarations = themeDeclarations(css);
const entries = tableEntries(readFileSync(TABLE, 'utf8'));
const unclassified = unclassifiedLiterals(css);

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
for (const [literal, line] of unclassified) {
    failures.push(
        `${literal} (${relative(ROOT, THEME)}:${line}) is neither an accent role nor a listed ` +
            'non-accent — an accent the gate cannot classify is not a mismatch, it is invisible',
    );
}

console.log(
    `check-nativescript-accent-rules: ${declared.size} accent declaration(s) in the theme, ` +
        `${tabled.size} in the override table; ` +
        `${Object.keys(NON_ACCENT_LITERALS).length} non-accent colours accounted for.`,
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
