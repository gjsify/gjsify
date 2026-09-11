// E2E: a reported failure must reach the shell as a non-zero status — on BOTH
// runtimes, and identically.
//
// This suite is written as a DIFFERENTIAL, not as a list of expected codes, and
// that is the point. A gjsify command has two ways to fail: throw, or assign
// `process.exitCode` and return. Node honours the second at natural shutdown;
// GJS has no atexit hook, so until the entry grew `exitOnReportedFailure()`
// nothing read it back and the process ended **0** with the error already on
// stderr. Every `process.exitCode = …` call site was correct, so no lint rule
// could have seen it; only running the same argv on both hosts can.
//
// Measured on the v0.49.0 bundle, before the fix:
//
//     node lib/index.js         gresource broken.gresource.xml  → 1
//     gjs -m dist/cli.gjs.mjs   gresource broken.gresource.xml  → 0   ← the bug
//
// and the same split for `gsettings` and `barrels --check`.
//
// What it cost, and why `&&` was no defence (JumpLink/Learn6502#180): a script
// body `gjsify gresource … && echo SECOND` takes `gjsify run`'s SPAWN path, so
// the failing command is a CHILD gjs — which exited 0, so the chain ran its next
// step over a `.gresource` that was never written, and the script reported
// success. Chaining was the documented workaround for this class; it was
// protecting nothing. The last test here pins that shape directly.
//
// Asserting EQUALITY rather than "non-zero on gjs" is what makes this a gate for
// the class instead of for three commands: a new command that invents a third
// way to report a failure shows up as a disagreement between the two hosts,
// whichever host it happens to be wrong on.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { hasCommand, e2eSkipReason } from '../helpers.mjs';

const CLI_NODE_ENTRY = fileURLToPath(new URL('../../../packages/infra/cli/lib/index.js', import.meta.url));
const CLI_GJS_BUNDLE = fileURLToPath(new URL('../../../packages/infra/cli/dist/cli.gjs.mjs', import.meta.url));

/** A .gresource.xml naming a file that is not there — glib-compile-resources exits 1. */
const BROKEN_GRESOURCE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<gresources>
  <gresource prefix="/org/example/gjsify-exit-status">
    <file>does-not-exist.ui</file>
  </gresource>
</gresources>
`;

/** A truncated schema — glib-compile-schemas cannot parse it and exits 1. */
const BROKEN_GSCHEMA_XML = '<schemalist><schema id="org.example.broken"';

function runNode(cwd, args) {
    return spawnSync(process.execPath, [CLI_NODE_ENTRY, ...args], { cwd, encoding: 'utf-8', timeout: 60 * 1000 });
}

function runGjs(cwd, args) {
    return spawnSync('gjs', ['-m', CLI_GJS_BUNDLE, ...args], { cwd, encoding: 'utf-8', timeout: 120 * 1000 });
}

/**
 * Both hosts must refuse the same argv with the same non-zero status.
 *
 * The signal check comes first because a GJS crash (`m_should_exit`, a core
 * dump) also produces a non-zero-looking result while proving something else
 * entirely — `status` is null and `signal` carries the truth.
 */
function assertBothHostsFail(cwd, args, { what }) {
    const node = runNode(cwd, args);
    const gjs = runGjs(cwd, args);
    const out = (r) => `${r.stdout ?? ''}\n${r.stderr ?? ''}`;

    assert.equal(node.signal ?? null, null, `[node] ${what}: killed by a signal: ${node.signal}`);
    assert.equal(gjs.signal ?? null, null, `[gjs] ${what}: killed by a signal: ${gjs.signal}`);

    assert.notEqual(node.status, 0, `[node] ${what}: reported a failure but exited 0\n${out(node)}`);
    assert.notEqual(
        gjs.status,
        0,
        `[gjs] ${what}: reported a failure but exited 0 — \`process.exitCode\` was set and nothing\n` +
            `read it back at natural shutdown (see packages/infra/cli/src/utils/cli-exit.ts)\n${out(gjs)}`,
    );
    assert.equal(
        gjs.status,
        node.status,
        `${what}: the two hosts disagree on the exit status (node ${node.status}, gjs ${gjs.status}).\n` +
            `A failure must reach the shell the same way on both.\n[node]${out(node)}\n[gjs]${out(gjs)}`,
    );
}

