#!/usr/bin/env node
// `hostTagOf` and `attributeOf` are authored twice, and this holds the two copies identical.
//
// WHY TWO COPIES EXIST AT ALL. The ORIGINAL is `@gjsify/adwaita-core/tags`
// (`packages/web/adwaita-core/src/tags.ts`) — published, Tier 2, renderer-free — so a
// markup tree BUILDER can depend on the two case rules an authored `SharedTreeNode` (ADR
// 0051) is turned into a DOM tag / attribute with. `scripts/adwaita-gallery-shared-trees.mjs`
// needs the same two functions and CANNOT import that package: its readers — the gallery
// generators and `check-generated-website-data.mjs` — run in `audit-runtimes.yml`'s `check`
// and `check-windows` jobs, which do `checkout` + `setup-node` and nothing else, so a bare
// `@gjsify/adwaita-core` specifier does not resolve. So that file keeps its own copy, the
// same shape `scripts/check-shared-tree-shape.mjs` already uses for `SharedTreeNode` itself:
// an original that decides the rule, and a restatement that says why it cannot import and is
// machine-held to match.
//
// WHAT IS COMPARED, AND WHAT IS NOT. Only the function BODY — everything from the arrow
// (`=>`) onward — never the signature it hangs off. That is deliberate, not an oversight: the
// original is TypeScript (`(gtype: string) => …`) and the restatement is plain `.mjs`
// (`(gtype) => …`), so a signature comparison would report a "divergence" that is only ever
// the type system doing its job. A body-only comparison also folds in the parameter NAME for
// free — `gtype` in one file and `x` in the other would already read as different bodies,
// because the body refers to it by name — so nothing about the identifier is lost by leaving
// the signature out. Comments and incidental whitespace are stripped before comparing, for
// the same reason the signature is not compared: neither changes what the function computes.
//
// WHAT THIS DOES NOT CATCH. Two implementations that read identical after this
// normalisation but disagree in what a comment or a signature type promises. Nothing here
// checks that; `tags.spec.ts` pins the ALGORITHM against named vectors (the acronym-boundary
// regression this rule exists because of — `GtkGLArea` -> `gtk-glarea` instead of
// `gtk-gl-area` — is one of them), and arm 11 of `check-generated-website-data.mjs` holds the
// `scripts/` copy of `hostTagOf` against every row of `gtk-host`'s own generated table. This
// gate is the one thing none of those are: proof the two SOURCE FILES cannot quietly drift
// from each other while both keep passing their own tests.
//
// Reads no `node_modules`: two files, plain text. Runs in `audit-runtimes.yml`'s `check` and
// `check-windows` jobs, beside `check-shared-tree-shape.mjs`.
//
// Usage: node scripts/check-tag-case-rules.mjs [--root <dir>]
// Exits 0 when both bodies agree, 1 on drift or a missing function, 2 on a usage error, a
// read error, or a self-test failure — the last meaning the comparison proves nothing.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripComments } from '../packages/infra/manifest-conformance/lib/strip-comments.mjs';

/** The functions held identical, and where each copy lives. */
const FUNCTIONS = [
    { name: 'hostTagOf', originalFile: 'packages/web/adwaita-core/src/tags.ts' },
    { name: 'attributeOf', originalFile: 'packages/web/adwaita-core/src/tags.ts' },
];

const RESTATEMENT_FILE = 'scripts/adwaita-gallery-shared-trees.mjs';

/**
 * The text of `export const <name> = (…) => …`, from just past the arrow to the end of the
 * function — a block's matching `}` inclusive, an expression's top-level `;` exclusive.
 * Never the parameter list: see the header for why the signature is deliberately not part
 * of what this compares.
 */
export function extractArrowBody(source, name) {
    const anchor = new RegExp(`export const ${name} = \\(`).exec(source);
    if (anchor === null) return undefined;
    const arrow = source.indexOf('=>', anchor.index);
    if (arrow === -1) return undefined;
    let i = arrow + 2;
    while (i < source.length && /\s/.test(source[i])) i++;
    if (i >= source.length) return undefined;

    if (source[i] === '{') {
        const start = i;
        let depth = 0;
        for (; i < source.length; i++) {
            const c = source[i];
            if (c === '{' || c === '(' || c === '[') depth++;
            else if (c === '}' || c === ')' || c === ']') {
                depth--;
                if (depth === 0) return source.slice(start, i + 1);
            }
        }
        return undefined; // never closed — not this function's problem to explain
    }

    const start = i;
    let depth = 0;
    for (; i < source.length; i++) {
        const c = source[i];
        if (c === '(' || c === '{' || c === '[') depth++;
        else if (c === ')' || c === '}' || c === ']') depth--;
        else if (c === ';' && depth === 0) return source.slice(start, i);
    }
    return undefined; // ran off the file with no top-level `;` — not a function this reads
}

/** Comments stripped, then every run of whitespace folded to one space. Order-preserving. */
function normalise(body) {
    return stripComments(body).replace(/\s+/g, ' ').trim();
}

