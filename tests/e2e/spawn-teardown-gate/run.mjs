// E2E: the gate that keeps CLI source behind the GJS teardown contract.
//
// `scripts/check-spawn-teardown-contract.mjs` is the mechanism half of #1012. The
// contract itself is exercised at runtime by `tests/e2e/spawn-gjs-teardown`, which boots
// the committed GJS bundle and asserts it terminates; this suite asserts the GATE — that
// it fails in every direction it claims to, and passes where it claims to.
//
// Every case drives a FIXTURE root through `--root`, including its own ledger, so nothing
// here depends on the state of the repository it runs in. That matters more than it
// sounds: a gate probed by mutating the real tree passes or fails for whatever else is in
// that tree, and `git stash` exits 0 with nothing to stash — the two ways this repo has
// already seen a "proof" that could not fail.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const GATE = join(REPO_ROOT, 'scripts', 'check-spawn-teardown-contract.mjs');
const CLI_SRC = ['packages', 'infra', 'cli', 'src'];

const created = [];

/**
 * Build a fixture root and run the gate against it.
 *
 * @param files   repo-relative path → contents, written under the fixture root
 * @param ledger  the ledger the gate should load, as `{ key: reason }`
 */
function runGate(files, ledger = {}) {
    const root = mkdtempSync(join(tmpdir(), 'gjsify-spawn-gate-'));
    created.push(root);
    mkdirSync(join(root, 'scripts'), { recursive: true });
    writeFileSync(
        join(root, 'scripts', 'spawn-teardown-exceptions.mjs'),
        `export const SPAWN_TEARDOWN_EXCEPTIONS = ${JSON.stringify(ledger, null, 4)};\n`,
    );
    mkdirSync(join(root, ...CLI_SRC), { recursive: true });
    for (const [rel, body] of Object.entries(files)) {
        const abs = join(root, ...rel.split('/'));
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, body);
    }
    const result = spawnSync(process.execPath, [GATE, '--root', root], { encoding: 'utf8' });
    return { ...result, output: `${result.stdout}${result.stderr}` };
}

/** A reason long enough to clear the gate's "worth reviewing" floor. */
const REASON =
    'A spec in a package with no GJS test leg, so the GJS rows of the teardown table are ' +
    'unreachable for it and there is no armed loop to tear down.';

/** A package.json for the fixture CLI package, with whatever test legs a case needs. */
function cliPackageJson(scripts = {}) {
    return JSON.stringify({ name: '@gjsify/cli', scripts }, null, 4);
}

const RAW_SPAWN = "import { spawn } from 'node:child_process';\nspawn('x');\n";

