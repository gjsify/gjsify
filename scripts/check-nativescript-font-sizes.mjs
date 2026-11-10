#!/usr/bin/env node
// Every `font-size` in the NativeScript theme derives from libadwaita's own stylesheet.
//
// WHY. GTK's `px` maps 1:1 to NativeScript dip (`css-length.ts`), so the theme's sizes are only
// right if they are libadwaita's sizes in px. libadwaita sets no absolute body size: the base is
// GNOME's 11pt UI font = 11 * 96 / 72 = 14.67px, and everything else is relative to it
// (`.title-1` 181%, `font-size: smaller` = 1/1.2, `.caption` 82%, `0.75rem`, ...). The theme had a
// base of 11 (read as pt, used as dip) next to bodies of 15, so headings, subtitles and badges
// were each off by a different amount.
//
// WHAT IT CHECKS. `RULES` names every themed selector that carries a `font-size`, with the
// libadwaita rule it derives from and its factor of the base. The expected px is computed here,
// so a hand-typed value that does not match fails. Three more arms: a theme `font-size` whose
// selector is in neither `RULES` nor `EXEMPT` fails (a new size needs a derivation), a table row
// the theme no longer has is stale, and `EXEMPT` rows (icon glyphs, sizes that are not text) must
// still exist.
//
// Plain Node over the repo's own files — no install, no build.
//
// Usage: node scripts/check-nativescript-font-sizes.mjs [--root <dir>] [--write]
//   --write rewrites every mismatching value in the theme to the derived one.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const rootFlag = args.indexOf('--root');
const ROOT = rootFlag === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : args[rootFlag + 1];
const THEME = join(ROOT, 'packages/nativescript-bridge/adwaita/src/theme/adwaita.css');

/** GNOME's default UI font, 11pt, in px at 96 dpi. */
const BASE_PX = (11 * 96) / 72;
const SMALLER = 1 / 1.2;
const MONO_PX = (10 * 96) / 72;

const BODY = ['inherited body size', 1];
const SMALLER_ROW = ['`font-size: smaller` (_lists.scss)', SMALLER];

/** selector -> [libadwaita source, factor of the base]. */
const RULES = {
    // `_labels.scss`'s typography utilities. Upstream states these as percentages of the
    // document font and lets them cascade; NativeScript has no document-level size to
    // inherit, so the theme ships the products and they belong here like every other
    // derived size. `.heading` carries only a weight upstream, so it has no row.
    '.title-1': ['.title-1: 181% (_labels.scss:37)', 1.81],
    '.title-2': ['.title-2: 136% (_labels.scss:42)', 1.36],
    '.title-3': ['.title-3: 136% (_labels.scss:47)', 1.36],
    '.title-4': ['.title-4: 118% (_labels.scss:52)', 1.18],
    '.body': ['.body: the document font itself (_labels.scss:60)', 1],
    '.caption': ['.caption: 82% (_labels.scss:72)', 0.82],
    '.caption-heading': ['.caption-heading: 82% (_labels.scss:66)', 0.82],
    '.adw-preferences-group-title': ['.heading (bold, base size)', 1],
    '.adw-preferences-group-description': ['.body.dimmed', 1],
    '.adw-row-title': BODY,
    '.adw-row-subtitle': SMALLER_ROW,
    '.adw-entry-title': SMALLER_ROW,
    '.adw-entry-field': BODY,
    '.adw-entry-input': BODY,
    '.adw-combo-value': BODY,
    '.adw-drop-down-label': BODY,
    '.adw-spin-value': BODY,
    '.adw-slider-title': BODY,
    '.adw-slider-value': BODY,
    '.adw-button-label': BODY,
    '.adw-banner-title': ['.heading', 1],
    '.adw-window-title-title': ['headerbar .title (bold, base size)', 1],
    '.adw-window-title-subtitle': ['headerbar .subtitle: smaller (_header-bar.scss)', SMALLER],
    '.adw-viewswitcherbar-button-label': ['button.toggle narrow: 0.75rem (_view-switcher.scss)', 0.75],
    '.adw-viewswitcherbar-button-badge': ['indicator label: 0.6rem (_view-switcher.scss)', 0.6],
    '.adw-data-grid-cell': BODY,
    '.adw-data-grid-cell.header-cell': ['columnview header (bold, base size)', 1],
    '.adw-status-page-title': ['statuspage .title -> .title-1: 181% (_labels.scss)', 1.81],
    '.adw-status-page-description': ['.body.description', 1],
    '.adw-status-page.compact .adw-status-page-title': ['statuspage.compact .title -> .title-2: 136%', 1.36],
    '.adw-button-row-title': BODY,
    '.adw-button-content-label': BODY,
    '.adw-split-button-label': BODY,
    '.adw-toggle-label': BODY,
    '.adw-view-switcher-button-badge': ['indicator label: 0.6rem (_view-switcher.scss)', 0.6],
    '.adw-inline-view-switcher-button-badge': ['indicator label: 0.6rem (_view-switcher.scss)', 0.6],
    '.adw-sidebar-row-title': BODY,
    '.adw-check-label': BODY,
    '.adw-text-view-input': BODY,
    '.adw-toast-title': BODY,
    '.adw-about-dialog-page-title': ['.heading', 1],
    '.adw-about-dialog-name': ['.title-1: 181% (adw-about-dialog.ui:55)', 1.81],
    '.adw-about-dialog-version': ['.app-version (_misc.scss:101), base size', 1],
    '.adw-about-dialog-developer': ['.body (adw-about-dialog.c:677)', 1],
    '.adw-about-dialog-comments': ['.body (adw-about-dialog.c:677)', 1],
    '.adw-about-dialog-credits': ['.body (adw-about-dialog.c:677)', 1],
    '.adw-about-dialog-acknowledgements': ['.body (adw-about-dialog.c:677)', 1],
    '.adw-about-dialog-legal': ['.body (adw-about-dialog.c:677)', 1],
    '.adw-about-dialog-release-notes': ['.body (adw-about-dialog.c:677)', 1],
    '.adw-about-dialog-debug-info': ['monospace font, 10pt (adw-style-manager.c)', MONO_PX / BASE_PX],
    '.adw-preferences-dialog-title': ['headerbar .title (bold, base size)', 1],
    '.adw-shortcut-label-cap-text': BODY,
    '.adw-shortcut-label-side': ['<small> pango markup: x-small-ish 1/1.2 (adw-shortcut-label.c:195)', SMALLER],
    '.adw-shortcut-label .dimmed': ['.dimmed, base size', 1],
};

