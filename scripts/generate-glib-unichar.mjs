#!/usr/bin/env node
// The tables behind `@gjsify/adwaita-core`'s `unicharIsalpha` and `unicharIsprint` —
// `g_unichar_isalpha` / `g_unichar_isprint` without a Unicode-aware regex engine.
//
// WHY A TABLE. `release-notes.ts` validated a GMarkup name with `/^\p{L}$/u`, and Learn6502's
// Android build died at startup on an emulator: `Cannot compile ES module …/bundle.mjs
// SyntaxError: Invalid regular expression: /^\p{L}$/u: Invalid property name`. NativeScript's
// V8 is built without ICU (`libNativeScript.so` links no libicu and carries the non-Intl
// `StringPrototypeNormalize` builtin), and property escapes are ICU data. A regex literal is
// compiled when the MODULE is, so one helper nobody had called yet took the whole bundle down.
// `check-nativescript-no-icu-regex.mjs` keeps the construct out of NS-shipped sources; this
// table is what replaces it. Not `toLowerCase() !== toUpperCase()`: that answers false for
// every uncased letter — Hebrew, Arabic, Devanagari, Thai, CJK, the modifier letters.
//
// It happened TWICE. `glib-variant.ts` escaped non-printing characters with
// `/[\p{Cc}\p{Cf}\p{Cn}\p{Cs}]/u`, and the same bundle died the same way on the same emulator
// ("Invalid property name in character class") right after the first fix landed — the gate's
// literal reader had skipped `[…]` whole, so an escape inside a class passed it.
//
// WHAT IT IS. `g_unichar_isalpha` is `IS (TYPE (c), Lu|Ll|Lt|Lm|Lo)` (GLib glib/guniprop.c),
// i.e. general category L*, so the table is the L* code points of one pinned UCD
// `UnicodeData.txt`, folded into ranges (`<…, First>`/`<…, Last>` pairs expanded).
// `g_unichar_isprint` is false for `Cc|Cf|Cn|Cs`; Cn is every code point the file does NOT
// list (non-characters included), so that table is the complement of the listed rest. GLib
// 2.88 carries Unicode 17.0 — measured 2026-10-19 on glib2-2.88.3: `GLib.unichar_isalpha`
// over U+0000..U+10FFFF gives the same 684 ranges this script emits, and so does Node 24's
// `\p{L}` (ICU 78.3, Unicode 17.0). Bump UNICODE together with GLib's own update.
//
// OUTPUT. `packages/web/adwaita-core/src/glib-unichar.generated.ts`: the ranges as alternating
// base-36 gap/length pairs, in lines a formatter leaves alone. The bytes are this script's;
// `--check` compares them exactly.
//
// SOURCE. Downloaded from unicode.org and refused unless its SHA-256 is the pinned one, or
// read from `--ucd <path>` for an offline run. With `--check` on a Node whose ICU is the
// pinned Unicode version, `\p{L}` is consulted as a second, independent reader.
//
// Usage: node scripts/generate-glib-unichar.mjs [--check] [--ucd <UnicodeData.txt>]

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const UNICODE = '17.0.0';
const UCD_URL = `https://www.unicode.org/Public/${UNICODE}/ucd/UnicodeData.txt`;
const UCD_SHA256 = '2e1efc1dcb59c575eedf5ccae60f95229f706ee6d031835247d843c11d96470c';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'packages/web/adwaita-core/src/glib-unichar.generated.ts');

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const ucdFlag = args.indexOf('--ucd');

async function readUcd() {
    let bytes;
    if (ucdFlag !== -1) {
        bytes = readFileSync(args[ucdFlag + 1]);
    } else {
        const response = await fetch(UCD_URL);
        if (!response.ok) {
            console.error(`generate-glib-unichar: ${UCD_URL} answered ${response.status}. Offline? Pass --ucd.`);
            process.exit(1);
        }
        bytes = Buffer.from(await response.arrayBuffer());
    }
    const sha = createHash('sha256').update(bytes).digest('hex');
    if (sha !== UCD_SHA256) {
        console.error(
            `generate-glib-unichar: UnicodeData.txt has SHA-256 ${sha}, not the pinned ${UCD_SHA256}\n` +
                `  of Unicode ${UNICODE}. A different file is a different table — bump UNICODE and the hash together.`,
        );
        process.exit(1);
    }
    return bytes.toString('utf8');
}

/** Every code point's general category; `Cn` for the ones the file does not list. */
function categories(ucd) {
    const category = new Array(0x110000).fill('Cn');
    let first = null;
    for (const line of ucd.split('\n')) {
        if (line === '') continue;
        const [hex, name, value] = line.split(';');
        const code = parseInt(hex, 16);
        if (name.endsWith(', First>')) {
            first = code;
            continue;
        }
        const from = name.endsWith(', Last>') ? first : code;
        category.fill(value, from, code + 1);
    }
    return category;
}

/** `[start, end]` inclusive ranges of the code points `member` holds, ascending. */
function rangesOf(member) {
    const ranges = [];
    let start = -1;
    for (let code = 0; code <= 0x110000; code++) {
        const inside = code < 0x110000 && member(code);
        if (inside && start < 0) start = code;
        if (!inside && start >= 0) {
            ranges.push([start, code - 1]);
            start = -1;
        }
    }
    return ranges;
}

const NON_PRINTING = new Set(['Cc', 'Cf', 'Cn', 'Cs']);

