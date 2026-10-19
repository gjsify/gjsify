#!/usr/bin/env node
// No regex construct that needs ICU in a source NativeScript ships.
//
// THE INCIDENT
//
// Learn6502's Android build died at startup on an emulator, before a single view existed:
// `Cannot compile ES module …/bundle.mjs SyntaxError: Invalid regular expression:
// /^\p{L}$/u: Invalid property name`. The literal sat in `@gjsify/adwaita-core`'s
// `release-notes.ts`, inside a GMarkup name check nobody had reached yet — but a regex
// LITERAL is compiled with its module, so one unreached helper took the whole bundle down.
// NativeScript's V8 is built without ICU: `libNativeScript.so` links no libicu and carries
// the non-Intl builtins (`StringPrototypeNormalize`, `StringPrototypeToLocaleLowerCase`)
// instead of the ICU ones, and Unicode property escapes are ICU data. Node, GJS and every
// browser carry ICU, so all three test suites passed over it; only a device could see it.
// `glib-unichar.ts` (a generated `g_unichar_isalpha` table) replaced it.
//
// WHAT IT CHECKS
//
// The NS CLOSURE is every workspace package a `packages/nativescript-bridge/*` package
// reaches through `dependencies`/`peerDependencies`, transitively. In each one's `src/`
// (spec files included — `build:test:android` puts them on the device too), outside
// comments, it fails on:
//   1. `\p{…}` / `\P{…}` in a regex literal with the `u` or `v` flag;
//   2. the same escape in a string handed to `new RegExp(…)` / `RegExp(…)`;
//   3. a regex literal with the `v` flag (set notation is property-escape territory too).
// `.gjs.spec.ts` files run only under GJS and are skipped. Strings and comments that merely
// MENTION `\p{` (gtksource's refusal message, this kind of header) are not regexes.
//
// The detector is proved on the incident line before the scan, so a reader that stops
// matching fails here instead of reporting OK over a tree it no longer sees.
//
// Usage: node scripts/check-nativescript-no-icu-regex.mjs [--root <dir>]

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const rootFlag = args.indexOf('--root');
const ROOT = rootFlag === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : args[rootFlag + 1];

const BRIDGE = join(ROOT, 'packages/nativescript-bridge');
const WORKSPACE_DIRS = [
    'packages/infra',
    'packages/gjs',
    'packages/node',
    'packages/web',
    'packages/dom',
    'packages/framework',
    'packages/nativescript-bridge',
];
const SOURCE = /\.(?:ts|mts|js|mjs)$/;

/** Package name → directory, for every workspace package. */
function workspacePackages() {
    const byName = new Map();
    for (const group of WORKSPACE_DIRS) {
        const base = join(ROOT, group);
        if (!existsSync(base)) continue;
        for (const entry of readdirSync(base, { withFileTypes: true })) {
            const manifest = join(base, entry.name, 'package.json');
            if (!entry.isDirectory() || !existsSync(manifest)) continue;
            byName.set(JSON.parse(readFileSync(manifest, 'utf8')).name, join(base, entry.name));
        }
    }
    return byName;
}

function nsClosure(byName) {
    const seen = new Map();
    const queue = readdirSync(BRIDGE, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && existsSync(join(BRIDGE, entry.name, 'package.json')))
        .map((entry) => JSON.parse(readFileSync(join(BRIDGE, entry.name, 'package.json'), 'utf8')).name);
    while (queue.length > 0) {
        const name = queue.shift();
        if (seen.has(name) || !byName.has(name)) continue;
        const dir = byName.get(name);
        seen.set(name, dir);
        const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
        queue.push(...Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies }));
    }
    return seen;
}

function* sources(dir) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) yield* sources(path);
        else if (SOURCE.test(entry.name) && !entry.name.endsWith('.d.ts') && !/\.gjs\.spec\.m?ts$/.test(entry.name))
            yield path;
    }
}

