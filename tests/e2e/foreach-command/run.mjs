// E2E test for `gjsify foreach` + `gjsify workspace <name>` (Phase D.4).
//
// Builds a synthetic monorepo with 3 workspaces, each with a tiny `echo`
// script that writes its workspace name to a unique file. Then drives
// the foreach command in sequential / parallel / topological modes and
// the workspace shortcut, asserting on the resulting filesystem state +
// the prefixed stdout.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

function runCli(cliEntry, args, { cwd, env, timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliEntry, ...args], {
      cwd, env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = ''; let stderr = '';
    child.stdout.setEncoding('utf-8'); child.stderr.setEncoding('utf-8');
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    const kill = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, timeoutMs);
    child.on('close', (code) => { clearTimeout(kill); resolve({ status: code, stdout, stderr }); });
    child.on('error', (e) => { clearTimeout(kill); reject(e); });
  });
}

describe('gjsify foreach + workspace (Phase D.4)', { timeout: 60_000 }, () => {
  let root, cliEntry;

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gjsify-e2e-foreach-'));
    cliEntry = new URL('../../../packages/infra/cli/lib/index.js', import.meta.url).pathname;

    // Root manifest declaring 3 packages/*.
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      name: 'foreach-monorepo', version: '0.0.0', private: true, type: 'module',
      workspaces: ['packages/*'],
    }, null, 2) + '\n');

    // Each workspace has the same `mark` script that touches a unique
    // file at <root>/marks/<name>. We also seed a `dependencies`
    // workspace ref from `app` → `core` → `utils` so `--topological`
    // has order to enforce.
    mkdirSync(join(root, 'marks'), { recursive: true });
    const workspaces = [
      { dir: 'utils', name: '@test/utils', deps: {} },
      { dir: 'core',  name: '@test/core',  deps: { '@test/utils': 'workspace:^' } },
      { dir: 'app',   name: '@test/app',   deps: { '@test/core':  'workspace:^' } },
    ];
    for (const w of workspaces) {
      const safeName = w.name.replace('/', '-');
      const markPath = join(root, 'marks', `${safeName}.txt`).replace(/'/g, "\\'");
      mkdirSync(join(root, 'packages', w.dir), { recursive: true });
      writeFileSync(join(root, 'packages', w.dir, 'package.json'), JSON.stringify({
        name: w.name, version: '0.0.1', type: 'module', private: false,
        dependencies: w.deps,
        scripts: {
          // `node -e ...` so the test doesn't depend on shell semantics.
          mark: `node -e "require('fs').writeFileSync('${markPath}', new Date().toISOString())"`,
          fail: `node -e "process.exit(1)"`,
          echo: `node -e "console.log('${w.name}')"`,
        },
      }, null, 2) + '\n');
    }
  });

  after(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('foreach <script> runs the script in every matching workspace', async () => {
    const r = await runCli(cliEntry, ['foreach', 'mark'], { cwd: root });
    assert.equal(r.status, 0, `foreach failed: ${r.stderr}\n${r.stdout}`);
    // All 3 marks must exist.
    for (const name of ['@test-utils', '@test-core', '@test-app']) {
      assert.ok(existsSync(join(root, 'marks', `${name}.txt`)),
        `marks/${name}.txt missing — foreach skipped a workspace`);
    }
  });

  it('foreach --include filters to matching workspaces', async () => {
    rmSync(join(root, 'marks'), { recursive: true, force: true });
    mkdirSync(join(root, 'marks'), { recursive: true });
    const r = await runCli(cliEntry, ['foreach', 'mark', '--include', '@test/utils'], { cwd: root });
    assert.equal(r.status, 0);
    assert.ok(existsSync(join(root, 'marks', '@test-utils.txt')), 'utils mark missing');
    assert.ok(!existsSync(join(root, 'marks', '@test-core.txt')), 'core mark should be skipped');
  });

  it('foreach --exclude removes matching workspaces', async () => {
    rmSync(join(root, 'marks'), { recursive: true, force: true });
    mkdirSync(join(root, 'marks'), { recursive: true });
    const r = await runCli(cliEntry, ['foreach', 'mark', '--exclude', '@test/app'], { cwd: root });
    assert.equal(r.status, 0);
    assert.ok(existsSync(join(root, 'marks', '@test-utils.txt')));
    assert.ok(existsSync(join(root, 'marks', '@test-core.txt')));
    assert.ok(!existsSync(join(root, 'marks', '@test-app.txt')), 'app should be excluded');
  });

  it('foreach --parallel prefixes stdout with [<workspace-name>]', async () => {
    const r = await runCli(cliEntry, ['foreach', 'echo', '--parallel'], { cwd: root });
    assert.equal(r.status, 0, `parallel failed: ${r.stderr}`);
    assert.match(r.stdout, /\[@test\/utils\]/);
    assert.match(r.stdout, /\[@test\/core\]/);
    assert.match(r.stdout, /\[@test\/app\]/);
  });

  it('foreach --topological orders deps before dependents', async () => {
    // `echo` is enough: assert utils-line appears before app-line in
    // the combined output (sequential topological run).
    const r = await runCli(cliEntry, ['foreach', 'echo', '--topological'], { cwd: root });
    assert.equal(r.status, 0);
    const idxUtils = r.stdout.indexOf('@test/utils');
    const idxCore  = r.stdout.indexOf('@test/core');
    const idxApp   = r.stdout.indexOf('@test/app');
    assert.ok(idxUtils < idxCore, `expected utils before core, got utils=${idxUtils} core=${idxCore}`);
    assert.ok(idxCore  < idxApp,  `expected core before app, got core=${idxCore} app=${idxApp}`);
  });

  it('foreach surfaces non-zero exit codes', async () => {
    const r = await runCli(cliEntry, ['foreach', 'fail'], { cwd: root });
    assert.notEqual(r.status, 0, 'expected failure for `fail` script');
  });

  it('workspace <name> <script> runs only that workspace\'s script', async () => {
    rmSync(join(root, 'marks'), { recursive: true, force: true });
    mkdirSync(join(root, 'marks'), { recursive: true });
    const r = await runCli(cliEntry, ['workspace', '@test/core', 'mark'], { cwd: root });
    assert.equal(r.status, 0, `workspace failed: ${r.stderr}`);
    assert.ok(existsSync(join(root, 'marks', '@test-core.txt')));
    assert.ok(!existsSync(join(root, 'marks', '@test-utils.txt')));
    assert.ok(!existsSync(join(root, 'marks', '@test-app.txt')));
  });

  it('workspace <name> errors clearly when workspace does not exist', async () => {
    const r = await runCli(cliEntry, ['workspace', '@nonexistent/foo', 'mark'], { cwd: root });
    assert.notEqual(r.status, 0);
    const combined = r.stdout + r.stderr;
    assert.match(combined, /no workspace named/i);
  });
});
