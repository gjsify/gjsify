// E2E test for `gjsify install` version-conflict resolution (Phase D.7b).
//
// Builds a synthetic dep tree that mirrors the real-world `replacestream`
// breakage on the live gjsify monorepo:
//
//   top-pkg → bridge-pkg (uses readable@^2)
//          → modern-pkg (uses readable@^3)
//
// `readable@2` and `readable@3` have INCOMPATIBLE major versions. The flat
// single-version-per-name resolver (pre-D.7b) would pick `readable@3` for
// both, breaking `bridge-pkg` at runtime. The nested-node_modules resolver
// (D.7b) hoists `readable@3` to the root and nests `readable@2` under
// `bridge-pkg`.
//
// We assert on:
//   - the on-disk layout (readable@2 lives under bridge-pkg/node_modules/)
//   - the lockfile (lockfileVersion 2, both entries keyed by install path)
//   - Node's CommonJS resolver visibility (bridge-pkg sees v2, modern-pkg
//     sees v3 — without the nested install, Node would resolve both to the
//     same hoisted version)

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

// ----- tar helpers (ustar v0 with arbitrary file entries) -----
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
function fileEntry(name, body) {
  const padded = Buffer.alloc(Math.ceil(body.length / BLOCK) * BLOCK);
  body.copy(padded);
  return Buffer.concat([tarHeader(name, body.length), padded]);
}
function buildPackageTar(files) {
  const parts = [tarHeader('package/', 0, '5')];
  for (const [name, body] of Object.entries(files)) {
    parts.push(fileEntry(`package/${name}`, Buffer.from(body)));
  }
  parts.push(Buffer.alloc(BLOCK * 2));
  return Buffer.concat(parts);
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

describe('gjsify install — nested-node_modules version conflict (Phase D.7b)', { timeout: 90_000 }, () => {
  let server, registryUrl, projectDir, cliEntry, envForCli;

  // Mock packument graph: two `readable` majors, two consumers picking
  // different majors, one top-level pulling both.
  const PACKAGES = {
    'readable': {
      versions: {
        '2.3.7': {
          dependencies: {},
          files: {
            'package.json': JSON.stringify({
              name: 'readable', version: '2.3.7', main: 'index.js',
            }),
            'index.js': 'module.exports = { __major: 2 };\n',
          },
        },
        '3.6.2': {
          dependencies: {},
          files: {
            'package.json': JSON.stringify({
              name: 'readable', version: '3.6.2', main: 'index.js',
            }),
            'index.js': 'module.exports = { __major: 3 };\n',
          },
        },
      },
    },
    'bridge-pkg': {
      versions: {
        '1.0.0': {
          dependencies: { 'readable': '^2.0.0' },
          files: {
            'package.json': JSON.stringify({
              name: 'bridge-pkg', version: '1.0.0', main: 'index.js',
              dependencies: { 'readable': '^2.0.0' },
            }),
            'index.js': 'module.exports = require("readable");\n',
          },
        },
      },
    },
    'modern-pkg': {
      versions: {
        '1.0.0': {
          dependencies: { 'readable': '^3.0.0' },
          files: {
            'package.json': JSON.stringify({
              name: 'modern-pkg', version: '1.0.0', main: 'index.js',
              dependencies: { 'readable': '^3.0.0' },
            }),
            'index.js': 'module.exports = require("readable");\n',
          },
        },
      },
    },
    'top-pkg': {
      versions: {
        '0.1.0': {
          dependencies: { 'bridge-pkg': '^1.0.0', 'modern-pkg': '^1.0.0' },
          files: {
            'package.json': JSON.stringify({
              name: 'top-pkg', version: '0.1.0',
              dependencies: { 'bridge-pkg': '^1.0.0', 'modern-pkg': '^1.0.0' },
            }),
          },
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
        const tar = buildPackageTar(body.files);
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

    projectDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-conflict-'));
    cliEntry = new URL('../../../packages/infra/cli/lib/index.js', import.meta.url).pathname;
    envForCli = {
      ...process.env,
      GJSIFY_INSTALL_BACKEND: 'native',
      npm_config_registry: registryUrl,
    };

    // Seed package.json with top-pkg as an existing dep so the no-arg
    // install path is exercised (mirrors the "yarn install" / "gjsify
    // install" CI flow). That way `lockfile.requested` and the
    // package.json-derived spec set stay in sync across re-runs — the
    // bare-name `install <pkg>` flow has a separate spec-vs-lockfile
    // drift issue tracked in STATUS.md.
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({
      name: 'conflict-test', version: '0.1.0', type: 'commonjs', private: true,
      dependencies: { 'top-pkg': '^0.1.0' },
    }, null, 2) + '\n');
    writeFileSync(join(projectDir, '.npmrc'), `registry=${registryUrl}\n`);
  });

  after(() => {
    if (server) server.close();
    if (projectDir) rmSync(projectDir, { recursive: true, force: true });
  });

  it('installs both readable majors — one hoisted, the other nested', async () => {
    const r = await runCli(cliEntry, ['install'], { cwd: projectDir, env: envForCli });
    assert.equal(r.status, 0, `install failed: ${r.stderr}\n${r.stdout}`);

    // Root: top-pkg, bridge-pkg, modern-pkg, ONE readable major hoisted.
    for (const name of ['top-pkg', 'bridge-pkg', 'modern-pkg', 'readable']) {
      assert.ok(existsSync(join(projectDir, 'node_modules', name, 'package.json')),
        `node_modules/${name}/package.json missing`);
    }

    // Whichever readable was hoisted (BFS order picks first reached),
    // the OTHER one must be nested under its requester. Check both
    // possible nesting paths — exactly one should exist.
    const rootReadableVersion = JSON.parse(readFileSync(
      join(projectDir, 'node_modules', 'readable', 'package.json'), 'utf-8',
    )).version;
    const nestedUnderBridge = join(
      projectDir, 'node_modules', 'bridge-pkg', 'node_modules', 'readable', 'package.json',
    );
    const nestedUnderModern = join(
      projectDir, 'node_modules', 'modern-pkg', 'node_modules', 'readable', 'package.json',
    );

    if (rootReadableVersion.startsWith('2.')) {
      // bridge-pkg hoisted its readable@2; modern-pkg must have its own
      // nested readable@3.
      assert.ok(existsSync(nestedUnderModern),
        'modern-pkg should get nested readable@3 when readable@2 is hoisted');
      const nestedVersion = JSON.parse(readFileSync(nestedUnderModern, 'utf-8')).version;
      assert.ok(nestedVersion.startsWith('3.'), `nested readable should be major 3, got ${nestedVersion}`);
      assert.ok(!existsSync(nestedUnderBridge), 'bridge-pkg should NOT have nested readable when its version is at root');
    } else if (rootReadableVersion.startsWith('3.')) {
      // modern-pkg hoisted its readable@3; bridge-pkg must have its own
      // nested readable@2.
      assert.ok(existsSync(nestedUnderBridge),
        'bridge-pkg should get nested readable@2 when readable@3 is hoisted');
      const nestedVersion = JSON.parse(readFileSync(nestedUnderBridge, 'utf-8')).version;
      assert.ok(nestedVersion.startsWith('2.'), `nested readable should be major 2, got ${nestedVersion}`);
      assert.ok(!existsSync(nestedUnderModern), 'modern-pkg should NOT have nested readable when its version is at root');
    } else {
      assert.fail(`unexpected root readable version: ${rootReadableVersion}`);
    }
  });

  it('Node CommonJS resolver sees correct major from each consumer', async () => {
    // Sanity: drive the actual require() chain end-to-end. Each consumer
    // should resolve to its own readable major through standard CJS
    // node_modules walking — bridge-pkg → v2, modern-pkg → v3.
    const r = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['-e', `
        const bridge = require('bridge-pkg');
        const modern = require('modern-pkg');
        console.log(JSON.stringify({ bridge: bridge.__major, modern: modern.__major }));
      `], {
        cwd: projectDir, stdio: ['ignore', 'pipe', 'pipe'], env: process.env,
      });
      let out = ''; let err = '';
      child.stdout.on('data', (c) => { out += c; });
      child.stderr.on('data', (c) => { err += c; });
      child.on('close', (code) => resolve({ status: code, stdout: out, stderr: err }));
      child.on('error', reject);
    });
    assert.equal(r.status, 0, `require chain failed: ${r.stderr}`);
    const got = JSON.parse(r.stdout.trim());
    assert.deepStrictEqual(got, { bridge: 2, modern: 3 },
      `bridge-pkg should resolve to readable@2 (got ${got.bridge}), modern-pkg to readable@3 (got ${got.modern})`);
  });

  it('lockfile pins both readable entries with full install paths', async () => {
    const lockPath = join(projectDir, 'gjsify-lock.json');
    assert.ok(existsSync(lockPath), 'gjsify-lock.json missing');
    const lock = JSON.parse(readFileSync(lockPath, 'utf-8'));
    assert.equal(lock.lockfileVersion, 2, 'lockfile must be v2 (path-keyed)');

    // Both readable placements are present — one at the root, one nested.
    // Whichever consumer the BFS reached first wins the root slot; the
    // other's readable lives under its `node_modules/`.
    const rootReadable = lock.packages['node_modules/readable'];
    assert.ok(rootReadable, 'lockfile must pin a hoisted readable');
    const nestedKeys = Object.keys(lock.packages).filter((k) =>
      /^node_modules\/(bridge-pkg|modern-pkg)\/node_modules\/readable$/.test(k),
    );
    assert.equal(nestedKeys.length, 1,
      `expected exactly one nested readable entry, got: ${JSON.stringify(nestedKeys)}`);
    const nestedReadable = lock.packages[nestedKeys[0]];
    assert.ok(nestedReadable, 'lockfile must pin the nested readable');
    // The two entries cover both majors.
    const majors = [rootReadable.version, nestedReadable.version].map((v) => v.split('.')[0]).sort();
    assert.deepStrictEqual(majors, ['2', '3'],
      `lockfile should pin both readable@2 and readable@3, got: ${majors}`);
  });

  it('--immutable replays the conflict-resolved tree from the lockfile', async () => {
    // Wipe node_modules; the lockfile should fully reconstruct the tree.
    rmSync(join(projectDir, 'node_modules'), { recursive: true, force: true });
    const r = await runCli(cliEntry, ['install', '--immutable'], { cwd: projectDir, env: envForCli });
    assert.equal(r.status, 0, `--immutable failed: ${r.stderr}\n${r.stdout}`);

    // Both placements restored; the require() chain still resolves
    // correctly (consumer-major correlation preserved).
    const r2 = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['-e', `
        const bridge = require('bridge-pkg');
        const modern = require('modern-pkg');
        console.log(JSON.stringify({ bridge: bridge.__major, modern: modern.__major }));
      `], {
        cwd: projectDir, stdio: ['ignore', 'pipe', 'pipe'], env: process.env,
      });
      let out = ''; let err = '';
      child.stdout.on('data', (c) => { out += c; });
      child.stderr.on('data', (c) => { err += c; });
      child.on('close', (code) => resolve({ status: code, stdout: out, stderr: err }));
      child.on('error', reject);
    });
    assert.equal(r2.status, 0, `post-immutable require chain failed: ${r2.stderr}`);
    assert.deepStrictEqual(JSON.parse(r2.stdout.trim()), { bridge: 2, modern: 3 });
  });
});
