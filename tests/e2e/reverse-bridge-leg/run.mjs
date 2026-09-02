// E2E test for the `reverse-bridge-leg` conformance rule: a package whose only route to
// Node is the `gi://` reverse bridge, and which declares `gjsify.runtimes.node:
// "polyfill"`, must run a Node suite CI actually reaches.
//
// WHY IT EXISTS, and why every case here is SYNTHETIC. The rule's subject is a claim no
// static reading can settle: `--app node` rewrites a `gi://` specifier to
// `@gjsify/node-gi`'s `requireGi(…)`, so a GJS-bound package's `none` and its `polyfill`
// are BOTH honest from the imports alone — which is precisely why `diffDeclared` carries
// the `giUrlReachesNodeBridge` tolerance and cannot decide. Twice the slot was wrong on
// main for the whole life of a package (ADR 0027 for `@gjsify/gtk-host`, ADR 0022
// § Amendment for `@gjsify/iframe`), and both times what settled it was a RUN.
//
// A repository-wide run can be wrong in exactly one direction it cannot reveal — it finds
// nothing because there is nothing to find, which is what a broken rule does too. So every
// block below is a synthetic tree with a known answer, and each carries the case that must
// NOT be flagged beside the cases that must. The one that matters most is the WIRED leg on
// a `node: "none"` package: that is CORRECT, and `@gjsify/sqlite` is exactly that shape,
// because on Node you use `node:sqlite` and its leg proves the BRIDGE. The rule was first
// written in the opposite direction and that package is what disproved it; the case is kept
// so the inversion cannot come back.
//
// The last block is against the REAL tree, and it is the half a fixture cannot assert: the
// leg the manifest promises is one a workflow really runs.

import { describe, it, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e/reverse-bridge-leg/ → monorepo root is 3 levels up.
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');

const { createContext } = await import(
    `file://${join(MONOREPO_ROOT, 'packages', 'infra', 'manifest-conformance', 'lib', 'index.mjs')}`
);
const { auditReverseBridgeLeg, collectWiredLegDirs, isGjsBound } = await import(
    `file://${join(MONOREPO_ROOT, 'scripts', 'manifest-conformance', 'rules', 'reverse-bridge-leg.mjs')}`
);

/** Every temp tree this file builds, removed together. */
const trees = [];
after(() => {
    for (const dir of trees) rmSync(dir, { recursive: true, force: true });
});

/**
 * @typedef {object} Step a workflow step, in the two `run:` spellings the rule must read.
 * @property {string} name
 * @property {string} [workingDirectory]
 * @property {string|string[]} run a string is written inline, an array as a `|` block.
 */

/**
 * A one-package workspace plus an optional workflow.
 *
 * @param {object} spec
 * @param {Record<string,string>} [spec.scripts] the package's `scripts`.
 * @param {string} [spec.node] the `gjsify.runtimes.node` slot.
 * @param {string} [spec.source] `src/index.ts`'s content — what decides GJS-boundness.
 * @param {Step[]} [spec.workflow] steps of a single `.github/workflows/ci.yml`.
 */
function tree({ scripts = {}, node = 'polyfill', source = '', workflow }) {
    const root = mkdtempSync(join(tmpdir(), 'reverse-bridge-leg-'));
    trees.push(root);
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'root', workspaces: ['packages/*'] }));
    const pkgDir = join(root, 'packages', 'thing');
    mkdirSync(join(pkgDir, 'src'), { recursive: true });
    writeFileSync(
        join(pkgDir, 'package.json'),
        JSON.stringify({
            name: '@acme/thing',
            scripts,
            gjsify: { runtimes: { gjs: 'polyfill', node, browser: 'none', nativescript: 'none' } },
        }),
    );
    writeFileSync(join(pkgDir, 'src', 'index.ts'), source);
    if (workflow) {
        mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
        const lines = ['jobs:', '  x:', '    steps:'];
        for (const step of workflow) {
            lines.push(`      - name: ${step.name}`);
            if (step.workingDirectory) lines.push(`        working-directory: ${step.workingDirectory}`);
            if (Array.isArray(step.run)) lines.push('        run: |', ...step.run.map((l) => `          ${l}`));
            else lines.push(`        run: ${step.run}`);
        }
        writeFileSync(join(root, '.github', 'workflows', 'ci.yml'), [...lines, ''].join('\n'));
    }
    return root;
}

/** The step every case is about: the node leg, as a `|` block, in `dir`. */
const legStep = (dir) => ({ name: 'leg', workingDirectory: dir, run: ['gjsify run test:gjs-on-node'] });

const audit = async (root) => auditReverseBridgeLeg(await createContext({ root, discoveryRoots: ['packages'] }));

/** A `gi://` import — the binding that puts a package in this rule's scope. */
const GI_SOURCE = "import GLib from 'gi://GLib?version=2.0';\nexport const x = GLib;\n";

