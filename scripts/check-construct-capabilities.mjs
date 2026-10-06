#!/usr/bin/env node
// Every renderer answers for every template construct, and its suite proves the answer (ADR 0093 § 4).
//
// `driveConstructVectors` (`@gjsify/adwaita-core/conformance`) holds a renderer's table to the
// vectors from INSIDE one suite: a claim needs a vector, a refusal must throw, a table must be
// total. What it cannot see from there is whether a suite calls it at all, and a plain-JS
// consumer bypasses the table's type. So this gate holds, by reading source:
//
//   1. the vocabulary — `CONSTRUCT_KINDS` in `constructs.ts` — equals the key set of every
//      renderer's `./capabilities` table, and covers every kind the projection reports as a use;
//   2. each renderer's spec exists, calls `driveConstructVectors`, and is registered in the
//      renderer's test entry (a suite nothing runs proves nothing);
//   3. a `{ refused }` row carries a sentence, not an empty string.
//
// Reads files only, so it runs in a job that installs nothing.
//
// Usage: node scripts/check-construct-capabilities.mjs [--root <dir>]
// Exits 0 when everything agrees, 1 on a finding, 2 on a usage or read error.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripComments } from '../packages/infra/manifest-conformance/lib/strip-comments.mjs';

const args = process.argv.slice(2);
const rootAt = args.indexOf('--root');
const root =
    rootAt === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : (args[rootAt + 1] ?? process.exit(2));

const VOCABULARY = 'packages/web/adwaita-core/src/conformance/constructs.ts';
const PROJECTION = 'packages/infra/blueprint/src/project.mjs';

/** One renderer: its table, the spec that drives it, and the entry that runs the spec. */
const RENDERERS = [
    {
        name: 'gtk-host',
        table: 'packages/framework/gtk-host/src/capabilities.ts',
        spec: 'packages/framework/gtk-host/src/construct-vectors.spec.ts',
        entry: 'packages/framework/gtk-host/src/test.mts',
        suite: 'constructVectorsSuite',
    },
    {
        name: 'adwaita-web',
        table: 'packages/web/adwaita-web/src/capabilities.mjs',
        spec: 'packages/web/adwaita-web/src/construct-vectors.spec.ts',
        entry: 'packages/web/adwaita-web/src/test.browser.mts',
        suite: 'AdwConstructVectorsTest',
    },
    {
        name: 'adwaita-nativescript',
        table: 'packages/nativescript-bridge/adwaita/src/capabilities.ts',
        spec: 'packages/nativescript-bridge/adwaita/src/construct-vectors.spec.ts',
        entry: 'packages/nativescript-bridge/adwaita/src/test.trees.mts',
        suite: 'AdwConstructVectorsNsTest',
    },
];

const read = (path) => {
    try {
        return stripComments(readFileSync(join(root, path), 'utf8'));
    } catch (error) {
        console.error(`check-construct-capabilities: cannot read ${path}: ${error.message}`);
        process.exit(2);
    }
};

const problems = [];

const vocabularyText = read(VOCABULARY);
const kindsMatch = /CONSTRUCT_KINDS\s*=\s*\[([^\]]*)\]/.exec(vocabularyText);
if (kindsMatch === null) {
    console.error(`check-construct-capabilities: no CONSTRUCT_KINDS array in ${VOCABULARY}`);
    process.exit(2);
}
const kinds = [...kindsMatch[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);

// The projection's `usesOf` pushes `{ kind: '<kind>', … }`; each must be in the vocabulary.
const usesBlock = /const usesOf = [\s\S]*?\n};\n/.exec(read(PROJECTION))?.[0] ?? '';
const reported = new Set([...usesBlock.matchAll(/kind:\s*'([^']+)'/g)].map((match) => match[1]));
if (reported.size === 0) problems.push(`${PROJECTION}: \`usesOf\` reports no kind — the gate cannot read it.`);
for (const kind of reported) {
    if (!kinds.includes(kind))
        problems.push(`${PROJECTION} reports the use '${kind}', which ${VOCABULARY} does not list.`);
}

for (const renderer of RENDERERS) {
    const table = read(renderer.table);
    const body = /capabilities[^=]*=\s*\{([\s\S]*)\};?\s*$/.exec(table)?.[1] ?? '';
    // Top-level keys: an identifier at the start of a line, indented once — or a quoted name, which
    // is how a hyphenated kind such as `sibling-object` has to be written.
    const keys = [...body.matchAll(/^ {4}(?:(\w+)|'([^']+)'):/gm)].map((match) => match[1] ?? match[2]);
    const missing = kinds.filter((kind) => !keys.includes(kind));
    const extra = keys.filter((key) => !kinds.includes(key));
    if (missing.length > 0 || extra.length > 0) {
        problems.push(
            `${renderer.table}: the table is not total — missing [${missing.join(', ')}], unknown [${extra.join(', ')}].`,
        );
    }
    for (const match of body.matchAll(/refused:\s*(['"`])([\s\S]*?)\1/g)) {
        if (match[2].trim().length < 10)
            problems.push(`${renderer.table}: a refusal reason is not a sentence: "${match[2]}".`);
    }
    if (!/driveConstructVectors\s*\(/.test(read(renderer.spec))) {
        problems.push(`${renderer.spec} does not call driveConstructVectors for ${renderer.name}.`);
    }
    const entry = read(renderer.entry);
    const registered = new RegExp(`run\\(\\{[\\s\\S]*\\b${renderer.suite}\\b[\\s\\S]*\\}\\)`).test(entry);
    if (!registered) problems.push(`${renderer.entry} does not run ${renderer.suite} inside run({…}).`);
}

if (problems.length > 0) {
    console.error('check-construct-capabilities: FAILED\n');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
}
console.log(
    `check-construct-capabilities: ${kinds.length} construct kind(s) [${kinds.join(', ')}], ` +
        `${RENDERERS.length} renderer table(s) total over them, each driven by a registered suite.`,
);
