// E2E test for the runtime-slot VOCABULARY: the names a package may put in
// `gjsify.runtimes`, who owns that list, and what happens to a declaration that misspells
// one.
//
// WHY IT EXISTS. `nativescript` was missing from `lib/index.d.ts` for the whole life of
// the 4th slot — the resolver read the key, the type denied it, and nothing compared the
// two. That is not a typo class, it is a structural one: the list lives in
// `runtime-aliases.mjs` as a `Set`, and every OTHER reader restates it, in a `.d.ts`
// union, in a JSDoc `@typedef`, in an interface's keys. TypeScript cannot check a `.d.ts`
// against a `Set`, so the first block below does it by reading both.
//
// THE SECOND HALF is `auditRuntimeShape`, the only thing standing between
// `runtimes: { reactNative: "polyfill" }` and silence: both readers iterate the KNOWN
// targets and look the declaration up by name, so a key nobody knows is visited by
// nothing and a package reads in review as having declared support it has not declared.
// A validator can be wrong in exactly one direction a repository-wide run cannot reveal —
// it finds nothing because there is nothing to find, which is what a broken one does too
// — so every case here is a synthetic row with a known answer, and each block carries a
// case that must NOT be flagged beside the cases that must.
//
// THE THIRD is the routing itself, against fixture packages rather than the workspace:
// `react-native` is declaration-only, so no workspace package declares it and every
// assertion made against the real tree today would be vacuously true. `findScanRoots`
// treats `<cwd>/node_modules/@gjsify` as a scan root, which is the seam the fixtures use.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e/runtime-slot-declarations/ → monorepo root is 3 levels up.
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const RESOLVE_NPM_LIB = join(MONOREPO_ROOT, 'packages', 'infra', 'resolve-npm', 'lib');
const AUDIT_SCRIPT = join(MONOREPO_ROOT, 'scripts', 'audit-runtimes.mjs');

const { VALID_SLOTS, VALID_TARGETS, getDerivedAliasesSync, resetRuntimeAliasesCache } = await import(
    `file://${join(RESOLVE_NPM_LIB, 'runtime-aliases.mjs')}`
);
// The gate guards its own `main()` behind an entry check, so importing it is inert.
const { auditRuntimeShape, diffDeclared, REACH_FATAL_TARGETS, REACH_TARGETS } = await import(`file://${AUDIT_SCRIPT}`);

const TARGETS = [...VALID_TARGETS];
const SLOTS = [...VALID_SLOTS];

describe('the slot vocabulary has exactly one owner', () => {
    const dts = readFileSync(join(RESOLVE_NPM_LIB, 'index.d.ts'), 'utf8');
    const mjs = readFileSync(join(RESOLVE_NPM_LIB, 'runtime-aliases.mjs'), 'utf8');

    /** Members of a `'a' | 'b'` union, from the source text rather than from a type. */
    const unionMembers = (source, pattern, what) => {
        const m = pattern.exec(source);
        assert.ok(m, `${what}: nothing matched ${pattern} — the parser, not the source, may be wrong`);
        return m[1]
            .split('|')
            .map((part) => part.trim().replace(/^'|'$/g, '').trim())
            .filter(Boolean)
            .sort();
    };

    /** Optional-property names of an object type / typedef body. */
    const propertyNames = (source, pattern, what) => {
        const m = pattern.exec(source);
        assert.ok(m, `${what}: nothing matched ${pattern} — the parser, not the source, may be wrong`);
        return [...m[1].matchAll(/'?([A-Za-z][\w-]*)'?\?\s*:/g)].map((hit) => hit[1]).sort();
    };

    it('the runtime that ROUTES knows react-native', () => {
        assert.ok(VALID_TARGETS.has('react-native'), 'react-native is not in VALID_TARGETS');
        assert.equal(TARGETS.length, new Set(TARGETS).size, 'VALID_TARGETS has a duplicate');
    });

    it('index.d.ts RuntimeTarget names every target VALID_TARGETS does', () => {
        assert.deepEqual(
            unionMembers(dts, /export type RuntimeTarget =([^;]+);/, 'RuntimeTarget'),
            [...TARGETS].sort(),
        );
    });

    it('index.d.ts RuntimeTriplet carries a property per target', () => {
        assert.deepEqual(
            propertyNames(dts, /export interface RuntimeTriplet \{([\s\S]*?)\n\}/, 'RuntimeTriplet (d.ts)'),
            [...TARGETS].sort(),
        );
    });

    it('index.d.ts RuntimeSlot names every slot VALID_SLOTS does', () => {
        assert.deepEqual(unionMembers(dts, /export type RuntimeSlot =([^;]+);/, 'RuntimeSlot'), [...SLOTS].sort());
    });

    it("runtime-aliases.mjs's own JSDoc names every target and slot", () => {
        assert.deepEqual(unionMembers(mjs, /@typedef \{([^}]+)\} Target/, 'Target typedef'), [...TARGETS].sort());
        assert.deepEqual(unionMembers(mjs, /@typedef \{([^}]+)\} Slot/, 'Slot typedef'), [...SLOTS].sort());
        assert.deepEqual(
            propertyNames(mjs, /@typedef \{\{([\s\S]*?)\}\} RuntimeTriplet/, 'RuntimeTriplet (JSDoc)'),
            [...TARGETS].sort(),
        );
    });
});