describe('a GJS-bound package claiming the node slot must have a leg CI reaches', () => {
    it('fails when it has no node leg at all', async () => {
        const { failures } = await audit(tree({ source: GI_SOURCE, scripts: { test: 'gjsify run test:gjs' } }));
        assert.equal(failures.length, 1, failures.join('\n'));
        assert.match(failures[0], /packages\/thing\/package\.json/);
        assert.match(failures[0], /no Node suite CI reaches/);
    });

    it('fails when it ships `test:gjs-on-node` that NO workflow runs', async () => {
        // The shape that reads as coverage from the manifest alone, which is the whole
        // reason the workflow is read rather than the script being taken at its word.
        const { failures } = await audit(
            tree({ source: GI_SOURCE, scripts: { 'test:gjs-on-node': 'node dist/test.node.mjs' } }),
        );
        assert.equal(failures.length, 1, failures.join('\n'));
        assert.match(failures[0], /test:gjs-on-node/);
    });

    it('passes when a workflow runs that leg in the package directory', async () => {
        const { failures } = await audit(
            tree({
                source: GI_SOURCE,
                scripts: { 'test:gjs-on-node': 'node dist/test.node.mjs' },
                workflow: [legStep('packages/thing')],
            }),
        );
        assert.deepEqual(failures, []);
    });

    it('passes on the other route in: `test:node` invoked from `test`', async () => {
        const { failures } = await audit(
            tree({
                source: GI_SOURCE,
                scripts: { test: 'gjsify run build:test:node && gjsify run test:node', 'test:node': 'node d.mjs' },
            }),
        );
        assert.deepEqual(failures, []);
    });

    it('is not satisfied by a `test` that only BUILDS the node bundle', async () => {
        // `build:test:node` contains `test:node`; a substring test would call this covered.
        // The same trap `audit-test-scripts.mjs` records paying for.
        const { failures } = await audit(
            tree({
                source: GI_SOURCE,
                scripts: { test: 'gjsify run build:test:node && gjsify run test:gjs', 'test:node': 'node d.mjs' },
            }),
        );
        assert.equal(failures.length, 1, failures.join('\n'));
    });
});

describe('the cases that must NOT be flagged', () => {
    it('leaves a `node: "none"` package alone even with a wired leg (the @gjsify/sqlite shape)', async () => {
        // The inversion of this rule, written first and disproved by this exact shape: the
        // leg proves the BRIDGE, and `none` is right because on Node you use `node:sqlite`.
        const { failures } = await audit(
            tree({
                source: GI_SOURCE,
                node: 'none',
                scripts: { 'test:gjs-on-node': 'node dist/test.node.mjs' },
                workflow: [legStep('packages/thing')],
            }),
        );
        assert.deepEqual(failures, []);
    });

    it('leaves a package that is not GJS-bound alone', async () => {
        // Pure TS resolves to its own `lib/esm/index.js` on node — no bridge in the claim.
        const { failures } = await audit(tree({ source: 'export const x = 1;\n', scripts: {} }));
        assert.deepEqual(failures, []);
    });

    it('does not read a GUARDED `imports.gi` probe as a binding', async () => {
        // The sanctioned degradation shape: it exports null off GJS.
        const source = 'export const gi = globalThis.imports?.gi ?? null;\n';
        const root = tree({ source, scripts: {} });
        assert.equal(isGjsBound(join(root, 'packages', 'thing')), false);
        const { failures } = await audit(root);
        assert.deepEqual(failures, []);
    });
});

describe('the workflow read states what it could not answer', () => {
    it('fails on a node-leg step with no `working-directory`', async () => {
        const { failures } = await audit(
            tree({
                source: GI_SOURCE,
                scripts: { 'test:gjs-on-node': 'node d.mjs' },
                workflow: [{ name: 'leg', run: 'gjsify run test:gjs-on-node' }],
            }),
        );
        assert.ok(
            failures.some((f) => /no `working-directory`/.test(f)),
            failures.join('\n'),
        );
    });

    it('fails on a wired directory that is no package', async () => {
        const { failures } = await audit(
            tree({
                source: GI_SOURCE,
                scripts: { 'test:gjs-on-node': 'node d.mjs' },
                workflow: [legStep('packages/renamed-away')],
            }),
        );
        assert.ok(
            failures.some((f) => /is not a workspace package/.test(f)),
            failures.join('\n'),
        );
    });

    it('does not credit a `working-directory` from an EARLIER step', async () => {
        const { failures } = await audit(
            tree({
                source: GI_SOURCE,
                scripts: { 'test:gjs-on-node': 'node d.mjs' },
                workflow: [
                    { name: 'something else entirely', workingDirectory: 'packages/thing', run: 'echo hi' },
                    { name: 'the leg, in no directory of its own', run: 'gjsify run test:gjs-on-node' },
                ],
            }),
        );
        assert.ok(
            failures.some((f) => /no `working-directory`/.test(f)),
            failures.join('\n'),
        );
    });
});

describe('the real tree', () => {
    let wired;
    before(() => {
        wired = collectWiredLegDirs(MONOREPO_ROOT).dirs;
    });

    it("runs @gjsify/iframe's node leg from a workflow", () => {
        // The half no fixture can assert: the leg ADR 0022 § Amendment rests on is one CI
        // really runs. Red if the workflow step is dropped while the slot stays.
        assert.ok(wired.has('packages/framework/iframe'), [...wired].sort().join(', '));
    });

    it("runs @gjsify/gtk-host's node leg from a workflow", () => {
        assert.ok(wired.has('packages/framework/gtk-host'), [...wired].sort().join(', '));
    });

    it('has no finding of its own', async () => {
        const { failures } = await audit(MONOREPO_ROOT);
        assert.deepEqual(failures, []);
    });
});
