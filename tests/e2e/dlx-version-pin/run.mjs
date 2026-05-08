// E2E test for `gjsify dlx <pkg>@<version>` cache invalidation + transitive
// native-prebuild install.
//
// Mirrors the regression discovered in `@gjsify/cli@0.3.17`:
//   1. `npx @gjsify/cli@0.3.17 showcase express-webserver` delegates to
//      `gjsify dlx <pkg>` (unpinned) → cache key = sha256(spec) is the same
//      across CLI versions → dlx serves the previously cached install for
//      7 days even after the underlying showcase tarball gained a new
//      runtime native-typelib dep.
//   2. `gjsify showcase` is now fixed to pin `<pkg>@<cli-version>` so the
//      cache key changes every release. This test locks down the load-
//      bearing invariants the showcase fix relies on:
//        a. different version specs land in different cache dirs (no stale)
//        b. transitive native-typelib deps land in the cache and the
//           walker (`computeNativeEnvForBundle`) finds them
//
// Strategy: in-process HTTP packument server (mirrors
// `tests/e2e/native-install/run.mjs`) hosting two synthetic showcase
// versions and one synthetic native-bridge package. Drive `gjsify dlx`
// through the workspace CLI binary against this registry, with
// `XDG_CACHE_HOME` pointing at a temp dir so the test never touches the
// real `~/.cache/gjsify/dlx`. No gjs run — the test asserts on install
// layout only, which is populated before `runGjsBundle()` spawns gjs.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// Tar helpers — assemble a ustar archive with multiple files.
// ---------------------------------------------------------------------------

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

function tarFile(name, contents) {
  const body = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
  const padded = Buffer.alloc(Math.ceil(body.length / BLOCK) * BLOCK);
  body.copy(padded);
  return Buffer.concat([tarHeader(name, body.length, '0'), padded]);
}

/** Build a tarball whose entries are `{ "package/<rel>": Buffer | string }`. */
function buildMultiFileTar(entries) {
  const chunks = [];
  for (const [name, contents] of Object.entries(entries)) {
    chunks.push(tarFile(name, contents));
  }
  chunks.push(Buffer.alloc(BLOCK * 2));
  return Buffer.concat(chunks);
}

function sriSha512(bytes) {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
}

// ---------------------------------------------------------------------------
// Process helper.
// ---------------------------------------------------------------------------

function runChild(cmd, args, { cwd, env, timeoutMs = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env: env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    const killTimer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* best effort */ }
    }, timeoutMs);
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

// ---------------------------------------------------------------------------
// Linux arch label used in `prebuilds/linux-<arch>/` dirs.
// ---------------------------------------------------------------------------

const ARCH_MAP = { x64: 'x86_64', arm64: 'aarch64', arm: 'armv7', ia32: 'i686' };
const linuxArch = ARCH_MAP[process.arch] ?? process.arch;

// ---------------------------------------------------------------------------

