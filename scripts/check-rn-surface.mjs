#!/usr/bin/env node
// The support table covers exactly what react-native exports — no more, no fewer.
//
// ADR 0032 § 8 makes the table the single source three readers share (the bundler
// gate, the runtime, the generated README). That only holds if its KEY SET is the
// real export surface: a name the table forgets is indistinguishable from a name
// nobody has heard of, and the gate would have to guess which.
//
// TWO COMPARISONS, AND THE SECOND ONE IS OPTIONAL ON PURPOSE.
//
//   table  <->  react-native-surface.json     always, cheap
//   snapshot <-> the installed react-native   only when one is resolvable
//
// The snapshot is committed rather than derived on every run because
// `react-native` drags ~170 MB behind it (hermes-compiler alone is 47 MB) and every
// workspace install in CI would pay that for one list of strings. The cost of that
// choice is a blind spot — a snapshot can go stale against upstream — so this script
// closes it whenever the package IS present and PRINTS WHICH MODE IT RAN IN. A gate
// that silently degrades to the weaker half is the failure this repository keeps
// finding; one that says "snapshot only" out loud is a different thing.
//
// Self-testing, like its siblings: the source parser is exercised against fixtures
// that must parse and fixtures that must NOT, before it is pointed at the real file.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PKG = join(ROOT, 'packages/framework/react-native');
const TABLE_TS = join(PKG, 'src/support-table.ts');
const SNAPSHOT = join(PKG, 'react-native-surface.json');

const problems = [];
const fail = (message) => problems.push(message);

/**
 * The keys of the `SUPPORT_TABLE` object literal, from source.
 *
 * Source rather than the built `lib/`, so the gate runs on a cold checkout — the
 * same reason `check-vocabulary-alignment.mjs` reads source. The parse is
 * deliberately narrow: the object literal's own four-space-indented keys, between
 * the declaration and the first export that follows it. A nested object's keys are
 * indented further and a comment line starts with `/` or `*`, so neither is picked
 * up — both of which the self-test below pins.
 */