/** The table name → its ranges, in the order they are emitted. */
function tables(ucd) {
    const category = categories(ucd);
    return {
        GLIB_UNICHAR_ALPHA_RANGES: rangesOf((code) => category[code].startsWith('L')),
        GLIB_UNICHAR_NONPRINT_RANGES: rangesOf((code) => NON_PRINTING.has(category[code])),
    };
}

function lines(ranges) {
    const pairs = [];
    let next = 0;
    for (const [start, end] of ranges) {
        pairs.push(`${(start - next).toString(36)},${(end - start).toString(36)}`);
        next = end + 1;
    }
    const lines = [];
    let line = '';
    for (const pair of pairs) {
        const joined = line === '' ? pair : `${line},${pair}`;
        if (joined.length > 100) {
            lines.push(`${line},`);
            line = pair;
        } else {
            line = joined;
        }
    }
    lines.push(line);
    return lines.map((text) => `    '${text}',\n`).join('');
}

function emit(byName) {
    const { GLIB_UNICHAR_ALPHA_RANGES: alpha, GLIB_UNICHAR_NONPRINT_RANGES: nonprint } = byName;
    return (
        `// AUTO-GENERATED by scripts/generate-glib-unichar.mjs. DO NOT EDIT BY HAND.\n` +
        `//\n` +
        `// Source: Unicode ${UNICODE} UnicodeData.txt (SHA-256 ${UCD_SHA256.slice(0, 16)}…).\n` +
        `// Each table is base-36 numbers in pairs — the gap since the end of the previous range\n` +
        `// (from U+0000), then the range length minus one. Joined, a table's lines are one list.\n` +
        `\n` +
        `/** The Unicode version the tables were read from. */\n` +
        `export const GLIB_UNICHAR_UNICODE_VERSION = '${UNICODE}';\n` +
        `\n` +
        `/** General category L*, what \`g_unichar_isalpha\` answers true for: ${alpha.length} ranges. */\n` +
        `export const GLIB_UNICHAR_ALPHA_RANGES: readonly string[] = [\n` +
        lines(alpha) +
        `];\n` +
        `\n` +
        `/** \`Cc|Cf|Cn|Cs\`, what \`g_unichar_isprint\` answers false for: ${nonprint.length} ranges. */\n` +
        `export const GLIB_UNICHAR_NONPRINT_RANGES: readonly string[] = [\n` +
        lines(nonprint) +
        `];\n`
    );
}

/** The same decode `glib-unichar.ts` runs, so `--check` reads what the module will read. */
function decode(source, name) {
    const from = source.indexOf(`${name}: readonly`);
    const body = source.slice(from, source.indexOf('];', from));
    const numbers = [...body.matchAll(/'([0-9a-z,]+)'/g)]
        .map((match) => match[1])
        .join('')
        .split(',')
        .map((text) => parseInt(text, 36));
    const ranges = [];
    let next = 0;
    for (let i = 0; i < numbers.length; i += 2) {
        const start = next + numbers[i];
        ranges.push([start, start + numbers[i + 1]]);
        next = start + numbers[i + 1] + 1;
    }
    return ranges;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const byName = tables(await readUcd());
const body = emit(byName);
const counts = Object.values(byName)
    .map((ranges) => ranges.length)
    .join(' + ');

for (const [name, ranges] of Object.entries(byName)) {
    if (!same(decode(body, name), ranges)) {
        console.error(`generate-glib-unichar: ${name} does not decode to the ranges it came from.`);
        process.exit(1);
    }
}

if (CHECK) {
    let committed = '';
    try {
        committed = readFileSync(OUT, 'utf8');
    } catch {
        // No committed table yet: it reads as stale below.
    }
    if (committed !== body) {
        console.error(`generate-glib-unichar --check: ${relative(ROOT, OUT)} is STALE.`);
        console.error('  Regenerate: node scripts/generate-glib-unichar.mjs');
        process.exit(1);
    }
    let witness = `Node's \`\\p{…}\` is Unicode ${process.versions.unicode}, not consulted`;
    if (`${process.versions.unicode}.0` === UNICODE || process.versions.unicode === UNICODE) {
        // A lone surrogate is a one-unit string, so `\p{Cs}` sees it; `\p{L}` never does.
        const witnesses = {
            GLIB_UNICHAR_ALPHA_RANGES: new RegExp('^\\p{L}$', 'u'),
            GLIB_UNICHAR_NONPRINT_RANGES: new RegExp('^[\\p{Cc}\\p{Cf}\\p{Cn}\\p{Cs}]$', 'u'),
        };
        for (const [name, regex] of Object.entries(witnesses)) {
            const fromNode = rangesOf((code) =>
                regex.test(code >= 0xd800 && code <= 0xdfff ? String.fromCharCode(code) : String.fromCodePoint(code)),
            );
            if (!same(fromNode, byName[name])) {
                console.error(`generate-glib-unichar --check: Node's \`${regex.source}\` disagrees with ${name}.`);
                process.exit(1);
            }
        }
        witness = "Node's `\\p{…}` agrees";
    }
    console.log(`generate-glib-unichar --check: OK (Unicode ${UNICODE}, ${counts} ranges; ${witness})`);
    process.exit(0);
}

writeFileSync(OUT, body, 'utf8');
console.log(`generate-glib-unichar: wrote ${relative(ROOT, OUT)} — Unicode ${UNICODE}, ${counts} ranges.`);