// ------------------------------------------------------------------ self-test

const SELF_TEST_VECTORS = [
    [
        'a block body survives reformatting and a moved comment',
        'export const f = (x) => {\n    // a note\n    return x + 1;\n};',
        'export const f = (x) => {\n\n    return x /* keep */ + 1;\n\n};',
        'f',
        true,
    ],
    [
        'an expression body survives reformatting',
        'export const g = (x) => x.trim();',
        'export const g = (x) =>\n    x.trim();',
        'g',
        true,
    ],
    ['a one-token change is caught', 'export const h = (x) => x + 1;', 'export const h = (x) => x + 2;', 'h', false],
    [
        'a TS parameter type is not a body difference',
        'export const k = (x: string) => x.length;',
        'export const k = (x) => x.length;',
        'k',
        true,
    ],
];

function selfTest() {
    const failures = [];
    for (const [what, a, b, name, wantEqual] of SELF_TEST_VECTORS) {
        const bodyA = extractArrowBody(a, name);
        const bodyB = extractArrowBody(b, name);
        if (bodyA === undefined || bodyB === undefined) {
            failures.push(`  ${what}\n    the extractor found no ${name}(…) in one of its own fixtures`);
            continue;
        }
        const gotEqual = normalise(bodyA) === normalise(bodyB);
        if (gotEqual !== wantEqual) {
            failures.push(`  ${what}\n    expected equal=${wantEqual}, got equal=${gotEqual}`);
        }
    }
    return failures;
}

// ------------------------------------------------------------------ main

function usage() {
    return 'usage: node scripts/check-tag-case-rules.mjs [--root <dir>]';
}

function main() {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) {
        console.log(usage());
        return process.exit(0);
    }
    const rootFlag = args.indexOf('--root');
    const root = rootFlag === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : args[rootFlag + 1];
    const stray = args.filter((arg, i) => arg !== '--root' && !(rootFlag !== -1 && i === rootFlag + 1));
    if (stray.length > 0 || (rootFlag !== -1 && typeof root !== 'string')) {
        const why = stray.length > 0 ? `unknown argument(s): ${stray.join(', ')}` : '--root needs a directory';
        console.error(`check-tag-case-rules: ${why}\n  ${usage()}`);
        return process.exit(2);
    }

    const selfTestFailures = selfTest();
    if (selfTestFailures.length > 0) {
        console.error('check-tag-case-rules: its own comparison is broken, so it proves nothing.\n');
        for (const failure of selfTestFailures) console.error(`${failure}\n`);
        return process.exit(2);
    }

    let restatementSource;
    try {
        restatementSource = readFileSync(join(root, RESTATEMENT_FILE), 'utf8');
    } catch (error) {
        console.error(`check-tag-case-rules: cannot read ${RESTATEMENT_FILE}: ${error.message}`);
        return process.exit(2);
    }

    const failures = [];
    const sourceCache = new Map();
    for (const { name, originalFile } of FUNCTIONS) {
        if (!sourceCache.has(originalFile)) {
            try {
                sourceCache.set(originalFile, readFileSync(join(root, originalFile), 'utf8'));
            } catch (error) {
                failures.push(`cannot read ${originalFile}: ${error.message}`);
                continue;
            }
        }
        const originalSource = sourceCache.get(originalFile);
        if (originalSource === undefined) continue;

        const originalBody = extractArrowBody(originalSource, name);
        const restatedBody = extractArrowBody(restatementSource, name);
        if (originalBody === undefined) {
            failures.push(`${originalFile} no longer declares \`export const ${name} = (…) => …\``);
            continue;
        }
        if (restatedBody === undefined) {
            failures.push(`${RESTATEMENT_FILE} no longer declares \`export const ${name} = (…) => …\``);
            continue;
        }
        if (normalise(originalBody) !== normalise(restatedBody)) {
            failures.push(
                `${name}: ${RESTATEMENT_FILE} has drifted from its original, ${originalFile}.\n` +
                    `    ${originalFile}:\n      ${normalise(originalBody)}\n` +
                    `    ${RESTATEMENT_FILE}:\n      ${normalise(restatedBody)}`,
            );
        }
    }

    if (failures.length > 0) {
        console.error(`\ncheck-tag-case-rules: ${failures.length} problem(s):\n`);
        for (const failure of failures) console.error(`  - ${failure}\n`);
        console.error(
            `${RESTATEMENT_FILE} restates \`hostTagOf\`/\`attributeOf\` because it runs where\n` +
                "`@gjsify/adwaita-core` cannot be installed — see this script's own header. A restatement\n" +
                'that drifts fails in a CONSUMER of one copy or the other, silently, which is what this\n' +
                'gate exists to make loud instead.\n',
        );
        return process.exit(1);
    }

    console.log(
        `check-tag-case-rules: self-test green — ${SELF_TEST_VECTORS.length} vector(s). ` +
            `${FUNCTIONS.length} function(s) held identical between ${RESTATEMENT_FILE} and their originals.\n`,
    );
    return process.exit(0);
}

main();
