// E2E test for the global GJS install laying down the bundler engine.
//
// Regression guard for the production bug where a global GJS install of
// `@gjsify/cli` (via `gjsify install -g`, the install.mjs bootstrap, or
// `gjsify self-update`) shipped WITHOUT `@gjsify/rolldown-native` — the GJS
// bundler engine — because it is declared an OPTIONAL peerDependency and the
// native install backend never resolves peerDependencies. On Node the CLI
// falls back to the npm `rolldown` crate; under GJS there is no fallback, so
// `gjsify build` (and storybook / flatpak) hard-failed with
//   "no usable bundler engine under GJS — @gjsify/rolldown-native is not loadable".
//
// What is validated here (in-process mock registry + tarball server, no net):
//
//   1. installGjsEnginePackages() lays down @gjsify/rolldown-native (+ the
//      sibling lightningcss/oxfmt bridges) into the global prefix, with its
//      prebuilds/linux-<arch>/ dir physically present.
//
//   2. The launcher that linkGlobalBins() writes for the cli's GJS bundle
//      bakes the engine's prebuilds/linux-<arch>/ dir into BOTH GI_TYPELIB_PATH
//      and LD_LIBRARY_PATH (so the engine's typelib resolves at CLI startup).
//
//   3. Best-effort degradation: an engine with no published version (the
//      "no prebuild for this platform" shape) does NOT abort the others.
//
//   4. self-update on a version-matched-but-engine-missing prefix triggers a
//      REPAIR (installs the engine + re-links) instead of "Already up to date".
//
// Drives the COMPILED lib/ (CI runs `gjsify foreach build` before tests), same
// as tests/e2e/native-install.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const CLI_ENTRY = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'index.js');
const INSTALL_GLOBAL_JS = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'utils', 'install-global.js');

// A prebuild directory is named `${process.platform}-${process.arch}` — one
// spelling, computed from the running process (detect-native-packages.ts).
const ARCH = process.arch;
const PREBUILD_REL = `prebuilds/linux-${ARCH}`;

// ── ustar tar builder supporting multiple files (incl. a prebuild file) ──────
const BLOCK = 512;

function tarHeader(name, size, type = '0') {
    const buf = Buffer.alloc(BLOCK);
    buf.write(name, 0, Math.min(name.length, 100));
    buf.write('0000644', 100, 7);
    buf[107] = 0;
    buf.write('0000000', 108, 7);
    buf[115] = 0;
    buf.write('0000000', 116, 7);
    buf[123] = 0;
    buf.write(size.toString(8).padStart(11, '0'), 124, 11);
    buf[135] = 0;
    buf.write('0'.repeat(11), 136, 11);
    buf[147] = 0;
    buf.fill(0x20, 148, 156);
    buf.write(type, 156, 1);
    buf.write('ustar\0', 257, 6);
    buf.write('00', 263, 2);
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) sum += buf[i];
    buf.write(sum.toString(8).padStart(6, '0'), 148, 6);
    buf[154] = 0;
    buf[155] = 0x20;
    return buf;
}

function tarFile(name, contentBuf) {
    const padded = Buffer.alloc(Math.ceil(contentBuf.length / BLOCK) * BLOCK);
    contentBuf.copy(padded);
    return Buffer.concat([tarHeader(name, contentBuf.length), padded]);
}

/** Tar a synthetic package with a package.json and (optionally) a prebuild file. */
function buildPackageTar(pkgJson, { withPrebuild = false } = {}) {
    const parts = [tarHeader('package/', 0, '5')];
    parts.push(tarFile('package/package.json', Buffer.from(JSON.stringify(pkgJson, null, 2) + '\n')));
    if (withPrebuild) {
        parts.push(tarHeader(`package/${PREBUILD_REL}/`, 0, '5'));
        // Stand-ins for the two files EVERY gjsify GI bridge ships — content is
        // irrelevant, presence is not. The `.typelib` is load-bearing for the
        // launcher: `prebuilds/<os>-<arch>/` is also the prebuildify convention,
        // so the preamble takes a directory only when it holds one, and a
        // fixture with just a `.so` would be a prebuild the real launcher is
        // right to skip.
        parts.push(tarFile(`package/${PREBUILD_REL}/libgjsify_engine.so`, Buffer.from('\x7fELF stub')));
        parts.push(tarFile(`package/${PREBUILD_REL}/GjsifyEngine-1.0.typelib`, Buffer.from('GTYP stub')));
    }
    parts.push(Buffer.alloc(BLOCK * 2)); // trailer
    return Buffer.concat(parts);
}

