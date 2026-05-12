// E2E test for `gjsify install --immutable` (Phase D.6).
//
// Verifies CI-mode behaviour:
//   - Lockfile MUST exist (no implicit resolve).
//   - Drift between `package.json` and `gjsify-lock.json#requested`
//     surfaces a concrete error naming the added/removed deps.
//   - When in sync: install reads the lockfile verbatim, populates
//     `node_modules/`, and does NOT rewrite the lockfile bytes (the
//     guarantee CI depends on).
//   - `--immutable` is incompatible with `<pkg>` args and `--global`.
//
// Reuses the in-process mock-registry harness from
// `tests/e2e/native-install-project/run.mjs`. We start clean each test
// run, perform one initial seeding install (without --immutable) to get
// a fresh lockfile, then exercise the immutable-mode behaviours against
// it.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

// ----- tar helpers (ustar v0 with a single package.json entry) -----
const BLOCK = 512;
function tarHeader(name, size, type = '0') {
  const buf = Buffer.alloc(BLOCK);
  buf.write(name, 0, Math.min(name.length, 100));
  buf.write('0000644', 100, 7); buf[107] = 0;
  buf.write('0000000', 108, 7); buf[115] = 0;
  buf.write('0000000', 116, 7); buf[123] = 0;
  buf.write(size.toString(8).padStart(11, '0'), 124, 11); buf[135] = 0;
  buf.write('0'.repeat(11), 136, 11); buf[147] = 0;
  buf.fill(0x20, 148, 156);
  buf.write(type, 156, 1);
  buf.write('ustar\0', 257, 6);
  buf.write('00', 263, 2);
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += buf[i];
  buf.write(sum.toString(8).padStart(6, '0'), 148, 6); buf[154] = 0; buf[155] = 0x20;
  return buf;
}
function buildPackageTar(pkgJson) {
  const body = Buffer.from(JSON.stringify(pkgJson, null, 2) + '\n');
  const padded = Buffer.alloc(Math.ceil(body.length / BLOCK) * BLOCK);
  body.copy(padded);
  return Buffer.concat([
    tarHeader('package/', 0, '5'),
    tarHeader('package/package.json', body.length),
    padded,
    Buffer.alloc(BLOCK * 2),
  ]);
}
function sriSha512(bytes) {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
}

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