/** Sizes that are not text sizes, or are overridden inline; each with the reason. */
const EXEMPT = {
    '.adw-avatar-label': 'fallback only; _applySize() sets size * 0.4 inline',
    '.adw-status-page-icon-glyph': 'a glyph standing in for a 96px icon, not text',
    '.adw-about-dialog-back': 'a glyph, not text',
    '.adw-preferences-dialog-close': 'a glyph, not text',
    '.adw-carousel-dot': 'a dot glyph sized to the indicator, not text',
    '.adw-button-content-icon': 'a glyph sized to the label line, not text',
};

const css0 = readFileSync(THEME, 'utf8');
const css = css0.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
const found = new Map();
for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const fs = /(?:^|[;\s])font-size:\s*([\d.]+)\s*;/.exec(m[2]);
    if (!fs) continue;
    for (const sel of m[1].split(',')) found.set(sel.trim().replace(/\s+/g, ' '), Number(fs[1]));
}

const expectedFor = (sel) => Math.round(BASE_PX * RULES[sel][1] * 100) / 100;
if (args.includes('--write')) {
    const out = css0.replace(/([^{}]+)\{([^{}]*)\}/g, (all, selText, body) => {
        const sels = selText
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .split(',')
            .map((x) => x.trim().replace(/\s+/g, ' '));
        const sel = sels.find((x) => x in RULES);
        if (!sel) return all;
        return all.replace(/((?:^|[;\s{])font-size:\s*)[\d.]+(\s*;)/, `$1${expectedFor(sel)}$2`);
    });
    writeFileSync(THEME, out);
    process.exit(0);
}

const problems = [];
for (const [sel, value] of found) {
    if (sel in EXEMPT) continue;
    const rule = RULES[sel];
    if (!rule) {
        problems.push(`${sel}: font-size ${value} has no derivation — add it to RULES (or EXEMPT with a reason)`);
        continue;
    }
    const expected = expectedFor(sel);
    if (Math.abs(value - expected) > 0.005) {
        problems.push(`${sel}: font-size ${value}, libadwaita derives ${expected} — ${rule[0]}`);
    }
}
for (const sel of [...Object.keys(RULES), ...Object.keys(EXEMPT)]) {
    if (!found.has(sel)) problems.push(`${sel}: listed here but the theme has no font-size for it (stale)`);
}

if (problems.length) {
    console.error(
        `${relative(ROOT, THEME)}: ${problems.length} font-size problem(s), base ${BASE_PX.toFixed(2)}px (11pt)`,
    );
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
}
console.log(`nativescript font sizes OK (${found.size} rules, base ${BASE_PX.toFixed(2)}px)`);
