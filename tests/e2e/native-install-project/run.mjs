// E2E test for `gjsify install <pkg>` (project-local, native backend).
//
// The Phase D.1 wire-up of the `install` command: previously project-local
// installs delegated to `npm install` via subprocess. Now they route
// through `installPackagesNative` (`@gjsify/{semver,npm-registry,tar}`),
// edit package.json with the resolved version, and write a lockfile.
//
// In-process HTTP mock registry mirrors the dlx-version-pin test harness.

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

// ----- subprocess runner -----
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

describe('gjsify install <pkg> — project-local native (Phase D.1)', { timeout: 60_000 }, () => {
  let server, registryUrl, projectDir, cliEntry, envForCli;

  const PACKAGES = {
    'leaf-dep': { versions: { '1.0.0': { dependencies: {} } } },
    'mid-dep': { versions: { '2.1.0': { dependencies: { 'leaf-dep': '^1.0.0' } } } },
    'top-pkg': { versions: { '0.5.0': { dependencies: { 'mid-dep': '^2.0.0' } } } },
  };

  before(async () => {
    // Mock registry index — like the native-install test.
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

    projectDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-install-project-'));
    cliEntry = new URL('../../../packages/infra/cli/lib/index.js', import.meta.url).pathname;
    envForCli = {
      ...process.env,
      // Native backend is the default; force it here to make the test
      // explicit and robust against changes to the default.
      GJSIFY_INSTALL_BACKEND: 'native',
      // Mock registry — both via the env var and via `.npmrc`.
      npm_config_registry: registryUrl,
    };

    // Project package.json: clean slate, no deps yet.
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({
      name: 'install-test', version: '0.1.0', type: 'module', private: true,
    }, null, 2) + '\n');
    // Pin registry per project so the native backend's npmrc-loader picks it up.
    writeFileSync(join(projectDir, '.npmrc'), `registry=${registryUrl}\n`);
  });

  after(() => {
    if (server) server.close();
    if (projectDir) rmSync(projectDir, { recursive: true, force: true });
  });

  function readPkgJson() {
    return JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf-8'));
  }

  it('installs a top-level package into node_modules and updates package.json', async () => {
    const r = await runCli(cliEntry, ['install', 'top-pkg'], { cwd: projectDir, env: envForCli });
    assert.equal(r.status, 0, `install failed: ${r.stderr}\n${r.stdout}`);

    // node_modules populated with top-pkg + transitive deps.
    for (const name of ['top-pkg', 'mid-dep', 'leaf-dep']) {
      assert.ok(existsSync(join(projectDir, 'node_modules', name, 'package.json')),
        `node_modules/${name}/package.json missing`);
    }

    // package.json gained a `dependencies.top-pkg` entry with the
    // resolved-version range `^0.5.0`.
    const pkg = readPkgJson();
    assert.equal(pkg.dependencies?.['top-pkg'], '^0.5.0',
      `expected ^0.5.0, got ${pkg.dependencies?.['top-pkg']}`);
  });

  it('honors explicit version specs (top-pkg@^0.5.0)', async () => {
    const r = await runCli(cliEntry, ['install', 'mid-dep@^2.0.0'], { cwd: projectDir, env: envForCli });
    assert.equal(r.status, 0, `install failed: ${r.stderr}`);
    const pkg = readPkgJson();
    // Explicit range preserved verbatim — does NOT get rewritten to
    // `^2.1.0` (the installed version).
    assert.equal(pkg.dependencies?.['mid-dep'], '^2.0.0',
      `expected explicit range to be preserved, got ${pkg.dependencies?.['mid-dep']}`);
  });

  it('--save-dev moves the new entry to devDependencies', async () => {
    const r = await runCli(cliEntry, ['install', 'leaf-dep', '--save-dev'], { cwd: projectDir, env: envForCli });
    assert.equal(r.status, 0, `install failed: ${r.stderr}`);
    const pkg = readPkgJson();
    assert.equal(pkg.devDependencies?.['leaf-dep'], '^1.0.0');
    assert.equal(pkg.dependencies?.['leaf-dep'], undefined,
      'leaf-dep must not appear in both `dependencies` and `devDependencies`');
  });

  it('writes gjsify-lock.json for reproducible reinstall', async () => {
    const lockPath = join(projectDir, 'gjsify-lock.json');
    assert.ok(existsSync(lockPath), 'gjsify-lock.json missing after install');
    const lock = JSON.parse(readFileSync(lockPath, 'utf-8'));
    assert.equal(lock.lockfileVersion, 1);
    assert.ok(lock.packages['top-pkg'], 'lockfile must pin top-pkg');
    assert.match(lock.packages['top-pkg'].integrity, /^sha512-/);
  });

  // Note: a previous revision asserted that workspace-root install FAILS
  // with a Phase-D.3 marker. D.3 wired the workspace-aware path, so the
  // workspace coverage lives in `tests/e2e/workspace-install/run.mjs` now.

  it('detects Yarn PnP and falls back with a clear error', async () => {
    const pnpRoot = mkdtempSync(join(tmpdir(), 'gjsify-e2e-install-pnp-'));
    try {
      writeFileSync(join(pnpRoot, 'package.json'), JSON.stringify({
        name: 'pnp-test', version: '0.0.1', type: 'module', private: true,
      }, null, 2) + '\n');
      writeFileSync(join(pnpRoot, '.pnp.cjs'), '// PnP marker\n');

      const r = await runCli(cliEntry, ['install', 'leaf-dep'], { cwd: pnpRoot, env: envForCli });
      assert.notEqual(r.status, 0, 'PnP-marked project should error');
      const combined = r.stdout + r.stderr;
      assert.match(combined, /Yarn PnP|\.pnp\.cjs/i,
        `expected error to mention PnP, got: ${combined}`);
    } finally {
      rmSync(pnpRoot, { recursive: true, force: true });
    }
  });
});
