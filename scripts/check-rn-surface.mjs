#!/usr/bin/env node
// The support table covers exactly what react-native exports — no more, no fewer.
//
// ADR 0032 § 8 makes the table the single source three readers share (the bundler
// gate, the runtime, the generated `SUPPORT.md`). That only holds if its KEY SET is the
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

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// Statically, not on demand: the self-test below exercises the generator's export
// parser before anything is compared with it, and that runs first.
import * as generator from '../packages/framework/react-native/scripts/generate-exports.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PKG = join(ROOT, 'packages/framework/react-native');
const TABLE_TS = join(PKG, 'src/support-table.ts');
// The generator's own, not a second spelling of the same two paths: it WRITES one of
// them, and a check that guessed where would go green against a file nobody updates.
const INDEX_TS = generator.INDEX;
const OWN_TS = generator.OWN_OUT;
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
 * SCOPED PER TABLE, and that is not a detail. This file holds two of them —
 * `SUPPORT_TABLE` and `ROUTER_SUPPORT_TABLE` — and the second has no banners at
 * all. A scanner that carried the last banner across the boundary judged all 13
 * router entries against the main table's closing `// --- P3 ---` and reported
 * them as misfiled. MEASURED: it turned `main` red, because the check landed in
 * one PR and the router table in another and neither run saw both.
 *
 * Reported as a list rather than thrown, like every other comparison here.
 */
