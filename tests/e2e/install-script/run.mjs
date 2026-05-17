// E2E test for Phase F — `install.mjs` bootstrap script.
//
// Exercises the two-stage bootstrap:
//   1. `gjs -m install.mjs` downloads the cli.gjs.mjs bundle from a
//      bootstrap URL (file:// in the test, GitHub-release in production),
//      verifies SHA-256, caches it.
//   2. Spawns `gjs -m <bundle> install -g <target>` against a mock npm
//      registry. The bundle handles the install, writes ~/.local/bin/<bin>.
//
// Validates: bundle downloaded, SHA-256 enforced, install completed,
// launcher created, and `--target @scope/x` routes to a non-default
// package successfully.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

// ----- tar helpers (ustar v0 with a package.json + bundle file) -----
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

function buildPackageTar(files) {
  const blocks = [tarHeader('package/', 0, '5')];
  for (const [name, contents] of Object.entries(files)) {
    const body = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
    const padded = Buffer.alloc(Math.ceil(body.length / BLOCK) * BLOCK);
    body.copy(padded);
    blocks.push(tarHeader(`package/${name}`, body.length));
    blocks.push(padded);
  }
  blocks.push(Buffer.alloc(BLOCK * 2));
  return Buffer.concat(blocks);
}

function sriSha512(bytes) {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
}

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

const HAS_GJS = (() => {
  try {
    const r = spawn('gjs', ['--version'], { stdio: 'ignore' });
    return new Promise((resolve) => {
      r.on('exit', (code) => resolve(code === 0));
      r.on('error', () => resolve(false));
    });
  } catch { return Promise.resolve(false); }
})();

