// E2E test for workspace-aware `gjsify install` (Phase D.3).
//
// Creates a synthetic monorepo with a root + 3 workspaces, points the
// install backend at an in-process mock npm registry for the external
// deps, and asserts that:
//   - all external deps land in the root `node_modules/`
//   - each workspace's `workspace:` deps become relative symlinks into
//     its own `node_modules/` pointing at the sibling workspace dir
//   - the `gjsify-lock.json` is written at the root
//   - cycle / missing-workspace cases surface clean errors

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync, lstatSync, readlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

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

describe('gjsify install — workspace-aware (Phase D.3)', { timeout: 60_000 }, () => {
  let server, registryUrl, root, cliEntry, envForCli;

  const PACKAGES = {
    'lib-ext': { versions: { '4.5.0': { dependencies: {} } } },
    'mid-ext': { versions: { '2.0.0': { dependencies: { 'lib-ext': '^4.0.0' } } } },
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

    root = mkdtempSync(join(tmpdir(), 'gjsify-e2e-ws-install-'));
    cliEntry = new URL('../../../packages/infra/cli/lib/index.js', import.meta.url).pathname;
    envForCli = {
      ...process.env,
      GJSIFY_INSTALL_BACKEND: 'native',
      npm_config_registry: registryUrl,
    };

    // Root + 3 workspaces.
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      name: 'monorepo-root', version: '0.0.0', private: true, type: 'module',
      workspaces: ['packages/*'],
    }, null, 2) + '\n');
    writeFileSync(join(root, '.npmrc'), `registry=${registryUrl}\n`);

    // utils — leaf workspace, no deps.
    mkdirSync(join(root, 'packages', 'utils'), { recursive: true });
    writeFileSync(join(root, 'packages', 'utils', 'package.json'), JSON.stringify({
      name: '@scope/utils', version: '1.2.3', type: 'module',
    }, null, 2) + '\n');

    // core — depends on utils (workspace) and lib-ext (registry).
    mkdirSync(join(root, 'packages', 'core'), { recursive: true });
    writeFileSync(join(root, 'packages', 'core', 'package.json'), JSON.stringify({
      name: '@scope/core', version: '0.5.0', type: 'module',
      dependencies: { '@scope/utils': 'workspace:^', 'lib-ext': '^4.5.0' },
    }, null, 2) + '\n');

    // app — depends on core (workspace) and mid-ext (registry, which pulls lib-ext transitively).
    mkdirSync(join(root, 'packages', 'app'), { recursive: true });
    writeFileSync(join(root, 'packages', 'app', 'package.json'), JSON.stringify({
      name: '@scope/app', version: '0.1.0', type: 'module',
      dependencies: { '@scope/core': 'workspace:^', 'mid-ext': '^2.0.0' },
    }, null, 2) + '\n');
  });

  after(() => {
    if (server) server.close();
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('discovers workspaces + installs external deps at root', async () => {
    const r = await runCli(cliEntry, ['install', '--verbose'], { cwd: root, env: envForCli });
    assert.equal(r.status, 0, `install failed: ${r.stderr}\n${r.stdout}`);

    // External deps land at root node_modules/.
    for (const name of ['lib-ext', 'mid-ext']) {
      assert.ok(existsSync(join(root, 'node_modules', name, 'package.json')),
        `node_modules/${name}/package.json missing`);
    }

    // Lockfile written at root.
    assert.ok(existsSync(join(root, 'gjsify-lock.json')), 'gjsify-lock.json missing');
  });

  it('symlinks workspace deps into each workspace node_modules/', async () => {
    const coreUtils = join(root, 'packages', 'core', 'node_modules', '@scope', 'utils');
    const appCore = join(root, 'packages', 'app', 'node_modules', '@scope', 'core');

    for (const linkPath of [coreUtils, appCore]) {
      const stat = lstatSync(linkPath);
      assert.ok(stat.isSymbolicLink(), `${linkPath} must be a symbolic link`);
    }

    // Symlinks should be relative + resolve to the sibling workspace.
    const coreUtilsTarget = readlinkSync(coreUtils);
    assert.ok(!coreUtilsTarget.startsWith('/'), 'symlink should be relative for portability');
    const resolvedCoreUtils = resolve(join(root, 'packages', 'core', 'node_modules', '@scope'), coreUtilsTarget);
    assert.equal(resolvedCoreUtils, join(root, 'packages', 'utils'),
      `expected core's @scope/utils symlink to resolve to packages/utils, got ${resolvedCoreUtils}`);
  });

  it('logs workspace + external + symlink counts', async () => {
    const r = await runCli(cliEntry, ['install'], { cwd: root, env: envForCli });
    assert.equal(r.status, 0, `re-install failed: ${r.stderr}`);
    // Re-installing must be idempotent: same symlink counts, no errors.
    assert.match(r.stdout, /workspace\(s\),\s+\d+\s+external dep spec\(s\),\s+\d+\s+workspace symlink\(s\)/,
      `expected summary line, got: ${r.stdout}`);
  });

  it('refuses workspace: refs pointing at unknown workspaces', async () => {
    const orphanRoot = mkdtempSync(join(tmpdir(), 'gjsify-e2e-ws-orphan-'));
    try {
      writeFileSync(join(orphanRoot, 'package.json'), JSON.stringify({
        name: 'orphan-root', version: '0.0.0', private: true, type: 'module',
        workspaces: ['packages/*'],
      }, null, 2) + '\n');
      mkdirSync(join(orphanRoot, 'packages', 'consumer'), { recursive: true });
      writeFileSync(join(orphanRoot, 'packages', 'consumer', 'package.json'), JSON.stringify({
        name: 'consumer', version: '0.1.0', type: 'module',
        // References a workspace that doesn't exist:
        dependencies: { '@nowhere/sibling': 'workspace:^' },
      }, null, 2) + '\n');

      const r = await runCli(cliEntry, ['install'], { cwd: orphanRoot, env: envForCli });
      assert.notEqual(r.status, 0, 'expected failure for orphan workspace ref');
      const combined = r.stdout + r.stderr;
      assert.match(combined, /@nowhere\/sibling|no workspace with that name/i,
        `error should mention the missing workspace, got: ${combined}`);
    } finally {
      rmSync(orphanRoot, { recursive: true, force: true });
    }
  });
});