/** A `buildReport` row, reduced to the fields the two functions under test read. */
const row = (overrides) => ({
    name: '@gjsify/fixture',
    path: 'node/fixture',
    axis: 'node',
    signals: {
        has_test_entry: false,
        gjs_imports_guard: false,
        girs_value: false,
        gi_url: false,
        imports_legacy: false,
        dynamic_gi: false,
    },
    declared: null,
    suggested: null,
    ...overrides,
});

const WELL_FORMED = { gjs: 'polyfill', node: 'none', browser: 'none', nativescript: 'none', 'react-native': 'none' };

describe('auditRuntimeShape rejects what nothing else would notice', () => {
    /** @returns {string[]} the problems reported for a single declaration. */
    const problemsFor = (declared, extra = {}) => {
        const found = auditRuntimeShape([row({ declared, ...extra })]);
        assert.ok(found.length <= 1, 'one row cannot produce more than one entry');
        return found[0]?.problems ?? [];
    };

    it('passes a declaration that uses only known names and known values', () => {
        assert.deepEqual(problemsFor(WELL_FORMED), []);
        // Every individual slot value, so a case below failing means the VALUE was
        // rejected and not the vocabulary.
        for (const slot of SLOTS) assert.deepEqual(problemsFor({ node: slot }), []);
    });

    it('passes a row with no declaration at all', () => {
        assert.deepEqual(problemsFor(null), []);
        assert.deepEqual(problemsFor(undefined), []);
    });

    it('flags a runtime name nobody knows', () => {
        const problems = problemsFor({ reactNative: 'polyfill' });
        assert.equal(problems.length, 1);
        assert.match(problems[0], /unknown runtime "reactNative"/);
        // The message must name the alternatives, or the reader cannot act on it.
        for (const target of TARGETS) assert.ok(problems[0].includes(target), `${target} missing from the message`);
    });

    it('flags a slot value nobody knows, including null and a nested object', () => {
        assert.match(problemsFor({ node: 'Polyfill' })[0], /runtimes\.node is "Polyfill"/);
        assert.match(problemsFor({ node: null })[0], /runtimes\.node is null/);
        assert.match(problemsFor({ node: { slot: 'polyfill' } })[0], /runtimes\.node is \{"slot":"polyfill"\}/);
        assert.match(problemsFor({ node: ['polyfill'] })[0], /runtimes\.node is \["polyfill"\]/);
    });

    it('reports the FIRST problem per key, never a second one about the same key', () => {
        // An unknown key is not also judged on its value: the value of a key nothing reads
        // is not a fact about the package.
        assert.equal(problemsFor({ reactNative: 'Polyfill' }).length, 1);
    });

    it('flags a declaration that is not a runtime→slot map at all', () => {
        // `typeof [] === 'object'` used to let an ARRAY through to the key loop, where it
        // reported "unknown runtime \"0\"" — true, useless, and one problem per element.
        const fromArray = problemsFor(['polyfill', 'none']);
        assert.equal(fromArray.length, 1);
        assert.match(fromArray[0], /expected an object mapping runtime → slot/);
        // A bare string or number used to `continue` out in silence, while `resolve-npm`
        // drops the package from the alias cache entirely on the same input.
        for (const bogus of ['polyfill', 42, true]) {
            const problems = problemsFor(bogus);
            assert.equal(problems.length, 1, `${JSON.stringify(bogus)} produced ${problems.length} problem(s)`);
            assert.match(problems[0], /expected an object mapping runtime → slot/);
        }
    });

    it('treats an EMPTY declaration as no declaration — a decision, not an oversight', () => {
        assert.deepEqual(problemsFor({}), []);
    });

    it('attributes a problem to the package path when the manifest has no name', () => {
        const [found] = auditRuntimeShape([row({ name: undefined, declared: { reactNative: 'polyfill' } })]);
        assert.equal(found.name, 'node/fixture');
        assert.equal(found.path, 'node/fixture');
    });
});