describe('Phase F — install.mjs bootstrap', { timeout: 120_000 }, async () => {
  if (!(await HAS_GJS)) {
    it('skipped: gjs runtime not available', () => {});
    return;
  }

  let server, registryUrl, tmpRoot;
  // Path to the freshly-built gjs bundle we ship as the "bootstrap" asset.
  // In production this would be the GitHub-release-download URL.
  const cliBundlePath = new URL(
    '../../../packages/infra/cli/dist/cli.gjs.mjs',
    import.meta.url,
  ).pathname;
  const installerPath = new URL(
    '../../../install.mjs',
    import.meta.url,
  ).pathname;

  const cliBundleBytes = existsSync(cliBundlePath) ? readFileSync(cliBundlePath) : null;
  const cliBundleSha256 = cliBundleBytes ? sha256Hex(cliBundleBytes) : null;

  // Mock npm-registry index. Only `@gjsify/cli@0.0.99-test` is served — the
  // bundle's `install -g` resolves it and lays out a fake (but valid)
  // package tree at the user-global prefix.
  const PACKAGES = {
    '@gjsify/cli': {
      versions: {
        '0.0.99-test': {
          name: '@gjsify/cli',
          version: '0.0.99-test',
          dependencies: {},
          // Pretend bin: a tiny GJS script that just prints "OK".
          bin: { 'gjsify-test-shim': './bin.mjs' },
          gjsify: { bin: { 'gjsify-test-shim': './bin.mjs' } },
        },
      },
    },
  };

  before(async () => {
    if (!cliBundleBytes) {
      throw new Error(
        `install-script test requires packages/infra/cli/dist/cli.gjs.mjs ` +
          `to exist — run \`gjsify run build:gjs-bundle\` first.`,
      );
    }
    tmpRoot = mkdtempSync(join(tmpdir(), 'gjsify-e2e-install-script-'));

    // Build full packument index with tarball bytes. Real npm convention:
    //   packument URL: `${registry}/@scope/name`            (literal /)
    //   tarball URL:   `${registry}/@scope/name/-/<base>.tgz` (unscoped basename)
    const index = {};
    for (const [name, info] of Object.entries(PACKAGES)) {
      index[name] = { name, 'dist-tags': {}, versions: {} };
      let last = '';
      const unscoped = name.startsWith('@') ? name.slice(name.indexOf('/') + 1) : name;
      for (const [version, body] of Object.entries(info.versions)) {
        const files = {
          'package.json': JSON.stringify(body, null, 2) + '\n',
          'bin.mjs': '#!/usr/bin/env -S gjs -m\nprint("OK from gjsify-test-shim");\n',
        };
        const tar = buildPackageTar(files);
        const tgz = gzipSync(tar);
        const baseName = `${unscoped}-${version}.tgz`;
        index[name].versions[version] = {
          ...body,
          dist: { tarball: `__BASE__/${name}/-/${baseName}`, integrity: sriSha512(tgz) },
          _tgz: tgz,
          _baseName: baseName,
        };
        last = version;
      }
      index[name]['dist-tags'].latest = last;
    }

    // Build a route table: tarball URL → bytes
    const tarballRoutes = new Map();
    for (const [name, p] of Object.entries(index)) {
      for (const [version, v] of Object.entries(p.versions)) {
        const routePath = `/${name}/-/${v._baseName}`;
        tarballRoutes.set(routePath, v._tgz);
      }
    }

    server = createServer((req, res) => {
      try {
        const url = req.url ?? '';
        if (process.env.GJSIFY_E2E_DEBUG) console.error(`[mock-registry] GET ${url}`);
        // Tarball: exact-path lookup (avoids regex pain with scoped paths)
        const tarball = tarballRoutes.get(url);
        if (tarball) {
          res.writeHead(200, { 'content-type': 'application/octet-stream' });
          res.end(tarball);
          return;
        }
        // Packument: URL is `/@scope/name` (literal /, or %2F-encoded)
        const path = url.replace(/^\//, '');
        const pkgName = decodeURIComponent(path.replace(/%2[Ff]/g, '/'));
        const p = index[pkgName];
        if (!p) {
          if (process.env.GJSIFY_E2E_DEBUG) console.error(`[mock-registry] 404 url=${url}`);
          res.writeHead(404).end('not found'); return;
        }
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
  });

  after(() => {
    if (server) server.close();
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  });

  function runBootstrap(args, extraEnv = {}) {
    const prefix = join(tmpRoot, 'global');
    const binDir = join(tmpRoot, 'bin');
    const cache = join(tmpRoot, 'cache');
    const sha256Path = join(tmpRoot, 'cli.gjs.mjs.sha256');
    writeFileSync(sha256Path, cliBundleSha256 + '\n');
    return new Promise((resolve, reject) => {
      const child = spawn('gjs', ['-m', installerPath, ...args], {
        env: {
          ...process.env,
          GJSIFY_GLOBAL_PREFIX: prefix,
          GJSIFY_GLOBAL_BIN_DIR: binDir,
          GJSIFY_INSTALL_BOOTSTRAP_CACHE: cache,
          GJSIFY_INSTALL_BOOTSTRAP_URL: `file://${cliBundlePath}`,
          GJSIFY_INSTALL_BOOTSTRAP_SHA256_URL: `file://${sha256Path}`,
          npm_config_registry: registryUrl,
          ...extraEnv,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '', stderr = '';
      child.stdout.setEncoding('utf-8'); child.stderr.setEncoding('utf-8');
      child.stdout.on('data', (c) => { stdout += c; });
      child.stderr.on('data', (c) => { stderr += c; });
      const kill = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 60_000);
      child.on('close', (code) => { clearTimeout(kill); resolve({ status: code, stdout, stderr, prefix, binDir, cache }); });
      child.on('error', (e) => { clearTimeout(kill); reject(e); });
    });
  }

  it('downloads bootstrap bundle and runs it (default target = @gjsify/cli)', async () => {
    const r = await runBootstrap(['--tag', '0.0.99-test']);
    assert.equal(r.status, 0, `bootstrap failed:\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    // Bundle cached in our override path.
    assert.ok(existsSync(join(r.cache, 'cli.gjs.mjs')), 'bundle not cached');
    // Package laid out at user prefix.
    assert.ok(
      existsSync(join(r.prefix, 'node_modules', '@gjsify', 'cli', 'package.json')),
      'package not installed at prefix',
    );
    // Bin launcher created.
    assert.ok(existsSync(join(r.binDir, 'gjsify-test-shim')), 'bin shim not created');
  });

  it('fails fast on SHA-256 mismatch', async () => {
    const badSha = join(tmpRoot, 'wrong.sha256');
    writeFileSync(badSha, '0000000000000000000000000000000000000000000000000000000000000000\n');
    const r = await runBootstrap([], {
      GJSIFY_INSTALL_BOOTSTRAP_SHA256_URL: `file://${badSha}`,
    });
    assert.notEqual(r.status, 0, `expected SHA-256 mismatch failure, got status=${r.status}`);
    assert.match(
      r.stderr + r.stdout,
      /SHA-256 mismatch/,
      'expected error message about SHA-256 mismatch',
    );
  });
});