describe('gjsify install --immutable (Phase D.6)', { timeout: 90_000 }, () => {
  let server, registryUrl, cliEntry, envForCli;

  const PACKAGES = {
    'leaf-dep': { versions: { '1.0.0': { dependencies: {} } } },
    'mid-dep':  { versions: { '2.1.0': { dependencies: { 'leaf-dep': '^1.0.0' } } } },
  };

  before(async () => {
    const index = {};
    for (const [name, info] of Object.entries(PACKAGES)) {
      index[name] = { name, 'dist-tags': {}, versions: {} };
      let last = '';
      for (const [version, body] of Object.entries(info.versions)) {
        const tar = buildPackageTar({ name, version, ...body });
        const tgz = gzipSync(tar);
        index[name].versions[version] = {
          name, version,
          dependencies: body.dependencies ?? {},
          dist: { tarball: `__BASE__/-/${name}/${version}.tgz`, integrity: sriSha512(tgz) },
          _tgz: tgz,
        };
        last = version;
      }
      index[name]['dist-tags'].latest = last;
    }

    server = createServer((req, res) => {
      try {
        const url = req.url ?? '';
        const tarMatch = url.match(/^\/-\/([^/]+)\/([^/]+)\.tgz$/);
        if (tarMatch) {
          const v = index[tarMatch[1]]?.versions[tarMatch[2]];
          if (!v) { res.writeHead(404).end('not found'); return; }
          res.writeHead(200, { 'content-type': 'application/octet-stream' });
          res.end(v._tgz);
          return;
        }
        const pkgName = decodeURIComponent(url.replace(/^\//, ''));
        const p = index[pkgName];
        if (!p) { res.writeHead(404).end('not found'); return; }
        const baseUrl = `http://127.0.0.1:${server.address().port}`;
        const wire = JSON.parse(JSON.stringify(p, (k, v) => k === '_tgz' ? undefined : v));
        for (const v of Object.values(wire.versions)) {
          v.dist.tarball = v.dist.tarball.replace('__BASE__', baseUrl);
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(wire));
      } catch (e) { res.writeHead(500).end(String(e)); }
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    registryUrl = `http://127.0.0.1:${server.address().port}/`;

    cliEntry = new URL('../../../packages/infra/cli/lib/index.js', import.meta.url).pathname;
    envForCli = {
      ...process.env,
      GJSIFY_INSTALL_BACKEND: 'native',
      npm_config_registry: registryUrl,
    };
  });

  after(() => {
    if (server) server.close();
  });

  /** Build a fresh project directory pre-seeded with a lockfile by running
   *  one regular (non-immutable) install. Returns the absolute project path. */
  async function seedProject({ dep = 'mid-dep', range = '^2.0.0' } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-immutable-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: 'immutable-test', version: '0.1.0', type: 'module', private: true,
      dependencies: { [dep]: range },
    }, null, 2) + '\n');
    writeFileSync(join(dir, '.npmrc'), `registry=${registryUrl}\n`);
    const r = await runCli(cliEntry, ['install'], { cwd: dir, env: envForCli });
    assert.equal(r.status, 0, `seed install failed: ${r.stderr}\n${r.stdout}`);
    assert.ok(existsSync(join(dir, 'gjsify-lock.json')), 'seed install must produce a lockfile');
    return dir;
  }

  it('errors when no lockfile is present', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-immutable-nolock-'));
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({
        name: 't', version: '0.1.0', type: 'module', private: true,
        dependencies: { 'leaf-dep': '^1.0.0' },
      }, null, 2) + '\n');
      writeFileSync(join(dir, '.npmrc'), `registry=${registryUrl}\n`);

      const r = await runCli(cliEntry, ['install', '--immutable'], { cwd: dir, env: envForCli });
      assert.notEqual(r.status, 0, 'expected failure when lockfile missing');
      assert.match(r.stdout + r.stderr, /--immutable requires .*gjsify-lock\.json/i);
      // No node_modules side-effect when --immutable rejects.
      assert.ok(!existsSync(join(dir, 'node_modules', 'leaf-dep')),
        'must not install anything when --immutable lockfile-missing error fires');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('errors when package.json has added a dep the lockfile does not pin', async () => {
    const dir = await seedProject({ dep: 'mid-dep', range: '^2.0.0' });
    try {
      // Add `leaf-dep` as an extra dep, do NOT refresh the lockfile.
      const pkgPath = join(dir, 'package.json');
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      pkg.dependencies['leaf-dep'] = '^1.0.0';
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

      const r = await runCli(cliEntry, ['install', '--immutable'], { cwd: dir, env: envForCli });
      assert.notEqual(r.status, 0, 'expected failure on lockfile drift');
      const combined = r.stdout + r.stderr;
      assert.match(combined, /stale|drift/i);
      // Diff listing should call out the added spec by name.
      assert.match(combined, /leaf-dep@\^1\.0\.0/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('succeeds when lockfile is in sync, populates node_modules, does NOT rewrite the lockfile', async () => {
    const dir = await seedProject({ dep: 'mid-dep', range: '^2.0.0' });
    try {
      // Capture lockfile bytes BEFORE the immutable install.
      const lockPath = join(dir, 'gjsify-lock.json');
      const before = readFileSync(lockPath);

      // Blow away node_modules so we are testing a real reinstall path,
      // not a no-op.
      rmSync(join(dir, 'node_modules'), { recursive: true, force: true });

      const r = await runCli(cliEntry, ['install', '--immutable'], { cwd: dir, env: envForCli });
      assert.equal(r.status, 0, `--immutable install failed: ${r.stderr}\n${r.stdout}`);

      // Direct + transitive deps materialised from the lockfile.
      for (const name of ['mid-dep', 'leaf-dep']) {
        assert.ok(existsSync(join(dir, 'node_modules', name, 'package.json')),
          `node_modules/${name}/package.json missing`);
      }

      // Lockfile bytes unchanged — the CI byte-stability guarantee.
      const after = readFileSync(lockPath);
      assert.deepEqual(before, after,
        '--immutable must not rewrite gjsify-lock.json');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects --immutable with <pkg> arguments', async () => {
    const dir = await seedProject();
    try {
      const r = await runCli(cliEntry, ['install', '--immutable', 'leaf-dep'], { cwd: dir, env: envForCli });
      assert.notEqual(r.status, 0);
      assert.match(r.stdout + r.stderr, /--immutable does not accept package arguments/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects --immutable combined with --global', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-immutable-global-'));
    try {
      const r = await runCli(cliEntry, ['install', '--immutable', '--global'], { cwd: dir, env: envForCli });
      assert.notEqual(r.status, 0);
      assert.match(r.stdout + r.stderr, /--immutable is incompatible with --global/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--immutable works at workspace-root (D.3 + D.6 interaction)', async () => {
    // Synthetic 2-workspace monorepo, one of which depends on a registry dep.
    const root = mkdtempSync(join(tmpdir(), 'gjsify-e2e-immutable-ws-'));
    try {
      writeFileSync(join(root, 'package.json'), JSON.stringify({
        name: 'immutable-ws', version: '0.0.0', private: true, type: 'module',
        workspaces: ['packages/*'],
      }, null, 2) + '\n');
      writeFileSync(join(root, '.npmrc'), `registry=${registryUrl}\n`);

      mkdirSync(join(root, 'packages', 'app'), { recursive: true });
      writeFileSync(join(root, 'packages', 'app', 'package.json'), JSON.stringify({
        name: '@imm/app', version: '0.1.0', type: 'module',
        dependencies: { 'leaf-dep': '^1.0.0' },
      }, null, 2) + '\n');

      // Seed: regular workspace install → produces a lockfile.
      const seed = await runCli(cliEntry, ['install'], { cwd: root, env: envForCli });
      assert.equal(seed.status, 0, `seed: ${seed.stderr}\n${seed.stdout}`);
      const lockPath = join(root, 'gjsify-lock.json');
      assert.ok(existsSync(lockPath), 'seed must write a workspace lockfile');
      const before = readFileSync(lockPath);

      // Blow away node_modules + run immutable install.
      rmSync(join(root, 'node_modules'), { recursive: true, force: true });
      const r = await runCli(cliEntry, ['install', '--immutable'], { cwd: root, env: envForCli });
      assert.equal(r.status, 0, `--immutable ws install failed: ${r.stderr}\n${r.stdout}`);
      assert.ok(existsSync(join(root, 'node_modules', 'leaf-dep', 'package.json')),
        'leaf-dep must be reinstalled from lockfile');

      // Lockfile unchanged.
      const after = readFileSync(lockPath);
      assert.deepEqual(before, after,
        'workspace --immutable must not rewrite gjsify-lock.json');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
