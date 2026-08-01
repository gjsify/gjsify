// E2E for `gjsify workspace <unknown-name>` clean-exit (regression).
//
// On a real user machine `gjsify workspace @gjsify/does-not-exist build`
// printed the yargs help then CRASHED:
//   TypeError: can't access property "manifest", <target> is undefined
//   Gjs:ERROR … m_should_exit assertion failed  → core dump
//
// Root cause was GJS-specific: `process.exit()` cannot terminate
// synchronously while a GLib.MainLoop is parked — it SCHEDULES the exit on a
// GLib.idle source and returns a pending Promise. The handler's bare
// `process.exit(1)` in the not-found guard therefore fell through to
// `target.manifest` (target === undefined) → throw → the entry's own
// `system.exit(1)` raced the already-scheduled exit into a SECOND
// `system.exit` → the `m_should_exit` assertion abort. Under Node
// `process.exit` halts synchronously, so this never reproduced there — the
// GJS leg below is the one that actually guards the crash.
//
// The handler now validates the name up front, prints a clear "did you mean"
// message, and `return`s the exit so exactly one exit is scheduled.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { hasCommand } from '../helpers.mjs';

const CLI_NODE_ENTRY = fileURLToPath(new URL('../../../packages/infra/cli/lib/index.js', import.meta.url));
const CLI_GJS_BUNDLE = fileURLToPath(new URL('../../../packages/infra/cli/dist/cli.gjs.mjs', import.meta.url));

function setupMonorepo(root) {
    writeFileSync(
        join(root, 'package.json'),
        JSON.stringify(
            { name: 'ws-fixture', version: '0.0.0', private: true, type: 'module', workspaces: ['packages/*'] },
            null,
            2,
        ) + '\n',
    );
    const pkgDir = join(root, 'packages', 'foo');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
        join(pkgDir, 'package.json'),
        JSON.stringify(
            { name: '@test/foo', version: '0.0.0', private: true, scripts: { build: 'node -e "\'\'"' } },
            null,
            2,
        ) + '\n',
    );
}

function runNode(cwd, args) {
    return spawnSync(process.execPath, [CLI_NODE_ENTRY, ...args], { cwd, encoding: 'utf-8', timeout: 30 * 1000 });
}

function runGjs(cwd, args) {
    return spawnSync('gjs', ['-m', CLI_GJS_BUNDLE, ...args], { cwd, encoding: 'utf-8', timeout: 60 * 1000 });
}

function assertCleanNotFound(res, { runtime }) {
    const out = `${res.stdout ?? ''}\n${res.stderr ?? ''}`;
    // Exit 1, and — crucially on GJS — NOT killed by a signal (a core dump
    // surfaces as `signal !== null`, e.g. SIGABRT from the m_should_exit
    // assertion).
    assert.equal(res.signal ?? null, null, `[${runtime}] process was killed by a signal (crash): ${res.signal}`);
    assert.equal(res.status, 1, `[${runtime}] expected exit 1, got ${res.status}\n${out}`);
    assert.match(out, /no workspace named/, `[${runtime}] missing the clear not-found message`);
    // None of the crash fingerprints may appear.
    assert.doesNotMatch(out, /m_should_exit/, `[${runtime}] m_should_exit assertion leaked`);
    assert.doesNotMatch(
        out,
        /can't access property|manifest.*undefined|undefined.*manifest/i,
        `[${runtime}] undefined deref leaked`,
    );
}

describe('gjsify workspace unknown-name clean exit (E2E)', { timeout: 3 * 60 * 1000 }, () => {
    let root;

    before(() => {
        root = mkdtempSync(join(tmpdir(), 'gjsify-e2e-ws-unknown-'));
        setupMonorepo(root);
    });

    after(() => {
        if (!process.env.GJSIFY_E2E_KEEP_TEMP) rmSync(root, { recursive: true, force: true });
    });

    it('Node: unknown workspace → exit 1 with a clear message (no crash)', () => {
        assertCleanNotFound(runNode(root, ['workspace', '@test/nonexistent', 'build']), { runtime: 'node' });
    });

    it('Node: a near-miss name suggests the closest workspace', () => {
        const res = runNode(root, ['workspace', '@test/fooo', 'build']);
        assert.equal(res.status, 1);
        assert.match(
            `${res.stdout}\n${res.stderr}`,
            /did you mean "@test\/foo"/,
            'expected a "did you mean" suggestion',
        );
    });

    it('GJS: unknown workspace exits cleanly under the bundled CLI (no m_should_exit crash)', (t) => {
        if (!hasCommand('gjs') || !existsSync(CLI_GJS_BUNDLE)) {
            t.skip('gjs or the committed cli.gjs.mjs bundle is not available');
            return;
        }
        assertCleanNotFound(runGjs(root, ['workspace', '@test/nonexistent', 'build']), { runtime: 'gjs' });
    });

    it('GJS: a near-miss name suggests the closest workspace (no crash)', (t) => {
        if (!hasCommand('gjs') || !existsSync(CLI_GJS_BUNDLE)) {
            t.skip('gjs or the committed cli.gjs.mjs bundle is not available');
            return;
        }
        const res = runGjs(root, ['workspace', '@test/fooo', 'build']);
        assert.equal(res.signal ?? null, null, `crashed: ${res.signal}`);
        assert.equal(res.status, 1, `expected exit 1, got ${res.status}\n${res.stdout}\n${res.stderr}`);
        assert.match(
            `${res.stdout}\n${res.stderr}`,
            /did you mean "@test\/foo"/,
            'expected a "did you mean" suggestion',
        );
    });
});
