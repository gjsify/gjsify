#!/usr/bin/env tsx
// Generate TypeScript icon exports from refs/adwaita-icon-theme symbolic SVGs.
// Run: yarn generate (or npx tsx scripts/generate.ts)

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..', '..', '..');
const SYMBOLIC_DIR = join(ROOT, 'refs', 'adwaita-icon-theme', 'Adwaita', 'symbolic');
const OUT_DIR = resolve(import.meta.dirname, '..');

// Gray/dark fill colors used as primary icon color in Adwaita — replace with currentColor.
// Accent colors (#33d17a, #ff7800, #e01b24, #ed333b) are intentionally preserved.
//
// BOTH SPELLINGS, and the second one is why: Inkscape writes the primary fill into a
// `style="…"` declaration about as often as into the attribute, and this rewrite used to
// read the attribute only. Measured over the shipped set, 21 paths kept a hardcoded
// neutral grey that way — invisible while nothing read `style`, and a theme regression
// the moment something did. `#222` is the three-digit form of `#222222`; Android's
// `Color.parseColor` reads it and iOS's hex parser does not, so leaving it literal also
// made one icon render in two different colours.
const GRAY = String.raw`#2e3436|#2e3434|#474747|#222222|#2d3336|#222\b`;
const GRAY_FILLS = new RegExp(String.raw`fill="(${GRAY})"`, 'gi');
const GRAY_STYLE_FILLS = new RegExp(String.raw`(^|;)(\s*fill\s*:\s*)(${GRAY})`, 'gi');

const CATEGORIES = ['actions', 'categories', 'devices', 'emotes', 'legacy', 'mimetypes', 'places', 'status', 'ui'];

/** Convert `edit-copy-symbolic.svg` → `editCopySymbolic` */
function toCamelCase(filename: string): string {
    return filename
        .replace(/\.svg$/, '')
        .replace(/[^a-z0-9-]/gi, '-')
        .replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
}

function processSvg(raw: string): string {
    let svg = raw;
    // Strip XML declaration
    svg = svg.replace(/<\?xml[^?]*\?>\s*/, '');
    // Replace gray fills with currentColor
    svg = svg.replace(GRAY_FILLS, 'fill="currentColor"');
    // `$1$2` keeps the separator and the spacing the source wrote, so a rewritten
    // declaration is a value change and nothing else.
    svg = svg.replace(GRAY_STYLE_FILLS, '$1$2currentColor');
    // Trim whitespace
    svg = svg.trim();
    return svg;
}

function generateCategory(category: string, seen: Set<string>): { code: string; exports: string[] } {
    const dir = join(SYMBOLIC_DIR, category);
    if (!existsSync(dir)) {
        return { code: '', exports: [] };
    }

    const files = readdirSync(dir)
        .filter((f) => f.endsWith('.svg'))
        .sort();

    const exports: string[] = [];
    const lines: string[] = [
        `// Adwaita symbolic icons — ${category}`,
        `// Generated from refs/adwaita-icon-theme/Adwaita/symbolic/${category}/`,
        `// Copyright (c) GNOME contributors. LGPL-3.0-or-later AND CC-BY-SA-3.0.`,
        `// Icon fills replaced with currentColor for dynamic theming.`,
        `// DO NOT EDIT — regenerate with: yarn generate`,
        '',
    ];

    for (const file of files) {
        const raw = readFileSync(join(dir, file), 'utf-8');
        const svg = processSvg(raw);
        const name = toCamelCase(file);
        if (seen.has(name)) {
            console.warn(`  ⚠ Skipping duplicate "${name}" in ${category} (already exported by an earlier category)`);
            continue;
        }
        seen.add(name);
        exports.push(name);
        lines.push(`/** ${file.replace('.svg', '')} */`);
        lines.push(`export const ${name} = \`${svg.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`;`);
        lines.push('');
    }

    return { code: lines.join('\n'), exports };
}

// --- Main ---

console.log(`Reading icons from: ${SYMBOLIC_DIR}`);

const allExports: Map<string, string[]> = new Map();
const seen = new Set<string>();

for (const category of CATEGORIES) {
    const { code, exports } = generateCategory(category, seen);
    if (exports.length === 0) {
        console.log(`  ${category}: (empty, skipped)`);
        continue;
    }
    const outFile = join(OUT_DIR, `${category}.ts`);
    writeFileSync(outFile, code);
    allExports.set(category, exports);
    console.log(`  ${category}: ${exports.length} icons → ${category}.ts`);
}

// Write barrel index.ts
const indexLines = [
    '// Adwaita symbolic icons — barrel export',
    '// Generated from refs/adwaita-icon-theme/Adwaita/symbolic/',
    '// DO NOT EDIT — regenerate with: yarn generate',
    '',
    ...Array.from(allExports.keys()).map((c) => `export * from './${c}.js';`),
    '',
];
writeFileSync(join(OUT_DIR, 'index.ts'), indexLines.join('\n'));

// Check for duplicate export names across categories
const seenNames = new Map<string, string>();
let dupes = 0;
for (const [category, exports] of allExports) {
    for (const name of exports) {
        if (seenNames.has(name)) {
            console.warn(`  ⚠ Duplicate export "${name}" in ${category} (first in ${seenNames.get(name)})`);
            dupes++;
        } else {
            seenNames.set(name, category);
        }
    }
}

const total = Array.from(allExports.values()).reduce((s, e) => s + e.length, 0);
console.log(`\nDone: ${total} icons across ${allExports.size} categories.`);
if (dupes > 0) {
    console.warn(`${dupes} duplicate name(s) — use category-specific imports to avoid conflicts.`);
}