function sriSha512(bytes) {
    return `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
}

function runHarness(cmd, args, cwd, env = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf-8');
        child.stderr.setEncoding('utf-8');
        child.stdout.on('data', (c) => (stdout += c));
        child.stderr.on('data', (c) => (stderr += c));
        const killTimer = setTimeout(() => {
            try {
                child.kill('SIGKILL');
            } catch {}
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

/**
 * Run a written launcher and report the environment it hands to the process it
 * execs.
 *
 * This is the assertion the v0.24.1 launcher regression needed and nothing had:
 * every existing check read the launcher TEXT, and a launcher whose preamble is
 * simply absent is perfectly well-formed text. The env is a property of running
 * it, so it is measured by running it.
 *
 * `gjs` is stubbed on PATH with a script that dumps the two variables, so this
 * needs no GJS on the host and no real CLI bundle — the launcher's own `exec
 * gjs -m <bundle>` line is what gets exercised, through a real `/bin/sh`.
 */
async function launcherEnv(launcherPath, tmpRoot, extraEnv = {}) {
    const stubDir = mkdtempSync(join(tmpRoot, 'stub-gjs-'));
    const stub = join(stubDir, 'gjs');
    writeFileSync(
        stub,
        '#!/bin/sh\n' +
            'printf "GI_TYPELIB_PATH=%s\\n" "${GI_TYPELIB_PATH-}"\n' +
            'printf "LD_LIBRARY_PATH=%s\\n" "${LD_LIBRARY_PATH-}"\n' +
            'printf "DYLD_LIBRARY_PATH=%s\\n" "${DYLD_LIBRARY_PATH-}"\n',
        { mode: 0o755 },
    );
    const res = await runHarness('/bin/sh', [launcherPath], stubDir, {
        PATH: `${stubDir}:${process.env.PATH}`,
        ...extraEnv,
    });
    assert.equal(res.status, 0, `launcher exited ${res.status}:\n${res.stdout}\n${res.stderr}`);
    const env = {};
    for (const line of res.stdout.split('\n')) {
        const eq = line.indexOf('=');
        if (eq > 0) env[line.slice(0, eq)] = line.slice(eq + 1);
    }
    return env;
}

describe('global GJS install lays down the bundler engine', { timeout: 90_000 }, () => {
    const CLI_VERSION = '9.9.9';
    let server;
    let registryUrl;
    let tmpRoot;
    let cacheHome;
    let index;

    before(async () => {
        if (!existsSync(CLI_ENTRY) || !existsSync(INSTALL_GLOBAL_JS)) {
            throw new Error(
                `global-install-engine e2e requires a built CLI: ${CLI_ENTRY}\n` +
                    `Run \`gjsify workspace @gjsify/cli build\` first (or build:infra).`,
            );
        }

        // Synthetic registry: @gjsify/cli + the three GJS engine bridges. Each
        // engine ships a real prebuilds/linux-<arch>/ dir in its tarball so
        // detectNativePackages picks it up after extraction.
        const PACKAGES = {
            '@gjsify/cli': { json: { name: '@gjsify/cli', version: CLI_VERSION }, withPrebuild: false },
            '@gjsify/rolldown-native': {
                json: { name: '@gjsify/rolldown-native', version: CLI_VERSION, gjsify: { prebuilds: 'prebuilds' } },
                withPrebuild: true,
            },
            '@gjsify/lightningcss-native': {
                json: { name: '@gjsify/lightningcss-native', version: CLI_VERSION, gjsify: { prebuilds: 'prebuilds' } },
                withPrebuild: true,
            },
            '@gjsify/oxfmt-native': {
                json: { name: '@gjsify/oxfmt-native', version: CLI_VERSION, gjsify: { prebuilds: 'prebuilds' } },
                withPrebuild: true,
            },
        };

        index = {};
        for (const [name, info] of Object.entries(PACKAGES)) {
            const tgz = gzipSync(buildPackageTar(info.json, { withPrebuild: info.withPrebuild }));
            index[name] = {
                name,
                'dist-tags': { latest: CLI_VERSION },
                versions: {
                    [CLI_VERSION]: {
                        name,
                        version: CLI_VERSION,
                        dependencies: {},
                        dist: { tarball: `__BASE__/-/${encodeURIComponent(name)}/${CLI_VERSION}.tgz`, integrity: sriSha512(tgz) },
                        _tgz: tgz,
                    },
                },
            };
        }

        server = createServer((req, res) => {
            try {
                const url = req.url ?? '';
                const tarMatch = url.match(/^\/-\/([^/]+)\/([^/]+)\.tgz$/);
                if (tarMatch) {
                    const name = decodeURIComponent(tarMatch[1]);
                    const v = index[name]?.versions[tarMatch[2]];
                    if (!v) {
                        res.writeHead(404).end('not found');
                        return;
                    }
                    res.writeHead(200, { 'content-type': 'application/octet-stream' });
                    res.end(v._tgz);
                    return;
                }
                const pkgName = decodeURIComponent(url.replace(/^\//, '').split('?')[0]);
                const p = index[pkgName];
                if (!p) {
                    res.writeHead(404).end('not found');
                    return;
                }
                const baseUrl = `http://127.0.0.1:${server.address().port}`;
                const wire = JSON.parse(JSON.stringify(p, (k, val) => (k === '_tgz' ? undefined : val)));
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
        registryUrl = `http://127.0.0.1:${server.address().port}/`;
        tmpRoot = mkdtempSync(join(tmpdir(), 'gjsify-global-engine-'));
        // Isolate the packument + tarball disk caches into this run's tmp dir.
        // Without this, a stale REAL @gjsify/rolldown-native packument from an
        // earlier install (the disk metadata cache honours XDG_CACHE_HOME and a
        // 304 conditional-fetch hit) shadows our synthetic CLI_VERSION packument
        // → "No version of @gjsify/rolldown-native satisfies 9.9.9".
        cacheHome = join(tmpRoot, 'cache');
        mkdirSync(cacheHome, { recursive: true });
    });

    after(() => {
        if (server) server.close();
        if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
    });

    // ── 1+2. installGjsEnginePackages + launcher env preamble ────────────────
    it('lays down @gjsify/rolldown-native and bakes its prebuild dir into the launcher env', async () => {
        const prefix = mkdtempSync(join(tmpRoot, 'prefix-engine-'));
        const binDir = mkdtempSync(join(tmpRoot, 'bin-engine-'));

        // Seed a @gjsify/cli package with a GJS bundle bin so linkGlobalBins
        // writes a `gjs -m` launcher (the env-preamble path) for it.
        const cliPkgDir = join(prefix, 'node_modules', '@gjsify', 'cli');
        mkdirSync(join(cliPkgDir, 'dist'), { recursive: true });
        writeFileSync(
            join(cliPkgDir, 'package.json'),
            JSON.stringify({ name: '@gjsify/cli', version: CLI_VERSION, gjsify: { bin: { gjsify: './dist/cli.gjs.mjs' } } }),
        );
        writeFileSync(join(cliPkgDir, 'dist', 'cli.gjs.mjs'), '#!/usr/bin/env -S gjs -m\n');

        // Exercise the REAL production installPackages path (no injected
        // installFn). The @gjsify scope in a contributor's ~/.npmrc points at
        // registry.npmjs.org, and registryFor() prefers that scope override over
        // any explicit `registry` option — so the only reliable reroute is to
        // patch globalThis.fetch (the npm-registry transport) to send
        // registry.npmjs.org traffic to the mock, exactly like the self-update
        // test does. The tarball URLs in the served packument already point at
        // the mock host, so the download phase needs no extra rerouting.
        const registryBase = registryUrl.replace(/\/$/, '');
        const harness = `
      const MOCK = ${JSON.stringify(registryBase)};
      const _real = globalThis.fetch.bind(globalThis);
      globalThis.fetch = async (input, init = {}) => {
        const url = typeof input === 'string' ? input : (input.url ?? String(input));
        if (url.includes('registry.npmjs.org')) {
          return _real(url.replace(/https?:\\/\\/registry\\.npmjs\\.org/, MOCK), init);
        }
        return _real(input, init);
      };
      const { installGjsEnginePackages, linkGlobalBins, hasBundlerEngineInstalled } =
        await import(${JSON.stringify('file://' + INSTALL_GLOBAL_JS)});
      await installGjsEnginePackages(${JSON.stringify(prefix)}, ${JSON.stringify(CLI_VERSION)}, { verbose: false });
      const layout = { prefix: ${JSON.stringify(prefix)}, binDir: ${JSON.stringify(binDir)} };
      const linked = linkGlobalBins(['@gjsify/cli'], layout);
      console.log(JSON.stringify({ engine: hasBundlerEngineInstalled(${JSON.stringify(prefix)}), links: linked.map((l) => l.link) }));
    `;
        const harnessFile = join(prefix, 'harness.mjs');
        writeFileSync(harnessFile, harness);

        const out = await runHarness('node', ['--no-warnings', harnessFile], MONOREPO_ROOT, {
            XDG_CACHE_HOME: cacheHome,
        });
        assert.equal(out.status, 0, `harness failed:\nstdout:\n${out.stdout}\nstderr:\n${out.stderr}`);

        // 1. Engine is on disk with its prebuild dir.
        const enginePrebuild = join(prefix, 'node_modules', '@gjsify', 'rolldown-native', PREBUILD_REL);
        assert.ok(
            existsSync(enginePrebuild),
            `expected engine prebuild dir at ${enginePrebuild}\nharness stdout:\n${out.stdout}\nstderr:\n${out.stderr}`,
        );
        const parsed = JSON.parse(out.stdout.trim().split('\n').pop());
        assert.equal(parsed.engine, true, 'hasBundlerEngineInstalled should be true after install');

        // 2. The launcher must EXPORT the engine's prebuild dir to the process
        //    it execs. Asserted by RUNNING it, not by reading it — that is the
        //    whole point (v0.24.1 shipped a launcher that was written, looked
        //    plausible and exported nothing).
        const launcherPath = join(binDir, 'gjsify');
        assert.ok(existsSync(launcherPath), `expected launcher at ${launcherPath}`);
        const launcher = readFileSync(launcherPath, 'utf-8');
        assert.match(launcher, /exec gjs -m/, 'launcher should invoke the GJS bundle');

        const env = await launcherEnv(launcherPath, tmpRoot);
        assert.ok(
            env.GI_TYPELIB_PATH?.split(':').includes(enginePrebuild),
            `launcher must export GI_TYPELIB_PATH containing ${enginePrebuild}\n` +
                `got: ${env.GI_TYPELIB_PATH}\nlauncher:\n${launcher}`,
        );
        assert.ok(
            env.LD_LIBRARY_PATH?.split(':').includes(enginePrebuild),
            `launcher must export LD_LIBRARY_PATH containing ${enginePrebuild}\n` +
                `got: ${env.LD_LIBRARY_PATH}\nlauncher:\n${launcher}`,
        );

        // 3. And it must stay correct for a native package installed AFTER the
        //    launcher was written. The launcher used to embed a snapshot of the
        //    prefix, so this case was silently stale until something happened to
        //    re-link it; it now scans the prefix on every launch.
        const latePrebuild = join(prefix, 'node_modules', '@gjsify', 'late-native', PREBUILD_REL);
        mkdirSync(latePrebuild, { recursive: true });
        writeFileSync(join(latePrebuild, 'libgjsify_late.so'), '\x7fELF stub');
        writeFileSync(join(latePrebuild, 'GjsifyLate-1.0.typelib'), 'GTYP stub');
        const envAfter = await launcherEnv(launcherPath, tmpRoot);
        assert.ok(
            envAfter.GI_TYPELIB_PATH?.split(':').includes(latePrebuild),
            'a prebuild installed after the launcher was written must still be exported — ' +
                `the launcher is stale.\ngot: ${envAfter.GI_TYPELIB_PATH}\nlauncher:\n${launcher}`,
        );

        // 4. An inherited value survives as a suffix (user typelibs keep working).
        const envInherited = await launcherEnv(launcherPath, tmpRoot, { GI_TYPELIB_PATH: '/user/typelibs' });
        assert.ok(
            envInherited.GI_TYPELIB_PATH?.split(':').includes('/user/typelibs'),
            `launcher must preserve an inherited GI_TYPELIB_PATH: ${envInherited.GI_TYPELIB_PATH}`,
        );

        // 5. …and a `prebuilds/<os>-<arch>/` that carries NO typelib is skipped.
        //    That layout is also the prebuildify convention (`bare-fs` & co), so
        //    a directory-only match would put a pile of foreign shared objects
        //    ahead of the system ones on the loader path.
        const foreign = join(prefix, 'node_modules', 'bare-lookalike', PREBUILD_REL);
        mkdirSync(foreign, { recursive: true });
        writeFileSync(join(foreign, 'bare-lookalike.node'), 'not a typelib');
        const envForeign = await launcherEnv(launcherPath, tmpRoot);
        assert.ok(
            !envForeign.GI_TYPELIB_PATH?.split(':').includes(foreign),
            `a prebuilds dir with no typelib must be skipped: ${envForeign.GI_TYPELIB_PATH}`,
        );
    });

    // ── 3. Best-effort degradation when an engine has no published version ────
    it('does not abort when one engine cannot be resolved (graceful degrade)', async () => {
        const prefix = mkdtempSync(join(tmpRoot, 'prefix-degrade-'));
        // installFn fails for oxfmt-native (simulate "no prebuild published")
        // but succeeds for the others.
        const harness = `
      const { installGjsEnginePackages, hasBundlerEngineInstalled } =
        await import(${JSON.stringify('file://' + INSTALL_GLOBAL_JS)});
      const installed = [];
      await installGjsEnginePackages(${JSON.stringify(prefix)}, ${JSON.stringify(CLI_VERSION)}, {
        verbose: false,
        installFn: async (spec) => {
          if (spec.startsWith('@gjsify/oxfmt-native')) throw new Error('No version of @gjsify/oxfmt-native satisfies ' + spec);
          installed.push(spec);
        },
      });
      console.log(JSON.stringify({ installed }));
    `;
        const harnessFile = join(prefix, 'harness.mjs');
        mkdirSync(prefix, { recursive: true });
        writeFileSync(harnessFile, harness);
        const out = await runHarness('node', ['--no-warnings', harnessFile], MONOREPO_ROOT);
        assert.equal(out.status, 0, `degrade harness should not throw:\nstdout:\n${out.stdout}\nstderr:\n${out.stderr}`);
        const parsed = JSON.parse(out.stdout.trim().split('\n').pop());
        assert.ok(
            parsed.installed.some((s) => s.startsWith('@gjsify/rolldown-native')),
            'rolldown-native must still install when oxfmt-native fails',
        );
        assert.ok(
            parsed.installed.some((s) => s.startsWith('@gjsify/lightningcss-native')),
            'lightningcss-native must still install when oxfmt-native fails',
        );
    });

    // ── 4. self-update repairs a version-matched-but-engine-missing prefix ────
    it('self-update repairs a missing engine even when the cli version matches', async () => {
        // A prefix that already has @gjsify/cli @ CLI_VERSION but NO engine.
        const prefix = mkdtempSync(join(tmpRoot, 'prefix-selfupdate-'));
        const binDir = mkdtempSync(join(tmpRoot, 'bin-selfupdate-'));
        const cliPkgDir = join(prefix, 'node_modules', '@gjsify', 'cli');
        mkdirSync(join(cliPkgDir, 'dist'), { recursive: true });
        writeFileSync(
            join(cliPkgDir, 'package.json'),
            JSON.stringify({ name: '@gjsify/cli', version: CLI_VERSION, gjsify: { bin: { gjsify: './dist/cli.gjs.mjs' } } }),
        );
        writeFileSync(join(cliPkgDir, 'dist', 'cli.gjs.mjs'), '#!/usr/bin/env -S gjs -m\n');

        // Engine is NOT installed yet.
        assert.ok(
            !existsSync(join(prefix, 'node_modules', '@gjsify', 'rolldown-native', 'package.json')),
            'precondition: engine must be absent',
        );

        // Patch globalThis.fetch (via --import preload) to reroute
        // registry.npmjs.org → the mock server. self-update's packument fetch
        // and the native install backend both go through it.
        const registryBase = registryUrl.replace(/\/$/, '');
        const preloadPath = join(prefix, 'mock-fetch.mjs');
        writeFileSync(
            preloadPath,
            `
const MOCK = ${JSON.stringify(registryBase)};
const _real = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : (input.url ?? String(input));
  if (url.includes('registry.npmjs.org')) {
    return _real(url.replace(/https?:\\/\\/registry\\.npmjs\\.org/, MOCK), init);
  }
  return _real(input, init);
};
`,
        );

        const result = await execFileAsync(
            process.execPath,
            ['--import', preloadPath, CLI_ENTRY, 'self-update'],
            {
                timeout: 60_000,
                env: {
                    ...process.env,
                    GJSIFY_GLOBAL_PREFIX: prefix,
                    GJSIFY_GLOBAL_BIN_DIR: binDir,
                    // Force the install backend's resolver at the mock registry too.
                    npm_config_registry: registryUrl,
                    GJSIFY_CLI_PACKAGE_JSON: join(cliPkgDir, 'package.json'),
                    // Isolate the disk packument/tarball caches (see before()).
                    XDG_CACHE_HOME: cacheHome,
                },
                encoding: 'utf8',
            },
        ).then(
            ({ stdout, stderr }) => ({ status: 0, stdout, stderr }),
            (err) => ({ status: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' }),
        );

        const combined = result.stdout + result.stderr;
        assert.equal(result.status, 0, `self-update should succeed:\n${combined}`);
        // It must NOT short-circuit at "Already up to date" — it repairs.
        assert.match(combined, /missing|repair/i, `expected a repair message, got:\n${combined}`);
        // The engine is now on disk with its prebuild dir.
        assert.ok(
            existsSync(join(prefix, 'node_modules', '@gjsify', 'rolldown-native', PREBUILD_REL)),
            `self-update should have laid down the engine prebuild dir.\nOutput:\n${combined}`,
        );
    });
});
