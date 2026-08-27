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
export function readTableKeys(source, declaration = 'SUPPORT_TABLE') {
    // Anchored on `export const <NAME>: Readonly`, not on `<NAME>: Readonly`: the
    // router table's name ENDS with the react-native one's, so a bare substring
    // search silently reads the wrong declaration for whichever is asked second.
    const start = source.indexOf(`export const ${declaration}: Readonly`);
    if (start === -1) throw new Error(`${declaration} declaration not found`);
    const end = source.indexOf('\n};', start);
    if (end === -1) throw new Error(`${declaration} literal is not terminated`);
    const body = source.slice(start, end);
    const keys = [];
    for (const line of body.split('\n')) {
        const match = /^ {4}([A-Za-z_$][A-Za-z0-9_$]*):\s*\{/.exec(line);
        if (match) keys.push(match[1]);
    }
    return keys;
}

/**
 * Entries whose declared `tier` disagrees with the `// --- Pn: … ---` banner
 * they sit under.
 *
 * The banners are the only thing a reader SKIMMING this file has to go on, and
 * they are a second statement of the same fact — so they drift. Measured: three
 * entries (`AppState`, `PixelRatio`, `PlatformColor`) carried `tier: 'P3'` while
 * sitting above the P3 banner, so the data was right and the file read wrong.
 * Nothing at runtime could see it: `explainUnsupported` reads the field, not the
 * comment.
 *
 * Reported as a list rather than thrown, like every other comparison here.
 */
export function tierSectionMismatches(source) {
    const out = [];
    let section = null;
    let open = null;
    for (const line of source.split('\n')) {
        const banner = /^\s*\/\/ --- (P\d+):/.exec(line);
        if (banner !== null) {
            section = banner[1];
            open = null;
            continue;
        }
        if (open === null) {
            const start = /^ {4}(\w+): \{/.exec(line);
            if (start === null) continue;
            open = { name: start[1], tier: null };
            // A one-line entry opens and closes on the same line.
            const inline = /tier: '(P\d+)'/.exec(line);
            if (inline !== null) open.tier = inline[1];
            if (!/\},\s*$/.test(line)) continue;
        } else {
            const tier = /^\s*tier: '(P\d+)'/.exec(line);
            if (tier !== null) open.tier = tier[1];
            if (!/^ {4}\},\s*$/.test(line)) continue;
        }
        if (section !== null && open.tier !== null && open.tier !== section) {
            out.push(`${open.name} declares tier ${open.tier} but sits under the ${section} banner`);
        }
        open = null;
    }
    return out;
}

// --- self-test ---------------------------------------------------------------
//
// Six vectors. The three negatives are what make this a gate rather than a
// formality: a parser that also picked up nested keys or commented-out entries
// would report a surface that does not exist and pass every real comparison.