describe('gjsify dlx version-pinned cache + transitive native deps', { timeout: 60_000 }, () => {
  let server;
  let registryUrl;
  let cacheRoot;
  let envForCli;
  let cliEntry;

  // Two showcase versions:
  //   0.0.1 — ships only its own bundle (no native dep)
  //   0.0.2 — adds @synthetic/bridge@^0.0.1, which ships a fake typelib in
  //           prebuilds/linux-<arch>/. Models the @gjsify/example-node-
  //           express-webserver@0.3.17 shape change that introduced the
  //           runtime dep on @gjsify/http-soup-bridge.
  const PACKAGES = {
    '@synthetic/showcase': {
      versions: {
        '0.0.1': {
          dependencies: {},
          files: {
            'package/package.json': JSON.stringify({
              name: '@synthetic/showcase',
              version: '0.0.1',
              type: 'module',
              gjsify: { main: 'dist/bundle.mjs' },
              dependencies: {},
            }),
            'package/dist/bundle.mjs': "console.log('synthetic showcase v0.0.1');\n",
          },
        },
        '0.0.2': {
          dependencies: { '@synthetic/bridge': '^0.0.1' },
          files: {
            'package/package.json': JSON.stringify({
              name: '@synthetic/showcase',
              version: '0.0.2',
              type: 'module',
              gjsify: { main: 'dist/bundle.mjs' },
              dependencies: { '@synthetic/bridge': '^0.0.1' },
            }),
            'package/dist/bundle.mjs': "console.log('synthetic showcase v0.0.2');\n",
          },
        },
      },
    },
    '@synthetic/bridge': {
      versions: {
        '0.0.1': {
          dependencies: {},
          files: {
            'package/package.json': JSON.stringify({
              name: '@synthetic/bridge',
              version: '0.0.1',
              type: 'module',
              gjsify: { prebuilds: 'prebuilds' },
            }),
            [`package/prebuilds/linux-${linuxArch}/Synthetic.typelib`]: Buffer.from('typelib stub'),
            [`package/prebuilds/linux-${linuxArch}/libsynthetic.so`]: Buffer.from('so stub'),
          },
        },
      },
    },
  };

  before(async () => {
    // Build packument index keyed by package name.
    const index = {};
    for (const [name, info] of Object.entries(PACKAGES)) {
      index[name] = { name, 'dist-tags': {}, versions: {} };
      let lastVersion = '';
      for (const [version, body] of Object.entries(info.versions)) {
        const tar = buildMultiFileTar(body.files);
        const tgz = gzipSync(tar);
        index[name].versions[version] = {
          name,
          version,
          dependencies: body.dependencies ?? {},
          dist: {
            tarball: `__BASE__/-/${encodeURIComponent(name)}/${version}.tgz`,
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
        const tarMatch = url.match(/^\/-\/([^/]+)\/([^/]+)\.tgz$/);
        if (tarMatch) {
          const pkgName = decodeURIComponent(tarMatch[1]);
          const v = index[pkgName]?.versions[tarMatch[2]];
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

    cacheRoot = mkdtempSync(join(tmpdir(), 'gjsify-e2e-dlx-version-pin-'));

    // Run the CLI from the workspace build output. `XDG_CACHE_HOME=<tmp>`
    // makes `dlxCacheRoot()` return `<tmp>/gjsify/dlx`. Forcing the native
    // backend keeps the test independent of npm being on PATH.
    cliEntry = new URL(
      '../../../packages/infra/cli/lib/index.js',
      import.meta.url,
    ).pathname;
    envForCli = {
      ...process.env,
      XDG_CACHE_HOME: cacheRoot,
      GJSIFY_INSTALL_BACKEND: 'native',
    };
  });

  after(() => {
    if (server) server.close();
    if (cacheRoot) rmSync(cacheRoot, { recursive: true, force: true });
  });

  // Folder names under <cacheRoot>/gjsify/dlx that aren't symlinks (i.e. the
  // sha256 cache key dirs created by createCacheKey).
  function listCacheKeys() {
    const root = join(cacheRoot, 'gjsify', 'dlx');
    if (!existsSync(root)) return [];
    return readdirSync(root).filter((n) => /^[0-9a-f]{64}$/.test(n));
  }

  // Resolve the live install dir under a cache key (follows `pkg` symlink).
  function resolveLiveInstall(cacheKey) {
    return join(cacheRoot, 'gjsify', 'dlx', cacheKey, 'pkg');
  }

  it('installs @synthetic/showcase@0.0.1 (no native dep) into a unique cache dir', async () => {
    // The showcase v0.0.1 has no native typelib dep — just its own bundle.
    // dlx will install + symlink-swap, then try to spawn gjs. We don't care
    // about the gjs result; we assert on the install layout.
    const result = await runChild(
      process.execPath,
      [cliEntry, 'dlx', '@synthetic/showcase@0.0.1', '--registry', registryUrl],
      { env: envForCli, timeoutMs: 30_000 },
    );

    // Surface the failure detail if dlx's *install* step itself blew up —
    // a non-zero gjs exit is fine, but a missing tarball / resolver crash
    // would mean the cache layout we're about to assert on never landed.
    const combined = result.stdout + result.stderr;
    assert.ok(
      !/Error:.*resolve|Error:.*install|fetch.*404/i.test(combined),
      `dlx install step appears to have failed:\n${combined}`,
    );

    const keys = listCacheKeys();
    assert.equal(keys.length, 1, `expected 1 cache key after first run, got ${keys.length}: ${keys.join(', ')}`);

    const installDir = join(resolveLiveInstall(keys[0]), 'node_modules');
    assert.ok(existsSync(join(installDir, '@synthetic', 'showcase', 'package.json')),
      'showcase package missing from install');
    assert.ok(!existsSync(join(installDir, '@synthetic', 'bridge')),
      'bridge must NOT be installed for v0.0.1 (no dep on it)');
  });

  it('installs @synthetic/showcase@0.0.2 (transitive bridge) into a DIFFERENT cache dir', async () => {
    // Different version → different sha256 cache key → fresh install dir.
    // This is the load-bearing invariant: without it, a stale v0.0.1 cache
    // would shadow the v0.0.2 install for 7 days.
    const result = await runChild(
      process.execPath,
      [cliEntry, 'dlx', '@synthetic/showcase@0.0.2', '--registry', registryUrl],
      { env: envForCli, timeoutMs: 30_000 },
    );

    const combined = result.stdout + result.stderr;
    assert.ok(
      !/Error:.*resolve|Error:.*install|fetch.*404/i.test(combined),
      `dlx install step appears to have failed:\n${combined}`,
    );

    const keys = listCacheKeys();
    assert.equal(keys.length, 2, `expected 2 distinct cache keys, got ${keys.length}: ${keys.join(', ')}`);

    // Find which key is v0.0.2's by reading the showcase package.json in each.
    let v002Key;
    for (const key of keys) {
      const pkgJson = join(resolveLiveInstall(key), 'node_modules', '@synthetic', 'showcase', 'package.json');
      if (!existsSync(pkgJson)) continue;
      const parsed = JSON.parse(readFileSync(pkgJson, 'utf-8'));
      if (parsed.version === '0.0.2') { v002Key = key; break; }
    }
    assert.ok(v002Key, `could not locate v0.0.2 install among ${keys.join(', ')}`);

    const installDir = join(resolveLiveInstall(v002Key), 'node_modules');
    assert.ok(existsSync(join(installDir, '@synthetic', 'bridge', 'package.json')),
      'bridge package must be installed transitively for v0.0.2');
    assert.ok(
      existsSync(join(installDir, '@synthetic', 'bridge', 'prebuilds', `linux-${linuxArch}`, 'Synthetic.typelib')),
      'bridge typelib prebuild must be present in v0.0.2 install',
    );
  });

  it('walker (computeNativeEnvForBundle) finds the bridge from the bundle dir', async () => {
    // This is the runtime path: `runGjsBundle` calls computeNativeEnvForBundle
    // with the bundle's path, expects GI_TYPELIB_PATH / LD_LIBRARY_PATH to be
    // populated from the bundle-side node_modules walk. With the v0.0.2 cache
    // populated above, the walker must surface @synthetic/bridge.
    const cliReq = createRequire(import.meta.url);
    const utilsPath = cliReq.resolve('@gjsify/cli/lib/utils/run-gjs.js');
    const { computeNativeEnvForBundle } = await import(pathToFileURL(utilsPath).href);

    const keys = listCacheKeys();
    let bundlePath;
    for (const key of keys) {
      const candidate = join(
        resolveLiveInstall(key),
        'node_modules', '@synthetic', 'showcase', 'dist', 'bundle.mjs',
      );
      if (!existsSync(candidate)) continue;
      const pkgJson = join(resolveLiveInstall(key), 'node_modules', '@synthetic', 'showcase', 'package.json');
      const parsed = JSON.parse(readFileSync(pkgJson, 'utf-8'));
      if (parsed.version === '0.0.2') { bundlePath = candidate; break; }
    }
    assert.ok(bundlePath, 'v0.0.2 bundle path not found in cache');

    // CWD = a directory with no node_modules, mirroring the `npx
    // @gjsify/cli showcase …` invocation.
    const cleanCwd = mkdtempSync(join(tmpdir(), 'gjsify-e2e-dlx-version-pin-cwd-'));
    try {
      const { env } = computeNativeEnvForBundle(bundlePath, cleanCwd);
      assert.match(
        env.GI_TYPELIB_PATH ?? '',
        /@synthetic[\\/]bridge[\\/]prebuilds[\\/]linux-/,
        'GI_TYPELIB_PATH should contain @synthetic/bridge prebuild dir',
      );
      assert.match(
        env.LD_LIBRARY_PATH ?? '',
        /@synthetic[\\/]bridge[\\/]prebuilds[\\/]linux-/,
        'LD_LIBRARY_PATH should contain @synthetic/bridge prebuild dir',
      );
    } finally {
      rmSync(cleanCwd, { recursive: true, force: true });
    }
  });

  // Side-channel suppression: assert the same input spec is never served two
  // different cache dirs (idempotency of createCacheKey under cache hit).
  it('repeated `dlx <pkg>@<version>` reuses the same cache dir', async () => {
    const before = listCacheKeys().length;
    // Re-run v0.0.2 with default TTL — must hit the existing cache, not
    // create another prepare-dir. (Cache invalidation requires a different
    // spec string.)
    const result = await runChild(
      process.execPath,
      [cliEntry, 'dlx', '@synthetic/showcase@0.0.2', '--registry', registryUrl],
      { env: envForCli, timeoutMs: 30_000 },
    );
    const combined = result.stdout + result.stderr;
    assert.ok(
      !/Error:.*resolve|Error:.*install|fetch.*404/i.test(combined),
      `dlx cache-hit path errored:\n${combined}`,
    );
    const after = listCacheKeys().length;
    assert.equal(after, before, 'cache hit must not create a new cache key dir');
  });
});