describe('CLI exit status carries a reported failure (E2E)', { timeout: 5 * 60 * 1000 }, () => {
    let root;
    const skip = e2eSkipReason('cli-exit-status', [
        ['gjs on PATH', hasCommand('gjs')],
        ['the built dist/cli.gjs.mjs bundle', existsSync(CLI_GJS_BUNDLE)],
        ['the built lib/index.js entry', existsSync(CLI_NODE_ENTRY)],
        ['glib-compile-resources', hasCommand('glib-compile-resources')],
        ['glib-compile-schemas', hasCommand('glib-compile-schemas')],
    ]);

    before(() => {
        if (skip) return;
        root = mkdtempSync(join(tmpdir(), 'gjsify-e2e-exit-status-'));
        writeFileSync(join(root, 'broken.gresource.xml'), BROKEN_GRESOURCE_XML);
        mkdirSync(join(root, 'schemas'), { recursive: true });
        writeFileSync(join(root, 'schemas', 'broken.gschema.xml'), BROKEN_GSCHEMA_XML);
        writeFileSync(
            join(root, 'package.json'),
            JSON.stringify(
                {
                    name: 'exit-status-fixture',
                    version: '0.0.0',
                    private: true,
                    type: 'module',
                    scripts: {
                        // The Learn6502 shape: a leaf that fails, chained with
                        // `&&` so a failure is supposed to stop the chain.
                        'build:chained':
                            'gjsify gresource broken.gresource.xml --sourcedir . --target out.gresource && echo SECOND',
                    },
                },
                null,
                2,
            ) + '\n',
        );
    });

    after(() => {
        if (root && !process.env.GJSIFY_E2E_KEEP_TEMP) rmSync(root, { recursive: true, force: true });
    });

    it('gresource: a failing glib-compile-resources exits non-zero on both hosts', (t) => {
        if (skip) return t.skip(skip);
        assertBothHostsFail(
            root,
            ['gresource', 'broken.gresource.xml', '--sourcedir', '.', '--target', 'out.gresource'],
            { what: 'gjsify gresource' },
        );
    });

    it('gsettings: a failing glib-compile-schemas exits non-zero on both hosts', (t) => {
        if (skip) return t.skip(skip);
        assertBothHostsFail(root, ['gsettings', 'schemas'], { what: 'gjsify gsettings' });
    });

    it('barrels: a usage refusal that sets exitCode exits non-zero on both hosts', (t) => {
        if (skip) return t.skip(skip);
        // No glib involved — this one holds the rule on a host with neither
        // compiler, and it is the cheapest `process.exitCode = 1; return` in the
        // command surface.
        assertBothHostsFail(root, ['barrels', '--check'], { what: 'gjsify barrels --check' });
    });

    it('a chained script stops at the failing leaf instead of running the next step', (t) => {
        if (skip) return t.skip(skip);
        // The regression Learn6502#180 reported, in its original shape. `gjsify
        // run` sends a compound body to the shell, so the failing command is a
        // CHILD gjs — which is exactly the process that used to exit 0. Both
        // halves are asserted: the status the script reports, and the fact that
        // `&&` short-circuited. The second is the one that matters, because it
        // is what decides whether the next build step ran on a missing artifact.
        const res = runGjs(root, ['run', 'build:chained']);
        const out = `${res.stdout ?? ''}\n${res.stderr ?? ''}`;
        assert.equal(res.signal ?? null, null, `killed by a signal: ${res.signal}`);
        assert.doesNotMatch(
            out,
            /^SECOND$/m,
            `the chain continued past a failed \`gjsify gresource\` — \`&&\` saw a 0 from the child\n${out}`,
        );
        assert.notEqual(res.status, 0, `the script reported success over a failed leaf\n${out}`);
        assert.ok(!existsSync(join(root, 'out.gresource')), 'the fixture was supposed to produce no artifact');
    });
});