export function readTableKeys(source) {
    const start = source.indexOf('SUPPORT_TABLE: Readonly');
    if (start === -1) throw new Error('SUPPORT_TABLE declaration not found');
    const end = source.indexOf('\n};', start);
    if (end === -1) throw new Error('SUPPORT_TABLE literal is not terminated');
    const body = source.slice(start, end);
    const keys = [];
    for (const line of body.split('\n')) {
        const match = /^ {4}([A-Za-z_$][A-Za-z0-9_$]*):\s*\{/.exec(line);
        if (match) keys.push(match[1]);
    }
    return keys;
}

// --- self-test ---------------------------------------------------------------
//
// Six vectors. The three negatives are what make this a gate rather than a
// formality: a parser that also picked up nested keys or commented-out entries
// would report a surface that does not exist and pass every real comparison.

function selfTest() {
    const ok = (name, actual, expected) => {
        const a = JSON.stringify(actual);
        const e = JSON.stringify(expected);
        if (a !== e) fail(`self-test ${name}: expected ${e}, got ${a}`);
    };

    const wrap = (inner) =>
        `export const SUPPORT_TABLE: Readonly<Record<string, E>> = {\n${inner}\n};\nexport const X = 1;\n`;

    ok('flat keys', readTableKeys(wrap(`    View: { status: 'planned' },\n    Text: { status: 'planned' },`)), [
        'View',
        'Text',
    ]);
    ok(
        'multi-line entry',
        readTableKeys(wrap(`    View: {\n        status: 'planned',\n        reason: 'x',\n    },`)),
        ['View'],
    );
    ok('underscored name', readTableKeys(wrap(`    unstable_batchedUpdates: { status: 'supported' },`)), [
        'unstable_batchedUpdates',
    ]);
    // Negatives.
    ok('nested key is not an entry', readTableKeys(wrap(`    View: {\n        nested: { a: 1 },\n    },`)), ['View']);
    ok(
        'commented entry is not an entry',
        readTableKeys(wrap(`    // Gone: { status: 'planned' },\n    View: { status: 'planned' },`)),
        ['View'],
    );
    ok('string value is not an entry', readTableKeys(wrap(`    View: 'planned',`)), []);

    let threw = false;
    try {
        readTableKeys('nothing here');
    } catch {
        threw = true;
    }
    if (!threw) fail('self-test: a source without the declaration must throw, not return []');
}

// --- the comparisons ---------------------------------------------------------

const diff = (a, b) => a.filter((x) => !b.includes(x));

function compare(label, expected, actual, hintMissing, hintExtra) {
    const missing = diff(expected, actual);
    const extra = diff(actual, expected);
    if (missing.length > 0) fail(`${label}: ${missing.length} missing — ${missing.join(', ')}\n  ${hintMissing}`);
    if (extra.length > 0) fail(`${label}: ${extra.length} unexpected — ${extra.join(', ')}\n  ${hintExtra}`);
    return missing.length === 0 && extra.length === 0;
}

/**
 * react-native's public exports, from an installed copy — or `null` if there is none.
 *
 * The getters on `module.exports` in its `index.js`, read as TEXT rather than by
 * importing it: `require('react-native')` under Node evaluates a module written for
 * a React Native runtime and throws long before it has an export list.
 */
function readInstalledExports() {
    const require = createRequire(join(ROOT, 'package.json'));
    let indexPath;
    try {
        indexPath = require.resolve('react-native/index.js');
    } catch {
        return null;
    }
    if (!existsSync(indexPath)) return null;
    const source = readFileSync(indexPath, 'utf8');
    const names = new Set();
    for (const line of source.split('\n')) {
        const match = /^ {2}(?:get )?([A-Za-z_$][A-Za-z0-9_$]*)\s*[:(]/.exec(line);
        if (match) names.add(match[1]);
    }
    return [...names];
}

selfTest();

const snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
const declared = readTableKeys(readFileSync(TABLE_TS, 'utf8'));
const snapshotNames = snapshot.exports;

compare(
    'support table vs snapshot',
    snapshotNames,
    declared,
    'add the name to src/support-table.ts with a status and a one-line reason',
    'remove it, or correct the snapshot if react-native really dropped it',
);

// The generated refusing exports must match what the generator would emit now.
// A stale generated file is the quiet half of this whole mechanism: the table says
// `FlatList` is planned, the gate agrees, and `import { FlatList }` still resolves
// to nothing because the export was never regenerated after the entry was added.
{
    const generator = await import('../packages/framework/react-native/scripts/generate-exports.mjs');
    const entries = generator.readEntries(readFileSync(TABLE_TS, 'utf8'));
    const expected = generator.render(entries);
    const path = join(PKG, 'src/generated/unsupported-exports.ts');
    const actual = existsSync(path) ? readFileSync(path, 'utf8') : '';
    const hint = '  run: gjsify workspace @gjsify/react-native run generate';
    if (actual !== expected) fail(`src/generated/unsupported-exports.ts is stale\n${hint}`);

    // The README's support section is the table's THIRD reader (ADR 0032 § 8). It
    // drifts the most quietly of the three: nothing fails, a consumer just reads a
    // status that stopped being true.
    const table = generator.readTable(readFileSync(TABLE_TS, 'utf8'));
    const block = generator.renderReadmeTable(entries, table);
    const readme = readFileSync(join(PKG, 'README.md'), 'utf8');
    const begin = readme.indexOf(generator.README_BEGIN);
    const end = readme.indexOf(generator.README_END);
    if (begin === -1 || end === -1) {
        fail('README.md has lost the generated-support-table markers');
    } else if (readme.slice(begin, end + generator.README_END.length) !== block) {
        fail(`README.md's generated support section is stale\n${hint}`);
    }
}

const installed = readInstalledExports();
let mode;
if (installed === null) {
    mode = `snapshot only (react-native ${snapshot.reactNativeVersion}, read ${snapshot.readOn}) — react-native is not installed, so upstream drift is NOT checked here`;
} else {
    const agreed = compare(
        'snapshot vs installed react-native',
        installed,
        snapshotNames,
        'regenerate react-native-surface.json and give each new name a table entry',
        'regenerate react-native-surface.json — react-native no longer exports these',
    );
    mode = agreed
        ? `snapshot verified against the installed react-native (${snapshotNames.length} names)`
        : 'snapshot DISAGREES with the installed react-native';
}

const label = 'check-rn-surface';
if (problems.length > 0) {
    for (const problem of problems) console.error(`${label}: ${problem}`);
    console.error(`${label}: FAILED — ${mode}`);
    process.exit(1);
}
console.log(`${label}: self-test green — 7 vector(s).`);
console.log(`${label}: ${declared.length} React Native export(s) all carry a support status.`);
console.log(`${label}: ${mode}.`);