/** The line with block and line comments blanked; `//` inside a quoted string survives. */
function codeOf(line, state) {
    let out = '';
    let quote = null;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (state.inBlock) {
            if (c === '*' && line[i + 1] === '/') {
                state.inBlock = false;
                i++;
            }
            continue;
        }
        if (quote) {
            out += c;
            if (c === '\\') out += line[++i] ?? '';
            else if (c === quote) quote = null;
            continue;
        }
        if (c === '/' && line[i + 1] === '*') {
            state.inBlock = true;
            i++;
            continue;
        }
        if (c === '/' && line[i + 1] === '/') break;
        if (c === "'" || c === '"' || c === '`') quote = c;
        out += c;
    }
    return out;
}

// A whole regex literal: its body (character classes read as units, so a `/` inside one does not
// end it) and its flags. The escape is looked for in the BODY afterwards — a reader that skipped
// `[…]` whole once let `/[\p{Cc}\p{Cf}\p{Cn}\p{Cs}]/u` through, and it killed the bundle again.
const REGEX_LITERAL =
    /(?:^|[(=,:[!&|?{};]|return)\s*\/((?:[^/\\\n[*]|\\.|\[(?:[^\]\\\n]|\\.)*\])(?:[^/\\\n[]|\\.|\[(?:[^\]\\\n]|\\.)*\])*)\/([dgimsuvy]*)/g;
const PROPERTY_ESCAPE = /\\[pP]\{/;
const PROPERTY_CONSTRUCTOR = /\bRegExp\(\s*(['"`])(?:[^\\]|\\.)*?\\\\[pP]\{/;
const V_FLAG_LITERAL =
    /(?:^|[(=,:[!&|?{};]|return)\s*\/(?:[^/\\\n[*]|\\.|\[(?:[^\]\\\n]|\\.)*\])(?:[^/\\\n[]|\\.|\[(?:[^\]\\\n]|\\.)*\])*\/[dgimsuy]*v[dgimsuy]*\b/;

function findings(code) {
    const found = [];
    for (const [, body, flags] of code.matchAll(REGEX_LITERAL)) {
        if (/[uv]/.test(flags) && PROPERTY_ESCAPE.test(body)) {
            found.push('a Unicode property escape in a regex literal');
            break;
        }
    }
    if (PROPERTY_CONSTRUCTOR.test(code)) found.push('a Unicode property escape handed to RegExp()');
    if (V_FLAG_LITERAL.test(code)) found.push('a regex literal with the `v` flag');
    return found;
}

const INCIDENTS = [
    'const isUnicodeAlpha = (c: string): boolean => c.codePointAt(0)! >= 0x80 && /^\\p{L}$/u.test(c);',
    'const NON_PRINTING = /[\\p{Cc}\\p{Cf}\\p{Cn}\\p{Cs}]/u;',
];
for (const incident of INCIDENTS) {
    if (findings(codeOf(incident, { inBlock: false })).length === 0) {
        console.error(
            `check-nativescript-no-icu-regex: the detector no longer matches an incident line:\n  ${incident}`,
        );
        process.exit(1);
    }
}

const closure = nsClosure(workspacePackages());
const failures = [];
let files = 0;
for (const [name, dir] of closure) {
    for (const path of sources(join(dir, 'src'))) {
        files++;
        const state = { inBlock: false };
        for (const [index, line] of readFileSync(path, 'utf8').split('\n').entries()) {
            for (const what of findings(codeOf(line, state))) {
                failures.push(`${relative(ROOT, path)}:${index + 1} (${name}): ${what}\n    ${line.trim()}`);
            }
        }
    }
}

if (closure.size === 0 || files === 0) {
    console.error('check-nativescript-no-icu-regex: the NS closure resolved to no source files — the layout moved.');
    process.exit(1);
}

if (failures.length > 0) {
    console.error(
        `check-nativescript-no-icu-regex: ${failures.length} construct(s) NativeScript's ICU-less V8 cannot compile:\n`,
    );
    for (const failure of failures) console.error(`  ${failure}`);
    console.error(
        '\nA regex literal compiles with its MODULE, so this kills the whole bundle at startup. Use a\n' +
            'generated table instead (see packages/web/adwaita-core/src/glib-unichar.ts).',
    );
    process.exit(1);
}

console.log(`check-nativescript-no-icu-regex: OK (${closure.size} packages, ${files} files)`);
