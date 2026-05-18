// E2E test for Phase F.8 — `gjsify uninstall -g <pkg>`.
//
// Exercises the symmetric inverse of `gjsify install -g`:
//   - install a package globally → verify tree + bin landed
//   - uninstall the package → verify tree + bin removed
//   - uninstall non-existing package → exit non-zero with clear msg
//   - --dry-run leaves the filesystem alone
//
// Reuses the in-process mock-registry harness pattern from
// tests/e2e/native-install-project/.

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

function runCli(cliEntry, args, { env, timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliEntry, ...args], {
      env, stdio: ['ignore', 'pipe', 'pipe'],
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

describe('Phase F.8 — gjsify uninstall -g', { timeout: 60_000 }, () => {
  let server, registryUrl, tmpRoot, cliEntry, envForCli;

  const PACKAGES = {
    'demo-tool': {
      versions: {
        '1.0.0': {
          name: 'demo-tool', version: '1.0.0',
          dependencies: {},
          bin: { 'demo-tool': './bin.js' },
        },
      },
    },
  };

  before(async () => {
    const index = {};
    for (const [name, info] of Object.entries(PACKAGES)) {
      index[name] = { name, 'dist-tags': {}, versions: {} };
      let last = '';
      for (const [version, body] of Object.entries(info.versions)) {
        const tar = buildPackageTar({
          'package.json': JSON.stringify(body, null, 2) + '\n',
          'bin.js': '#!/usr/bin/env node\nconsole.log("hi from demo-tool");\n',
        });
        const tgz = gzipSync(tar);
        index[name].versions[version] = {
          ...body,
          dist: { tarball: `__BASE__/${name}/-/${name}-${version}.tgz`, integrity: sriSha512(tgz) },
          _tgz: tgz,
        };
        last = version;
      }
      index[name]['dist-tags'].latest = last;
    }

    server = createServer((req, res) => {
      try {
        const url = req.url ?? '';
        for (const [name, p] of Object.entries(index)) {
          for (const [version, v] of Object.entries(p.versions)) {
            const expected = `/${name}/-/${name}-${version}.tgz`;
            if (url === expected) {
              res.writeHead(200, { 'content-type': 'application/octet-stream' });
              res.end(v._tgz);
              return;
            }
          }
        }
        const pkgName = decodeURIComponent(url.replace(/^\//, '').replace(/%2[Ff]/g, '/'));
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

    tmpRoot = mkdtempSync(join(tmpdir(), 'gjsify-e2e-uninstall-'));
    cliEntry = new URL('../../../packages/infra/cli/lib/index.js', import.meta.url).pathname;
    envForCli = {
      ...process.env,
      GJSIFY_GLOBAL_PREFIX: join(tmpRoot, 'global'),
      GJSIFY_GLOBAL_BIN_DIR: join(tmpRoot, 'bin'),
      npm_config_registry: registryUrl,
    };
  });

  after(() => {
    if (server) server.close();
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('installs then uninstalls a package globally', async () => {
    const installRes = await runCli(cliEntry, ['install', '-g', 'demo-tool'], { env: envForCli });
    assert.equal(installRes.status, 0, `install failed:\n${installRes.stderr}\n${installRes.stdout}`);
    const pkgDir = join(tmpRoot, 'global', 'node_modules', 'demo-tool');
    const binPath = join(tmpRoot, 'bin', 'demo-tool');
    assert.ok(existsSync(pkgDir), 'package tree not created');
    assert.ok(existsSync(binPath), 'bin shim not created');

    const uninstallRes = await runCli(cliEntry, ['uninstall', '-g', 'demo-tool'], { env: envForCli });
    assert.equal(uninstallRes.status, 0, `uninstall failed:\n${uninstallRes.stderr}\n${uninstallRes.stdout}`);
    assert.equal(existsSync(pkgDir), false, 'package tree not removed');
    assert.equal(existsSync(binPath), false, 'bin shim not removed');
  });

  it('--dry-run leaves the filesystem untouched', async () => {
    const installRes = await runCli(cliEntry, ['install', '-g', 'demo-tool'], { env: envForCli });
    assert.equal(installRes.status, 0, `install failed:\n${installRes.stderr}`);
    const pkgDir = join(tmpRoot, 'global', 'node_modules', 'demo-tool');
    const binPath = join(tmpRoot, 'bin', 'demo-tool');

    const dryRes = await runCli(cliEntry, ['uninstall', '-g', 'demo-tool', '--dry-run'], { env: envForCli });
    assert.equal(dryRes.status, 0, `dry-run failed:\n${dryRes.stderr}`);
    assert.match(dryRes.stdout, /would remove/, 'expected "would remove" in dry-run output');
    assert.ok(existsSync(pkgDir), 'package tree should still exist after dry-run');
    assert.ok(existsSync(binPath), 'bin shim should still exist after dry-run');

    // Clean up for next test.
    await runCli(cliEntry, ['uninstall', '-g', 'demo-tool'], { env: envForCli });
  });

  it('exits non-zero on uninstall of a not-installed package', async () => {
    const r = await runCli(cliEntry, ['uninstall', '-g', 'never-installed-xyz'], { env: envForCli });
    assert.notEqual(r.status, 0, 'expected non-zero exit when nothing was removed');
    assert.match(r.stderr + r.stdout, /not installed/, 'expected "not installed" warning');
  });

  it('refuses uninstall without --global', async () => {
    const r = await runCli(cliEntry, ['uninstall', 'demo-tool'], { env: envForCli });
    assert.notEqual(r.status, 0, 'expected non-zero exit without --global');
    assert.match(r.stderr, /only supports --global/, 'expected explanation message');
  });
});