describe('a malformed declaration is reported once, as malformed', () => {
    const SUGGESTED = { gjs: 'polyfill', node: 'none', browser: 'none', nativescript: 'none' };

    it('is skipped by the drift comparison rather than compared against undefined', () => {
        const malformed = row({ declared: { reactNative: 'polyfill' }, suggested: SUGGESTED });
        const shape = auditRuntimeShape([malformed]);
        assert.equal(shape.length, 1);

        const suppressed = diffDeclared([malformed], new Set(shape.map((p) => p.path)));
        assert.deepEqual(suppressed.drifted, []);
        assert.deepEqual(suppressed.missing, []);

        // The control: WITHOUT the suppression the same row drifts on every slot the
        // comparison has an opinion about, which is the four extra lines this exists to
        // keep out of the failure report.
        assert.equal(diffDeclared([malformed]).drifted.length, 1);
    });

    it('still drifts a WELL-FORMED declaration that disagrees with the signals', () => {
        const wrong = row({ declared: { gjs: 'none', node: 'none', browser: 'none' }, suggested: SUGGESTED });
        assert.deepEqual(auditRuntimeShape([wrong]), []);
        const { drifted } = diffDeclared([wrong], new Set());
        assert.equal(drifted.length, 1);
        // `nativescript` is undeclared (optional) and `react-native` is declaration-only,
        // so `gjs` is the only slot with something to say.
        assert.deepEqual(drifted[0].mismatches, ['gjs']);
    });
});

describe('the reachability pass covers every target the resolver routes', () => {
    it('audits every target except gjs', () => {
        assert.deepEqual([...REACH_TARGETS].sort(), TARGETS.filter((t) => t !== 'gjs').sort());
    });

    it('treats node as the ONE target where a GJS leak is loud', () => {
        for (const target of REACH_FATAL_TARGETS) {
            assert.ok(REACH_TARGETS.includes(target), `${target} is fatal but never audited`);
        }
        // The non-fatal branch prints a Node-specific explanation (`gjs://` routes to the
        // external `@gjsify/node-gi`), so a second non-fatal target would be described
        // wrongly. A 6th slot must land in one list or the other deliberately.
        assert.deepEqual(
            REACH_TARGETS.filter((t) => !REACH_FATAL_TARGETS.has(t)),
            ['node'],
        );
    });
});

describe('the 5th slot routes like the other four', () => {
    let tmpDir;
    let previousCwd;

    /** @param {string} name @param {object} manifest @param {boolean} [globals] */
    const fixture = (dir, name, manifest, globals = false) => {
        const pkgDir = join(dir, 'node_modules', '@gjsify', name);
        mkdirSync(pkgDir, { recursive: true });
        writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: `@gjsify/${name}`, ...manifest }));
        if (globals) writeFileSync(join(pkgDir, 'globals.mjs'), 'export {};\n');
    };

    before(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-runtime-slot-declarations-'));
        fixture(tmpDir, 'rn-polyfill', {
            gjsify: { runtimes: { 'react-native': 'polyfill', browser: 'polyfill' } },
            exports: { '.': './index.js', './react-native': './react-native.js' },
        });
        fixture(tmpDir, 'rn-native', { gjsify: { runtimes: { 'react-native': 'native' } } }, true);
        fixture(tmpDir, 'rn-typo', {
            gjsify: { runtimes: { reactNative: 'polyfill' } },
            exports: { '.': './index.js', './react-native': './react-native.js' },
        });
        // `findScanRoots` reads `<cwd>/node_modules/@gjsify` as an installed root, and the
        // cache is built once per process.
        previousCwd = process.cwd();
        process.chdir(tmpDir);
        resetRuntimeAliasesCache();
    });

    after(() => {
        process.chdir(previousCwd);
        resetRuntimeAliasesCache();
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it('routes a react-native polyfill to its declared platform entry', () => {
        const aliases = getDerivedAliasesSync('react-native');
        assert.equal(aliases['@gjsify/rn-polyfill'], '@gjsify/rn-polyfill/react-native');
    });

    it('routes a react-native native slot to its globals re-export', () => {
        assert.equal(getDerivedAliasesSync('react-native')['@gjsify/rn-native'], '@gjsify/rn-native/globals');
    });

    it('routes NOTHING for a package that spells the runtime reactNative', () => {
        // The same fixture ships the `./react-native` entry the routed one does, so the
        // only difference between them is the key — which is the whole point of
        // `auditRuntimeShape`.
        assert.equal(getDerivedAliasesSync('react-native')['@gjsify/rn-typo'], undefined);
        assert.deepEqual(getDerivedAliasesSync('reactNative'), {});
    });

    it('does not route a slot whose platform entry the package never declared', () => {
        // `rn-polyfill` declares `browser: "polyfill"` and no `./browser` subpath, so the
        // shared body IS the browser implementation — an empty answer here is a decision,
        // and the assertion above is what proves it is not an empty SCAN.
        assert.equal(getDerivedAliasesSync('browser')['@gjsify/rn-polyfill'], undefined);
    });
});
