// E2E test for the native install backend (`GJSIFY_INSTALL_BACKEND=native`).
//
// Spins up an in-process HTTP "registry" that serves packuments + tarballs for
// a tiny synthetic dep graph (root → leaf), then drives the resolver via the
// installPackagesNative() entry point directly. No external network access,
// no real npm. Validates: BFS resolution, tarball extraction (gzipped),
// integrity verification, flat node_modules layout.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

// Build a minimal ustar tar archive in memory containing a single
// `package/package.json` whose contents are `pkgJson` (object).
function buildPackageTar(pkgJson) {
  const BLOCK = 512;
  const body = Buffer.from(JSON.stringify(pkgJson, null, 2) + '\n');
  function header(name, size, type = '0') {
    const buf = Buffer.alloc(BLOCK);
    buf.write(name, 0, 100);
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
  const dirHeader = header('package/', 0, '5');
  const fileHeader = header('package/package.json', body.length);
  const padded = Buffer.alloc(Math.ceil(body.length / BLOCK) * BLOCK);
  body.copy(padded);
  const trailer = Buffer.alloc(BLOCK * 2);
  return Buffer.concat([dirHeader, fileHeader, padded, trailer]);
}

function sriSha512(bytes) {
  const hash = createHash('sha512').update(bytes).digest('base64');
  return `sha512-${hash}`;
}

/**
 * Run a child without blocking the test event loop — the in-process mock
 * registry shares this loop and would never get its accept callback under
 * spawnSync.
 */
function runHarness(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    const killTimer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
    }, 60_000);
    child.on('close', (code) => {
      clearTimeout(killTimer);
      resolve({ status: code, stdout, stderr });
    });
    child.on('error', (e) => {
      clearTimeout(killTimer);
      reject(e);
    });
  });
}

describe('native install backend (in-process registry)', { timeout: 60_000 }, () => {
  let server;
  let registryUrl;
  let prefix;
  const PACKAGES = {
    leaf: {
      versions: { '1.0.0': { dependencies: {} } },
    },
    middle: {
      versions: { '1.2.3': { dependencies: { leaf: '^1.0.0' } } },
    },
    root: {
      versions: { '0.1.0': { dependencies: { middle: '^1.0.0', leaf: '^1.0.0' } } },
    },
  };

  before(async () => {
    // Build tarballs and a packument index keyed by package name.
    const index = {};
    for (const [name, info] of Object.entries(PACKAGES)) {
      index[name] = { name, 'dist-tags': {}, versions: {} };
      let lastVersion = '';
      for (const [version, body] of Object.entries(info.versions)) {
        const pkgJson = { name, version, ...body };
        const tar = buildPackageTar(pkgJson);
        const tgz = gzipSync(tar);
        index[name].versions[version] = {
          name,
          version,
          dependencies: body.dependencies ?? {},
          dist: {
            tarball: `__BASE__/-/${name}/${version}.tgz`,
            integrity: sriSha512(tgz),
          },
          _tgz: tgz,
        };
        lastVersion = version;
      }
      index[name]['dist-tags'].latest = lastVersion;
    }

    server = createServer((req, res) => {
      try {
        const url = req.url ?? '';
        // Tarball: /-/<pkg>/<version>.tgz
        const tarMatch = url.match(/^\/-\/([^/]+)\/([^/]+)\.tgz$/);
        if (tarMatch) {
          const v = index[tarMatch[1]]?.versions[tarMatch[2]];
          if (!v) { res.writeHead(404).end('not found'); return; }
          res.writeHead(200, { 'content-type': 'application/octet-stream' });
          res.end(v._tgz);
          return;
        }
        // Packument: /<encoded-name>
        const pkgName = decodeURIComponent(url.replace(/^\//, ''));
        const p = index[pkgName];
        if (!p) { res.writeHead(404).end('not found'); return; }
        const baseUrl = `http://127.0.0.1:${server.address().port}`;
        const wire = JSON.parse(JSON.stringify(p, (key, val) => key === '_tgz' ? undefined : val));
        for (const v of Object.values(wire.versions)) {
          v.dist.tarball = v.dist.tarball.replace('__BASE__', baseUrl);
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(wire));
      } catch (e) {
        res.writeHead(500).end(String(e));
      }
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    registryUrl = `http://127.0.0.1:${port}/`;

    prefix = mkdtempSync(join(tmpdir(), 'gjsify-native-install-'));
  });

  after(() => {
    if (server) server.close();
    if (prefix) rmSync(prefix, { recursive: true, force: true });
  });

  it('installs root + transitive deps into a flat node_modules', async () => {
    const cliPkgPath = new URL('../../../packages/infra/cli/src/utils/install-backend-native.ts', import.meta.url);
    // The TS module re-exports installPackagesNative — we drive it directly
    // via a child Node process that imports it through tsx (used by yarn start).
    // Simpler: spawn a tiny harness inline via `node --import` with TS-strip.
    const harness = `
      const { installPackagesNative } = await import(${JSON.stringify(cliPkgPath.href)});
      await installPackagesNative({
        prefix: ${JSON.stringify(prefix)},
        specs: ['root@^0.1.0'],
        registry: ${JSON.stringify(registryUrl)},
        verbose: false,
      });
      console.log('OK');
    `;
    // Drop the harness inside this test directory so the spawned `yarn node`
    // can resolve workspace packages via PnP (PnP is bound to the cwd).
    const harnessFile = new URL('./harness.tmp.mjs', import.meta.url).pathname;
    const workspaceRoot = new URL('../../../', import.meta.url).pathname;
    writeFileSync(harnessFile, harness);
    try {
      const out = await runHarness('yarn', [
        'node',
        '--experimental-strip-types',
        '--no-warnings',
        harnessFile,
      ], workspaceRoot);
      if (out.status !== 0) {
        throw new Error(`harness failed (status=${out.status})\nstdout:\n${out.stdout}\nstderr:\n${out.stderr}`);
      }
      assert.match(out.stdout, /OK/, `harness did not report OK: ${out.stdout}`);
    } finally {
      try { rmSync(harnessFile, { force: true }); } catch { /* best effort */ }
    }

    for (const name of ['root', 'middle', 'leaf']) {
      const pkgJson = join(prefix, 'node_modules', name, 'package.json');
      assert.ok(existsSync(pkgJson), `missing ${pkgJson}`);
      const parsed = JSON.parse(readFileSync(pkgJson, 'utf-8'));
      assert.equal(parsed.name, name, `unexpected name in ${pkgJson}`);
    }
  });
});