export function tierSectionMismatches(source) {
    const out = [];
    let section = null;
    let open = null;
    for (const line of source.split('\n')) {
        // A new top-level declaration starts a new scope: a banner belongs to the
        // table it was written inside, and says nothing about the next one.
        if (/^export const \w+/.test(line)) {
            section = null;
            open = null;
            continue;
        }
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

/**
 * The specifiers a module star-re-exports (`export * from '…'`).
 *
 * WHY THIS IS A COMPARISON AT ALL. A surface is only answered if something IMPORTS its
 * generated refusals: the module is written from the table, the triple comparison above
 * holds it against the generator, and neither of those can see whether any file in the
 * package re-exports it. MEASURED: the async-storage surface's generated module was
 * imported by NOTHING — legitimately empty today, so both comparisons were green on it,
 * and the day a name in that table stopped being answered the refusal would have been
 * generated, checked, and reachable from no import in the package.
 *
 * Masked through the generator's own `maskSource`, for the reason the own-export
 * derivation is: a commented-out or quoted `export * from` is documentation, and the
 * negatives below pin both.
 */
export function readStarReExports(source) {
    const out = [];
    const mask = generator.maskSource(source);
    for (const match of mask.matchAll(/export\s+\*\s+from\s*(['"])/g)) {
        const open = match.index + match[0].length - 1;
        const close = mask.indexOf(match[1], open + 1);
        if (close === -1) continue;
        out.push(source.slice(open + 1, close));
    }
    return out;
}

/** Every `.ts` under `dir`, recursively, that is neither generated nor a spec. */
function packageSources(dir) {
    return readdirSync(dir, { recursive: true, encoding: 'utf8' })
        .filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.includes('generated'))
        .map((name) => join(dir, name));
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

    // Every shape react-native's own index.js writes, and the two it writes that
    // must NOT be read. The generic method is why this vector set exists: across
    // 0.85 → 0.86 the SAME export stopped being a getter and grew a type parameter,
    // and a reader expecting `(` right after the name reported it as removed. The
    // `defineProperty` block is the mirror image: in 0.87 the same rewrite moved
    // `Touchable` into a stub whose getter THROWS, so counting it would report a
    // removed name as an export — and its `configurable`/`get()` lines would be read
    // as exports of their own by anything that did not stop at the literal.
    ok(
        'index members: getter, method, generic method — and nothing after the literal',
        exportNamesFromIndex(
            [
                "const invariant = require('invariant');",
                'module.exports = {',
                '  get Alert() {',
                "    return require('./Libraries/Alert/Alert').default;",
                '  },',
                '  unstable_batchedUpdates<T>(fn: (bookkeeping: T) => void, bookkeeping: T) {',
                '    fn(bookkeeping);',
                '  },',
                '  Systrace: {',
                '    beginEvent() {},',
                '  },',
                '};',
                "Object.defineProperty(module.exports, 'Touchable', {",
                '  configurable: true,',
                '  get() {',
                '    invariant(false, "Touchable has been removed from react-native core.");',
                '  },',
                '});',
            ].join('\n'),
        ),
        ['Alert', 'unstable_batchedUpdates', 'Systrace'],
    );

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
    // The vector that was missing, and it cost a red `main`: a banner belongs to
    // the table it was written inside. A SECOND table in the same file starts with
    // no section, so nothing in it is judged.
    ok(
        'a banner does not reach into the next table',
        tierSectionMismatches(
            `    // --- P3: y ---\n    Old: {\n        tier: 'P3',\n    },\n};\n` +
                `export const OTHER_TABLE = {\n    New: {\n        tier: 'P1',\n    },\n};\n`,
        ),
        [],
    );
    ok(
        'a banner inside the SECOND table still judges it',
        tierSectionMismatches(
            `};\nexport const OTHER_TABLE = {\n    // --- P2: z ---\n    New: {\n        tier: 'P1',\n    },\n};\n`,
        ),
        ['New declares tier P1 but sits under the P2 banner'],
    );

    // The OWN-EXPORT parser. The negatives carry this one: it decides which names
    // the build gate lets through WITHOUT a table entry, so a name it invents is a
    // name nothing checks, and a name it drops is a build failure for an import the
    // README tells a reader to write.
    const NO_STAR = () => {
        throw new Error('no star expected in this vector');
    };
    const exportsOf = (source, resolve = NO_STAR) => generator.readModuleExports(source, '/m/index.ts', resolve).sort();

    ok('named re-exports', exportsOf(`export { A, B } from './x.js';`), ['A', 'B']);
    ok('a renamed re-export reports the name it EXPORTS', exportsOf(`export { B as C } from './x.js';`), ['C']);
    ok('declarations', exportsOf(`export const a = 1;\nexport function b() {}\nexport class C {}`), ['C', 'a', 'b']);
    ok('a namespace re-export is one name', exportsOf(`export * as ns from './x.js';`), ['ns']);
    // Types erase before anything runs, which is why the gate does not judge one
    // either — both spellings.
    ok('a type-only re-export is not a value', exportsOf(`export type { T } from './x.js';`), []);
    ok('an inline type specifier is not a value', exportsOf(`export { type T, V } from './x.js';`), ['V']);
    ok('an interface is not a value', exportsOf(`export interface I { a: number }`), []);
    // The three a text scan gets wrong, and all three appear in the real file.
    ok('an export in a line comment is not one', exportsOf(`// export { Ghost } from './x.js';\nexport const a = 1;`), [
        'a',
    ]);
    ok('an export in a block comment is not one', exportsOf(`/*\nexport { Ghost } from './x.js';\n*/`), []);
    ok('an export inside a string is not one', exportsOf("export const doc = `export { Ghost } from './x.js';`;"), [
        'doc',
    ]);
    // `export *` carries no names of its own, so the derivation has to follow it —
    // a re-exported name it could not see would be refused by the gate.
    ok(
        'a star re-export is followed',
        exportsOf(`export * from './gen.js';`, () => ({ file: '/m/gen.ts', source: `export const G = 1;` })),
        ['G'],
    );
    vectors++;
    let starThrew = false;
    try {
        generator.readModuleExports(`export * from 'other-package';`, '/m/index.ts', generator.resolveStarFromDisk);
    } catch {
        starThrew = true;
    }
    if (!starThrew) fail('self-test: a star re-export that cannot be followed must throw, not silently narrow');

    // THE REFUSAL READER, which is what replaced the byte comparison. Its negatives
    // are the whole point: it has to read what the FORMATTER emits, not what the
    // generator emits, because those differ for two of the eighteen surfaces.
    ok(
        'reads a single-line refusal',
        generator.readRefusals("export const Modal = unsupported('Modal', 'react-native');").map((r) => r.name),
        ['Modal'],
    );
    ok(
        'reads a refusal the formatter WRAPPED over four lines',
        generator
            .readRefusals(
                'export const setStatusBarNetworkActivityIndicatorVisible = unsupported(\n' +
                    "    'setStatusBarNetworkActivityIndicatorVisible',\n    'expo-status-bar',\n);",
            )
            .map((r) => `${r.name}@${r.module}`),
        ['setStatusBarNetworkActivityIndicatorVisible@expo-status-bar'],
    );
    ok(
        'keeps the BINDING apart from the name, so a renamed export is visible',
        generator.readRefusals("export const Other = unsupported('Modal', 'react-native');").map((r) => r.binding),
        ['Other'],
    );
    ok('reads nothing out of a module with nothing to refuse', generator.readRefusals('// nothing here'), []);
    ok(
        'does not read a refusal out of a COMMENT',
        generator
            .readRefusals("// export const Ghost = unsupported('Ghost', 'x');\nexport const A = unsupported('A', 'y');")
            .map((r) => r.name),
        ['A'],
    );

    // THE STAR-RE-EXPORT READER, which is what holds a generated module to an import.
    // Its negatives are the same three a text scan gets wrong, and the comparison
    // below counts matches per surface — so a reader that saw one too many would
    // report the wrong file as the answerer.
    ok('reads a star re-export specifier', readStarReExports("export * from './x.js';"), ['./x.js']);
    ok('reads every one, not just the first', readStarReExports("export * from './a.js';\nexport * from '../b.js';"), [
        './a.js',
        '../b.js',
    ]);
    ok('a NAMED re-export is not a star one', readStarReExports("export { A } from './x.js';"), []);
    ok('a star re-export in a COMMENT is not one', readStarReExports("// export * from './x.js';"), []);
    ok('a star re-export in a STRING is not one', readStarReExports("const doc = `export * from './x.js';`;"), []);
    ok(
        'a namespace re-export is not a star one',
        readStarReExports("export * as ns from './x.js';\nexport * from './y.js';"),
        ['./y.js'],
    );

    // THE SURFACE REGISTRY PARSER (ADR 0036). It decides which specifiers the gate
    // watches and which subpath the alias rewrites to, so a row it drops is a surface
    // that silently stops being answered, and a row it invents is an alias onto a
    // subpath that does not exist. The negatives carry it, as everywhere else here.
    const surfaceSource = (rows) => `export const SURFACES: readonly Surface[] = [\n${rows}\n];\nexport const X = 1;\n`;
    const rootRow =
        "    {\n        module: 'react-native',\n        target: PACKAGE,\n        label: 'React Native',\n" +
        "        declaration: 'SUPPORT_TABLE',\n        table: SUPPORT_TABLE,\n        unknown: STALE,\n    },";
    const subRow =
        "    {\n        module: 'expo-font',\n        target: `${PACKAGE}/expo-font`,\n        label: 'expo-font',\n" +
        "        declaration: 'EXPO_FONT_TABLE',\n        table: EXPO_FONT_TABLE,\n        unknown: D('expo-font'),\n    },";
    ok(
        'the root row keeps the package itself as its target',
        generator.readSurfaces(surfaceSource(rootRow)).map((s) => [s.module, s.target, s.slug]),
        [['react-native', '@gjsify/react-native', 'react-native']],
    );
    ok(
        'a subpath row derives its target and its generated module',
        generator.readSurfaces(surfaceSource(subRow)).map((s) => [s.module, s.target, s.slug]),
        [['expo-font', '@gjsify/react-native/expo-font', 'expo-font']],
    );
    ok(
        'a scoped module name survives the parse',
        generator
            .readSurfaces(
                surfaceSource(
                    "    {\n        module: '@react-native-async-storage/async-storage',\n" +
                        '        target: `${PACKAGE}/async-storage`,\n' +
                        "        label: '@react-native-async-storage/async-storage',\n" +
                        "        declaration: 'ASYNC_STORAGE_TABLE',\n        table: T,\n        unknown: U,\n    },",
                ),
            )
            .map((s) => s.module),
        ['@react-native-async-storage/async-storage'],
    );
    ok(
        'every row is read, not just the first',
        generator.readSurfaces(surfaceSource(`${rootRow}\n${subRow}`)).length,
        2,
    );
    // Negatives. A row missing a field must THROW rather than produce a half surface:
    // a row with no declaration would make the generator read the wrong table, and a
    // row with no target would make the alias rewrite onto `undefined`.
    for (const [name, broken] of [
        ['no declaration', rootRow.replace("        declaration: 'SUPPORT_TABLE',\n", '')],
        ['no module', rootRow.replace("        module: 'react-native',\n", '')],
        ['no target', rootRow.replace('        target: PACKAGE,\n', '')],
    ]) {
        vectors++;
        let threwRow = false;
        try {
            generator.readSurfaces(surfaceSource(broken));
        } catch {
            threwRow = true;
        }
        if (!threwRow) fail(`self-test: a SURFACES row with ${name} must throw, not parse`);
    }
    vectors++;
    let emptyThrew = false;
    try {
        generator.readSurfaces('export const SURFACES: readonly Surface[] = [\n];\n');
    } catch {
        emptyThrew = true;
    }
    if (!emptyThrew) fail('self-test: an empty SURFACES literal must throw — every reader would then watch nothing');

    ok(
        'the tables keep every name they judge',
        generator.readOwnExports(`export { View, configureStyle } from './x.js';`, '/m/index.ts', ['View'], NO_STAR),
        ['configureStyle'],
    );
    ok(
        'the generated list reads back as the names that went in',
        generator.readOwnExportNames(generator.renderOwnExports(['configureStyle', 'primitives'])),
        ['configureStyle', 'primitives'],
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
 *
 * A MEMBER CAN CARRY TYPE PARAMETERS, and missing that reported a real export as
 * removed. Measured across the 0.85 → 0.86 bump: `unstable_batchedUpdates` stopped
 * being a getter and became `unstable_batchedUpdates<T>(fn, bookkeeping)` — the same
 * export, one line rewritten — and a reader that expected `(` or `:` immediately
 * after the name skipped it. The snapshot update would then have said upstream
 * dropped a name it still exports, in the file whose whole job is to be the
 * comparison. The generic list may not contain a `(`, which is what keeps this from
 * swallowing the parameter list itself.
 */
function readInstalledExports() {
    const require = createRequire(join(ROOT, 'package.json'));
    let indexPath;
    try {
        // THE BARE SPECIFIER, and the subpath is what made this whole branch dead
        // code. `react-native/index.js` is not in the package's `exports` map — not
        // in 0.85, 0.86 or 0.87 — so `require.resolve` threw
        // ERR_PACKAGE_PATH_NOT_EXPORTED, the `catch` read it as "not installed", and
        // the script SAID upstream drift was not checked while the package sat in
        // `node_modules`. The bare specifier resolves to exactly the same file
        // through the map's `.` entry. Measured on this tree, which installs 0.87.1.
        indexPath = require.resolve('react-native');
    } catch {
        return null;
    }
    if (!existsSync(indexPath)) return null;
    const manifest = join(dirname(indexPath), 'package.json');
    const version = existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')).version : null;
    return { version, exports: exportNamesFromIndex(readFileSync(indexPath, 'utf8')) };
}

/**
 * The member names of the one object literal `index.js` assigns to `module.exports`.
 *
 * SCOPED TO THE LITERAL, which is both halves of being right here. Below it,
 * react-native writes `Object.defineProperty(module.exports, 'AsyncStorage', …)`
 * blocks whose getter THROWS — "has been removed from react-native core" — so a
 * reader that counted them would report removed names as exports. And those blocks
 * are `{ configurable: true, get() {…} }` at two-space indent, so a reader that did
 * not stop at the literal's `};` invented the exports `configurable` and `get`.
 * Measured on 0.87.1, where the same rewrite moved `Touchable` and
 * `InteractionManager` from real getters into exactly those stubs.
 *
 * A member may carry TYPE PARAMETERS: across 0.85 → 0.86 `unstable_batchedUpdates`
 * stopped being a getter and became `unstable_batchedUpdates<T>(fn, bookkeeping)`,
 * the same export with one line rewritten, and a pattern expecting `(` or `:`
 * straight after the name reported it as dropped. The generic list may not contain
 * a `(`, so it cannot swallow the parameter list itself.
 */
export function exportNamesFromIndex(source) {
    const names = new Set();
    let inLiteral = false;
    for (const line of source.split('\n')) {
        if (!inLiteral) {
            if (/^module\.exports = \{\s*$/.test(line)) inLiteral = true;
            continue;
        }
        if (/^\}/.test(line)) break;
        const match = /^ {2}(?:get )?([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:<[^(]*>)?\s*[:(]/.exec(line);
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
    const source = readFileSync(TABLE_TS, 'utf8');
    const hint = '  run: gjsify workspace @gjsify/react-native run generate';
    const surfaces = generator.readSurfaces(source);
    const sections = [];
    const judgedNames = [];
    // TWO POPULATIONS OF "JUDGED", answering different questions. The ROOT table's
    // names are what `src/index.ts`' own exports are subtracted from — it is the root
    // module, so no other surface's table can judge one of its exports. EVERY surface's
    // names are what the collision check further down uses, so a root export sharing a
    // name with another surface fails loudly there instead of vanishing from the
    // derived list and being refused by the gate for a name the package exports.
    const rootJudged = [];

    // ONE ROW PER MODULE, and one target per row. Two rows claiming `expo-font` would
    // make `surfaceFor` answer from whichever came first — silently, because both
    // lookups succeed — which is the collision the registry replaced the old
    // disjointness invariant with.
    const seenModules = new Set();
    const seenTargets = new Set();
    for (const surface of surfaces) {
        if (seenModules.has(surface.module)) fail(`two SURFACES rows claim the module "${surface.module}"`);
        if (seenTargets.has(surface.target)) fail(`two SURFACES rows claim the target "${surface.target}"`);
        seenModules.add(surface.module);
        seenTargets.add(surface.target);
    }

    // EVERY TARGET MUST BE A DECLARED SUBPATH. A row whose target the `exports` map
    // does not carry is a gate that refuses an import and an alias that rewrites it
    // onto a specifier a consumer's Node cannot resolve — loud, and pointing at the
    // wrong thing.
    const manifest = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8'));
    const declaredSubpaths = new Set(Object.keys(manifest.exports ?? {}));
    for (const surface of surfaces) {
        const subpath =
            surface.target === generator.PACKAGE ? '.' : `.${surface.target.slice(generator.PACKAGE.length)}`;
        if (!declaredSubpaths.has(subpath)) {
            fail(
                `SURFACES row "${surface.module}" targets ${surface.target}, which package.json#exports does not ` +
                    `declare (looked for "${subpath}")`,
            );
        }
    }

    // Read once: the re-export comparison below asks the same set of files per surface.
    const sources = packageSources(join(PKG, 'src')).map((file) => ({
        relative: file.slice(file.indexOf('src/')),
        text: readFileSync(file, 'utf8'),
    }));

    for (const surface of surfaces) {
        const entries = generator.readEntries(source, surface.declaration);
        if (entries.length === 0) fail(`${surface.declaration} (${surface.module}) declares no names at all`);
        for (const entry of entries) {
            judgedNames.push(entry.name);
            if (surface.target === generator.PACKAGE) rootJudged.push(entry.name);
        }
        const relative = surface.out.slice(surface.out.indexOf('src/'));
        const actual = existsSync(surface.out) ? readFileSync(surface.out, 'utf8') : '';
        // THE (name, module) SET, not the bytes — the rule the own-export comparison
        // further down already states: `run generate` pipes these through `gjsify
        // format`, so the exact bytes are the FORMATTER's claim and the generator's
        // claim is the set. Byte-comparing them called two of the eighteen surfaces
        // permanently stale (a trailing blank line the formatter collapses, and a
        // `setStatusBarNetworkActivityIndicatorVisible` call long enough to wrap over
        // four lines) no matter how often they were regenerated.
        const expected = generator.readRefusals(generator.render(entries, surface.label, surface.module));
        const found = generator.readRefusals(actual);
        const key = (r) => `${r.binding}=${r.name}@${r.module}`;
        compare(
            `${relative}`,
            expected.map(key),
            found.map(key),
            `the table judges it and no refusing export carries it\n${hint}`,
            `nothing in the table judges it any more\n${hint}`,
        );
        // The header is what says the file is generated, and a hand-edited module that
        // happened to keep the right exports would otherwise pass.
        if (!actual.includes('GENERATED by scripts/generate-exports.mjs')) {
            fail(`${relative} has lost its generated-by header\n${hint}`);
        }
        // AND SOMETHING MUST RE-EXPORT IT, which neither comparison above can see: a
        // generated module no file imports is a refusal that exists on disk and is
        // unreachable at runtime. Counted rather than merely found, because two files
        // re-exporting one surface's refusals is the `export *` tie whose loser is
        // silent.
        const answerers = sources.filter((source) =>
            readStarReExports(source.text).some((specifier) => specifier.endsWith(`/unsupported-${surface.slug}.js`)),
        );
        if (answerers.length !== 1) {
            fail(
                `${relative} is star-re-exported by ${answerers.length} module(s)` +
                    `${answerers.length === 0 ? '' : ` — ${answerers.map((source) => source.relative).join(', ')}`}` +
                    `, and a surface's refusals must come from exactly one: none means the refusals are ` +
                    `unreachable, two means an \`export *\` tie whose loser is silent`,
            );
        }
        sections.push(
            generator.renderSurfaceSection(surface, entries, generator.readTable(source, surface.declaration)),
        );
    }

    // The support document is the table's THIRD reader (ADR 0032 § 8, ADR 0036 § 6).
    // It drifts the most quietly of the three: nothing fails, a consumer just reads a
    // status that stopped being true. Compared byte for byte, because the whole file
    // is generated and there are no markers to lose.
    const expectedDoc = generator.renderSupportDoc(sections);
    const actualDoc = existsSync(generator.SUPPORT_DOC) ? readFileSync(generator.SUPPORT_DOC, 'utf8') : '';
    if (actualDoc !== expectedDoc) fail(`SUPPORT.md is stale\n${hint}`);

    // THE PROP SURFACE (ADR 0039), the second published table, with the same third
    // reader. `@gjsify/react-native/prop-table` has to be a real subpath — without it
    // a consumer's build-time test cannot import the answers at all, which is the
    // whole point of publishing them — and `PROPS.md` is generated from the same
    // `primitives/table.ts` the renderer executes, so it is compared byte for byte
    // exactly as `SUPPORT.md` is. `readPropSurface` IMPORTS that table rather than
    // parsing it; the generator's own header says why a parser is the wrong tool
    // there, and why the two modules it loads may hold no relative value import.
    if (!declaredSubpaths.has('./prop-table')) {
        fail(
            'package.json#exports does not declare "./prop-table" — the published prop surface (ADR 0039) is ' +
                'unreachable, and a consumer can then only discover a refused prop by rendering',
        );
    }
    const expectedProps = generator.renderPropDoc(await generator.readPropSurface());
    const actualProps = existsSync(generator.PROP_DOC) ? readFileSync(generator.PROP_DOC, 'utf8') : '';
    if (actualProps !== expectedProps) fail(`PROPS.md is stale\n${hint}`);

    console.log(
        `${label}: ${surfaces.length} surface(s) declared — ${surfaces.map((surface) => surface.module).join(', ')}.`,
    );

    // THE SECOND POPULATION the § 8 build gate answers for: the names this layer adds
    // on top of react-native's surface, which by construction have no table entry.
    // Compared as a NAME SET rather than byte-for-byte like the modules above, and
    // the difference is deliberate: `run generate` pipes this file through `gjsify
    // format`, so its exact bytes are the formatter's claim while the derivation's
    // claim is the set.
    const derivedOwn = generator.readOwnExports(readFileSync(INDEX_TS, 'utf8'), INDEX_TS, rootJudged);
    const committedOwn = generator.readOwnExportNames(readFileSync(OWN_TS, 'utf8'));
    const ownAgreed = compare(
        'own exports vs src/index.ts',
        derivedOwn,
        committedOwn,
        'src/index.ts exports it and no table judges it, so the gate has to let it through\n' + hint,
        'nothing exports it under that name any more, and the gate would still let it through\n' + hint,
    );
    // A name the gate lets through WITHOUT a table entry must not also be one a table
    // judges. `isImportable` asks the tables first, so a collision would be silent —
    // the derived list would be describing a name it does not decide.
    const judgedToo = committedOwn.filter((name) => judgedNames.includes(name));
    if (judgedToo.length > 0) {
        fail(
            `${judgedToo.length} own export(s) are also support-table names — ${judgedToo.join(', ')}\n` +
                '  a name belongs to one population, and the table owns its own',
        );
    }
    console.log(
        `${label}: ${committedOwn.length} own export(s) beyond React Native's surface${ownAgreed ? '' : ' — STALE'}.`,
    );
}

const installed = readInstalledExports();
let mode;
if (installed === null) {
    mode = `snapshot only (react-native ${snapshot.reactNativeVersion}, read ${snapshot.readOn}) — react-native is not installed, so upstream drift is NOT checked here`;
} else if (installed.version !== snapshot.reactNativeVersion) {
    // TWO VERSIONS ARE TWO QUESTIONS, and comparing them as one would fail this
    // check for doing its job. The snapshot records the release this LAYER tracks —
    // the one its consumer ships on — and `node_modules` holds whatever the
    // workspace resolves, which is `@gjsify/adwaita-react-native`'s `>=0.87 <1`
    // (its "a stock app needs no configuration" claim rests on `metro-resolver`
    // 0.87). A set difference between two releases is not drift, it is the
    // difference between them; what would be a defect is not KNOWING, which is the
    // state this branch was in for its whole life.
    const ahead = diff(installed.exports, snapshotNames);
    const behind = diff(snapshotNames, installed.exports);
    const parts = [];
    if (ahead.length > 0) parts.push(`${installed.version} adds ${ahead.join(', ')}`);
    if (behind.length > 0) parts.push(`${installed.version} no longer exports ${behind.join(', ')}`);
    mode =
        `snapshot is react-native ${snapshot.reactNativeVersion} (read ${snapshot.readOn}); this tree resolves ` +
        `${installed.version}` +
        (parts.length > 0 ? ` — ${parts.join('; ')}` : ' — identical export sets');
} else {
    const agreed = compare(
        'snapshot vs installed react-native',
        installed.exports,
        snapshotNames,
        'regenerate react-native-surface.json and give each new name a table entry',
        'regenerate react-native-surface.json — react-native no longer exports these',
    );
    mode = agreed
        ? `snapshot verified against the installed react-native ${installed.version} (${snapshotNames.length} names)`
        : `snapshot DISAGREES with the installed react-native ${installed.version}`;
}

if (problems.length > 0) {
    for (const problem of problems) console.error(`${label}: ${problem}`);
    console.error(`${label}: FAILED — ${mode}`);
    process.exit(1);
}
console.log(`${label}: self-test green — ${selfTestVectors} vector(s).`);
console.log(`${label}: ${declared.length} React Native export(s) all carry a support status.`);
console.log(`${label}: ${mode}.`);