describe('check-spawn-teardown-contract: the gate', () => {
    it('passes a tree where nothing bypasses the helper', () => {
        const r = runGate({
            'packages/infra/cli/src/commands/fine.ts':
                "import { spawnToCompletion } from '../utils/spawn.js';\nawait spawnToCompletion('x', [], { completion: 'exit' });\n",
        });
        assert.equal(r.status, 0, r.output);
        assert.match(r.output, /no CLI source bypasses/);
    });

    it('FAILS on an unledgered raw async spawn', () => {
        const r = runGate({ 'packages/infra/cli/src/commands/bad.ts': RAW_SPAWN });
        assert.equal(r.status, 1, r.output);
        assert.match(r.output, /commands\/bad\.ts:1/);
        // The repair has to name the third row too, or a supervisor author reads the
        // message as "there is no way to do this" and adds a ledger entry instead.
        assert.match(r.output, /daemon/);
    });

    it('ignores spawnSync, which blocks and arms nothing', () => {
        const r = runGate({
            'packages/infra/cli/src/commands/sync.ts':
                "import { spawnSync } from 'node:child_process';\nspawnSync('x');\n",
        });
        assert.equal(r.status, 0, r.output);
    });

    it('ignores a type-only import, which binds no value', () => {
        const r = runGate({
            'packages/infra/cli/src/commands/types.ts':
                "import type { ChildProcess } from 'node:child_process';\nexport type X = ChildProcess;\n",
        });
        assert.equal(r.status, 0, r.output);
    });

    it('ignores the shape inside a comment, and is not derailed by one', () => {
        // The regression this pins: stripping BLOCK comments before line comments lets a
        // `@gjsify/*` inside a `//` comment open a bogus `/*`, after which the stripper
        // eats every following line — including real imports. Both must hold at once.
        const r = runGate({
            'packages/infra/cli/src/commands/commented.ts':
                "// never write: import { spawn } from 'node:child_process';\n" +
                "// see @gjsify/* for the helper\nimport { spawnToCompletion } from '../utils/spawn.js';\n",
            'packages/infra/cli/src/commands/after.ts': RAW_SPAWN,
        });
        assert.equal(r.status, 1, r.output);
        assert.doesNotMatch(r.output, /commented\.ts/);
        assert.match(r.output, /after\.ts:1/, 'a line comment must not hide a later real import');
    });

    it('FAILS on an access it cannot read, rather than skipping it', () => {
        const r = runGate({
            'packages/infra/cli/src/commands/dynamic.ts':
                "const cp = await import(\n    'node:child_process');\ncp.spawn('x');\n",
        });
        assert.equal(r.status, 1, r.output);
        assert.match(r.output, /cannot read/);
    });

    it('accepts a ledgered site whose precondition holds', () => {
        const r = runGate(
            {
                'packages/infra/cli/src/thing.spec.ts': RAW_SPAWN,
                'packages/infra/cli/package.json': cliPackageJson({ test: 'x', 'test:node': 'x' }),
            },
            { 'packages/infra/cli/src/thing.spec.ts': REASON },
        );
        assert.equal(r.status, 0, r.output);
        assert.match(r.output, /1 declared exception/);
        // Every deferral is printed on every run — a ledger nobody sees is a ledger
        // nobody prunes.
        assert.match(r.output, /declared: packages\/infra\/cli\/src\/thing\.spec\.ts/);
    });

    it('FAILS on a ledger entry whose file no longer imports spawn (self-retiring)', () => {
        const r = runGate(
            {
                'packages/infra/cli/src/thing.spec.ts': "import { spawnSync } from 'node:child_process';\n",
                'packages/infra/cli/package.json': cliPackageJson({ test: 'x' }),
            },
            { 'packages/infra/cli/src/thing.spec.ts': REASON },
        );
        assert.equal(r.status, 1, r.output);
        assert.match(r.output, /no longer imports async/);
    });

    it('FAILS on a ledger entry whose file is gone', () => {
        const r = runGate({}, { 'packages/infra/cli/src/vanished.spec.ts': REASON });
        assert.equal(r.status, 1, r.output);
        assert.match(r.output, /does not exist/);
    });

    it('FAILS when the package grows a GJS test leg, so the spec DOES run under GJS', () => {
        // The precondition, not the file, is what the entry was reviewed against. This is
        // the half a ledger normally lacks: the entry stays true-looking forever while the
        // fact underneath it changes.
        const r = runGate(
            {
                'packages/infra/cli/src/thing.spec.ts': RAW_SPAWN,
                'packages/infra/cli/package.json': cliPackageJson({ test: 'x', 'test:gjs': 'x' }),
            },
            { 'packages/infra/cli/src/thing.spec.ts': REASON },
        );
        assert.equal(r.status, 1, r.output);
        assert.match(r.output, /now declares a GJS test leg/);
    });

    it('FAILS on a non-spec ledger entry rather than quietly widening its own rule', () => {
        const r = runGate(
            {
                'packages/infra/cli/src/commands/daemonish.ts': RAW_SPAWN,
                'packages/infra/cli/package.json': cliPackageJson({ test: 'x' }),
            },
            { 'packages/infra/cli/src/commands/daemonish.ts': REASON },
        );
        assert.equal(r.status, 1, r.output);
        assert.match(r.output, /stated precondition does not cover it/);
    });

    it('FAILS on a reason too thin to have been reviewed', () => {
        const r = runGate(
            {
                'packages/infra/cli/src/thing.spec.ts': RAW_SPAWN,
                'packages/infra/cli/package.json': cliPackageJson({ test: 'x' }),
            },
            { 'packages/infra/cli/src/thing.spec.ts': 'it works' },
        );
        assert.equal(r.status, 1, r.output);
        assert.match(r.output, /no reason worth reviewing/);
    });

    it('refuses to ledger the module that owns the contract', () => {
        const r = runGate(
            { 'packages/infra/cli/src/utils/spawn.ts': RAW_SPAWN },
            { 'packages/infra/cli/src/utils/spawn.ts': REASON },
        );
        assert.equal(r.status, 1, r.output);
        assert.match(r.output, /owns the contract/);
    });
});

describe('check-spawn-teardown-contract: the repository itself', () => {
    it('passes on this tree', () => {
        const r = spawnSync(process.execPath, [GATE], { encoding: 'utf8', cwd: REPO_ROOT });
        assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    });
});

process.on('exit', () => {
    for (const dir of created) rmSync(dir, { recursive: true, force: true });
});