function selfTest() {
    // COUNTED, never written down. The summary line below used to print a literal
    // `7`, which is a claim about this function that this function does not make —
    // add a vector and the gate reports the old number, remove one and it reports a
    // vector that no longer runs. Both read as "the self-test is unchanged".
    let vectors = 0;
    const ok = (name, actual, expected) => {
        vectors++;
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
    vectors++;
    if (!threw) fail('self-test: a source without the declaration must throw, not return []');

    // The banner check, both directions. The negatives matter more than the
    // positive: a scanner that reported every entry, or none, would be green here
    // and useless against the file.
    const sectioned = (inner) => `    // --- P2: x ---\n${inner}\n    // --- P3: y ---\n`;
    ok(
        'a tier that disagrees with its banner is reported',
        tierSectionMismatches(sectioned(`    Foo: {\n        tier: 'P3',\n    },`)),
        ['Foo declares tier P3 but sits under the P2 banner'],
    );
    ok(
        'a tier that agrees with its banner is not',
        tierSectionMismatches(sectioned(`    Foo: {\n        tier: 'P2',\n    },`)),
        [],
    );
    ok(
        'an entry with no tier is not reported',
        tierSectionMismatches(sectioned(`    Foo: {\n        status: 'refused',\n    },`)),
        [],
    );
    ok('a one-line entry is read too', tierSectionMismatches(sectioned(`    Foo: { tier: 'P3' },`)), [
        'Foo declares tier P3 but sits under the P2 banner',
    ]);
    ok(
        'a tier inside a NESTED object is not the entry’s own',
        tierSectionMismatches(sectioned(`    Foo: {\n        limits: { tier: 'P3' },\n        tier: 'P2',\n    },`)),
        [],
    );
    ok(
        'an entry before any banner is not judged',
        tierSectionMismatches(`    Foo: {\n        tier: 'P3',\n    },\n`),
        [],
    );

    return vectors;
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

const selfTestVectors = selfTest();

const label = 'check-rn-surface';

const snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
const tableSource = readFileSync(TABLE_TS, 'utf8');
const declared = readTableKeys(tableSource);

// The banners are a second statement of each entry's tier, so they drift; nothing
// at runtime can see it, because the sentence reads the field and not the comment.
const misfiled = tierSectionMismatches(tableSource);
if (misfiled.length > 0) {
    fail(
        `${misfiled.length} entr${misfiled.length === 1 ? 'y sits' : 'ies sit'} under the wrong tier banner — ` +
            `${misfiled.join('; ')}\n  The data is right and the file READS wrong: move the entry, or move the banner.`,
    );
}
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
    const source = readFileSync(TABLE_TS, 'utf8');
    const readme = readFileSync(join(PKG, 'README.md'), 'utf8');
    const hint = '  run: gjsify workspace @gjsify/react-native run generate';
    for (const spec of generator.TABLES) {
        const entries = generator.readEntries(source, spec.declaration);
        const expected = generator.render(entries, spec.label);
        const relative = spec.out.slice(spec.out.indexOf('src/'));
        const actual = existsSync(spec.out) ? readFileSync(spec.out, 'utf8') : '';
        if (actual !== expected) fail(`${relative} is stale\n${hint}`);

        // The README's support section is the table's THIRD reader (ADR 0032 § 8). It
        // drifts the most quietly of the three: nothing fails, a consumer just reads a
        // status that stopped being true.
        const table = generator.readTable(source, spec.declaration);
        const block = generator.renderReadmeTable(entries, table, spec.begin, spec.end);
        const begin = readme.indexOf(spec.begin);
        const end = readme.indexOf(spec.end);
        if (begin === -1 || end === -1) {
            fail(`README.md has lost the ${spec.begin} markers`);
        } else if (readme.slice(begin, end + spec.end.length) !== block) {
            fail(`README.md's generated ${spec.label} support section is stale\n${hint}`);
        }
    }

    // THE TWO KEY SETS MUST BE DISJOINT. A name in both gives `explainUnsupported`
    // two answers and `isImportable` whichever table it looked in first — and the
    // collision is silent, because both lookups succeed. Checked here as well as in
    // the spec because this script is what a version bump runs.
    const rnKeys = readTableKeys(source, 'SUPPORT_TABLE');
    const routerKeys = readTableKeys(source, 'ROUTER_SUPPORT_TABLE');
    const both = routerKeys.filter((name) => rnKeys.includes(name));
    if (both.length > 0) {
        fail(
            `${both.length} name(s) are in BOTH support tables — ${both.join(', ')}\n` +
                '  a name belongs to one surface; rename or remove one of the entries',
        );
    }
    console.log(
        `${label}: ${routerKeys.length} expo-router name(s) declared, disjoint from the ${rnKeys.length} React Native ones.`,
    );
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

if (problems.length > 0) {
    for (const problem of problems) console.error(`${label}: ${problem}`);
    console.error(`${label}: FAILED — ${mode}`);
    process.exit(1);
}
console.log(`${label}: self-test green — ${selfTestVectors} vector(s).`);
console.log(`${label}: ${declared.length} React Native export(s) all carry a support status.`);
console.log(`${label}: ${mode}.`);
