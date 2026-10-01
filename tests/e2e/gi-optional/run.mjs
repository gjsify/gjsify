// E2E: a `gi://Ns?version=X&optional` import of an ABSENT typelib starts (ADR 0086).
//
// The control is the same program without the flag: it must keep dying at load, so the
// first row cannot pass by the namespace happening to exist on the host.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MONOREPO_ROOT } from '../helpers.mjs';
import { runCli } from '../mock-registry.mjs';

const CLI_ENTRY = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'index.js');

// A namespace no host has, so the suite measures absence everywhere.
const ABSENT = 'GjsifyNoSuchNamespace';

function hasGjs() {
    const r = spawnSync('gjs', ['--version'], { stdio: 'ignore' });
    return r.status === 0 && r.error === undefined;
}

describe('an optional gi:// import', { timeout: 5 * 60 * 1000, skip: hasGjs() ? false : 'no gjs on PATH' }, () => {
    let projectDir;

    async function build(name, source) {
        writeFileSync(join(projectDir, 'src', `${name}.ts`), source);
        const built = await runCli(
            CLI_ENTRY,
            ['build', `src/${name}.ts`, '--app', 'gjs', '--outfile', `dist/${name}.js`],
            { cwd: projectDir, env: process.env, timeoutMs: 4 * 60 * 1000 },
        );
        assert.equal(built.status, 0, `gjsify build failed:\n${built.stdout}\n${built.stderr}`);
        return join(projectDir, 'dist', `${name}.js`);
    }

    const run = (file) => spawnSync('gjs', ['-m', file], { cwd: projectDir, encoding: 'utf-8', timeout: 60 * 1000 });

    before(() => {
        if (!existsSync(CLI_ENTRY)) {
            throw new Error(`CLI entry not built: ${CLI_ENTRY} — run \`gjsify workspace @gjsify/cli run build\``);
        }
        projectDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-gi-optional-'));
        mkdirSync(join(projectDir, 'src'), { recursive: true });
        writeFileSync(
            join(projectDir, 'package.json'),
            JSON.stringify({ name: 'gi-optional-fixture', version: '0.0.0', private: true, type: 'module' }) + '\n',
        );
    });

    after(() => {
        if (projectDir) rmSync(projectDir, { recursive: true, force: true });
    });

    it('starts without the typelib and hands the app `undefined`', async () => {
        const file = await build(
            'optional',
            `import Ns from 'gi://${ABSENT}?version=1.0&optional';\nconsole.log('ns:' + (Ns === undefined ? 'absent' : 'present'));\n`,
        );
        const r = run(file);
        assert.equal(r.status, 0, `the bundle did not start:\n${r.stdout}\n${r.stderr}`);
        assert.match(r.stdout, /ns:absent/);
    });

    it('names the namespace, version and cause in the diagnostic', async () => {
        const r = run(join(projectDir, 'dist', 'optional.js'));
        const out = r.stdout + r.stderr;
        assert.match(out, new RegExp(`optional GI namespace ${ABSENT} 1\\.0 is not available`));
        assert.match(out, /not found/);
    });

    it('keeps the clean specifier in the bundle, flag removed', () => {
        const bundle = readFileSync(join(projectDir, 'dist', 'optional.js'), 'utf-8');
        assert.ok(bundle.includes(`gi://${ABSENT}?version=1.0`), 'the verbatim specifier is not in the bundle');
        assert.ok(!bundle.includes('&optional'), 'the flag leaked into the emitted specifier');
    });

    it('control: the same import without the flag still fails at load', async () => {
        const file = await build('hard', `import Ns from 'gi://${ABSENT}?version=1.0';\nconsole.log(typeof Ns);\n`);
        const r = run(file);
        assert.notEqual(r.status, 0, 'an unflagged absent typelib must keep failing');
        assert.match(r.stdout + r.stderr, /not found/);
    });
});
