#!/usr/bin/env node
// The letter table behind `@gjsify/adwaita-core`'s `unicharIsalpha` — `g_unichar_isalpha`
// without a Unicode-aware regex engine.
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
// WHAT IT IS. `g_unichar_isalpha` is `IS (TYPE (c), Lu|Ll|Lt|Lm|Lo)` (GLib glib/guniprop.c),
// i.e. general category L*, so the table is the L* code points of one pinned UCD
// `UnicodeData.txt`, folded into ranges (`<…, First>`/`<…, Last>` pairs expanded). GLib
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

/** `[start, end]` inclusive ranges of general category L*, ascending. */
function letterRanges(ucd) {
    const isLetter = new Uint8Array(0x110000);
    let first = null;
    for (const line of ucd.split('\n')) {
        if (line === '') continue;
        const [hex, name, category] = line.split(';');
        const code = parseInt(hex, 16);
        const letter = category.startsWith('L');
        if (name.endsWith(', First>')) {
            first = code;
            continue;
        }
        const from = name.endsWith(', Last>') ? first : code;
        if (letter) isLetter.fill(1, from, code + 1);
    }
    const ranges = [];
    let start = -1;
    for (let code = 0; code <= 0x110000; code++) {
        const letter = code < 0x110000 && isLetter[code] === 1;
        if (letter && start < 0) start = code;
        if (!letter && start >= 0) {
            ranges.push([start, code - 1]);
            start = -1;
        }
    }
    return ranges;
}

function emit(ranges) {
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
    return (
        `// AUTO-GENERATED by scripts/generate-glib-unichar.mjs. DO NOT EDIT BY HAND.\n` +
        `//\n` +
        `// Source: Unicode ${UNICODE} UnicodeData.txt (SHA-256 ${UCD_SHA256.slice(0, 16)}…), general\n` +
        `// category L* — the set \`g_unichar_isalpha\` answers true for. ${ranges.length} ranges.\n` +
        `\n` +
        `/** The Unicode version the table was read from. */\n` +
        `export const GLIB_UNICHAR_UNICODE_VERSION = '${UNICODE}';\n` +
        `\n` +
        `/**\n` +
        ` * The letter ranges, ascending: base-36 numbers in pairs — the gap since the end of the\n` +
        ` * previous range (from U+0000), then the range length minus one. Joined, the lines are one list.\n` +
        ` */\n` +
        `export const GLIB_UNICHAR_ALPHA_RANGES: readonly string[] = [\n` +
        lines.map((text) => `    '${text}',\n`).join('') +
        `];\n`
    );
}

/** The same decode `glib-unichar.ts` runs, so `--check` reads what the module will read. */
function decode(source) {
    const body = source.slice(source.indexOf('GLIB_UNICHAR_ALPHA_RANGES'));
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

const ranges = letterRanges(await readUcd());
const body = emit(ranges);

if (!same(decode(body), ranges)) {
    console.error('generate-glib-unichar: the emitted table does not decode to the ranges it came from.');
    process.exit(1);
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
    let witness = `Node's \`\\p{L}\` is Unicode ${process.versions.unicode}, not consulted`;
    if (`${process.versions.unicode}.0` === UNICODE || process.versions.unicode === UNICODE) {
        const letter = new RegExp('^\\p{L}$', 'u');
        const fromNode = [];
        let start = -1;
        for (let code = 0; code <= 0x110000; code++) {
            const isLetter =
                code < 0x110000 && (code < 0xd800 || code > 0xdfff) && letter.test(String.fromCodePoint(code));
            if (isLetter && start < 0) start = code;
            if (!isLetter && start >= 0) {
                fromNode.push([start, code - 1]);
                start = -1;
            }
        }
        if (!same(fromNode, ranges)) {
            console.error(
                `generate-glib-unichar --check: Node's \`\\p{L}\` (Unicode ${UNICODE}) disagrees with the UCD.`,
            );
            process.exit(1);
        }
        witness = "Node's `\\p{L}` agrees";
    }
    console.log(`generate-glib-unichar --check: OK (Unicode ${UNICODE}, ${ranges.length} ranges; ${witness})`);
    process.exit(0);
}

writeFileSync(OUT, body, 'utf8');
console.log(`generate-glib-unichar: wrote ${relative(ROOT, OUT)} — Unicode ${UNICODE}, ${ranges.length} ranges.`);
