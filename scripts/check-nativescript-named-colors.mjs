#!/usr/bin/env node
// The NativeScript named-colour override covers every surface literal the theme declares.
//
// WHY. `theme/adwaita.css` inlines the Adwaita surface colours (window, card, sidebar, …)
// as literals, because the NativeScript CSS subset has no custom properties. An app's
// `:root { --window-bg-color: … }` therefore only works through generated overrides for those
// exact selectors, from the table in `widgets/named-colors-theme.ts`.
//
// A hand-listed table with nothing checking it drifts: add a themed rule and that widget
// silently keeps the default colour under an app palette. Every direction fails here — a
// theme declaration carrying a role literal that is neither tabled nor deliberately excluded,
// a table entry the theme no longer has, and a `fallback` that no longer matches the theme
// (the fallback is what is appended again when a variable goes away).
//
// Plain Node over the repo's own files — no install, no build.
//
// Usage: node scripts/check-nativescript-named-colors.mjs [--root <dir>]

import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const rootFlag = args.indexOf('--root');
const ROOT = rootFlag === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : args[rootFlag + 1];

const THEME = join(ROOT, 'packages/nativescript-bridge/adwaita/src/theme/adwaita.css');
const TABLE = join(ROOT, 'packages/nativescript-bridge/adwaita/src/widgets/named-colors-theme.ts');

/** Backgrounds the theme uses for window / view / card / sidebar / dialog surfaces. */
const SURFACE_BACKGROUNDS = new Set(['#fafafb', '#ffffff', '#ebebed', '#222226', '#2e2e32', '#2a2a2e', '#34343a']);
const LIGHT_FOREGROUND = 'rgba(0, 0, 0, 0.8)';
const DARK_FOREGROUND = '#ffffff';

/**
 * Declarations that carry a role literal BY COINCIDENCE, with the reason. A new one fails until
 * somebody says which it is — the same closed-list rule as the accent gate.
 */
const EXCLUDED = {
    '.adw-toggle-button.active|background-color': 'a raised pill on the headerbar, not a surface',
    '.adw-inline-view-switcher-button.active|background-color': 'a raised pill on the headerbar, not a surface',
    '.ns-dark .adw-button.suggested-action|color': 'accent foreground (white), not a window foreground',
    '.ns-dark .adw-button.suggested-action .adw-button-label|color': 'accent foreground (white)',
    '.ns-dark .adw-switch|color': 'the white thumb of a checked switch, not a window foreground',
    '.ns-dark .adw-toast-title, .ns-dark .adw-toast-button|color': 'toast is #505053 in both schemes, text stays white',
};

const normalize = (value) =>
    value
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/,(?=\S)/g, ', ');

/** Every surface declaration in the stylesheet as `selector|property` -> literal. */
function themeDeclarations(css) {
    const blanked = css.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '));
    const found = new Map();
    for (const match of blanked.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = match[1].trim().split(/\s+/).join(' ');
        const dark = selector.includes('ns-dark');
        for (const [, property, raw] of match[2].matchAll(
            /(?<![-\w])(color|background-color)\s*:\s*(#[0-9a-fA-F]{6}|rgba?\([^)]*\))/g,
        )) {
            const value = normalize(raw);
            const isSurface =
                property === 'background-color'
                    ? SURFACE_BACKGROUNDS.has(value)
                    : value === LIGHT_FOREGROUND || (dark && value === DARK_FOREGROUND);
            if (isSurface) found.set(`${selector}|${property}`, value);
        }
    }
    return found;
}

/** Every entry of `ADWAITA_NS_NAMED_COLOR_RULES` as `selector|property` -> fallback. */
function tableEntries(source) {
    const block = /ADWAITA_NS_NAMED_COLOR_RULES[^=]*=\s*\[([\s\S]*?)\n\];/.exec(source);
    if (!block) {
        console.error(
            'check-nativescript-named-colors: could not find ADWAITA_NS_NAMED_COLOR_RULES — the scan is broken.',
        );
        process.exit(1);
    }
    const found = new Map();
    for (const entry of block[1].matchAll(/\{[\s\S]*?\}/g)) {
        const selector = /selector:\s*'([^']+)'/.exec(entry[0]);
        const property = /property:\s*'([^']+)'/.exec(entry[0]);
        const fallback = /fallback:\s*'([^']+)'/.exec(entry[0]);
        if (selector && property && fallback) found.set(`${selector[1]}|${property[1]}`, normalize(fallback[1]));
    }
    return found;
}

const declarations = themeDeclarations(readFileSync(THEME, 'utf8'));
const entries = tableEntries(readFileSync(TABLE, 'utf8'));

if (declarations.size === 0) {
    console.error('check-nativescript-named-colors: found no surface declarations in the theme — the scan is broken.');
    process.exit(1);
}

const failures = [];
for (const [key, value] of declarations) {
    if (key in EXCLUDED) continue;
    if (!entries.has(key))
        failures.push(`the theme declares ${key.split('|').join('  ')} (${value}) — the table does not`);
    else if (entries.get(key) !== value)
        failures.push(`${key.split('|').join('  ')}: table fallback ${entries.get(key)} but the theme says ${value}`);
}
for (const key of entries.keys()) {
    if (!declarations.has(key))
        failures.push(`the table covers ${key.split('|').join('  ')} — the theme no longer declares it`);
}
for (const key of Object.keys(EXCLUDED)) {
    if (!declarations.has(key))
        failures.push(`the exclusion ${key.split('|').join('  ')} no longer matches a theme declaration`);
}

console.log(
    `check-nativescript-named-colors: ${declarations.size} surface declaration(s) in the theme, ` +
        `${entries.size} in the table, ${Object.keys(EXCLUDED).length} excluded.`,
);

if (failures.length > 0) {
    console.error(`\ncheck-nativescript-named-colors: ${failures.length} mismatch(es):\n`);
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error(
        `\nA named colour that misses a rule leaves that widget in the default colour under an app\n` +
            `palette, which is invisible in a diff.\n` +
            `  theme: ${relative(ROOT, THEME)}\n  table: ${relative(ROOT, TABLE)}\n`,
    );
    process.exit(1);
}

process.exit(0);
