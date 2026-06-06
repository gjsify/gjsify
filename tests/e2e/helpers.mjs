// Shared E2E test helpers for @gjsify CLI/plugin workflows.

import { execFileSync, execSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const MONOREPO_ROOT = join(__dirname, '..', '..');

/**
 * Pack all workspace tarballs via pack.mjs into tarballsDir.
 * Returns { "@gjsify/foo": "@gjsify-foo.tgz", ... } map.
 */
export function packWorkspaces(tarballsDir) {
    const stdout = execFileSync('node', [join(__dirname, 'pack.mjs'), tarballsDir], {
        cwd: MONOREPO_ROOT,
        encoding: 'utf8',
        maxBuffer: 50 * 1024 * 1024,
        timeout: 10 * 60 * 1000,
    });
    return JSON.parse(stdout);
}

/**
 * Create a temporary directory for an E2E test.
 * Returns { tmpDir, tarballsDir, tarballMap }.
 */
export function createTestEnvironment(prefix = 'gjsify-e2e-') {
    const tmpDir = mkdtempSync(join(tmpdir(), prefix));
    const tarballsDir = join(tmpDir, 'tarballs');

    console.log(`  tmp dir: ${tmpDir}`);
    console.log('  packing workspace packages...');
    const tarballMap = packWorkspaces(tarballsDir);
    console.log(`  packed ${Object.keys(tarballMap).length} packages`);

    return { tmpDir, tarballsDir, tarballMap };
}

/**
 * Clean up a temporary directory unless GJSIFY_E2E_KEEP_TEMP is set.
 */
export function cleanupTestEnvironment(tmpDir) {
    if (process.env.GJSIFY_E2E_KEEP_TEMP) {
        console.log(`  keeping tmp dir: ${tmpDir}`);
    } else if (tmpDir) {
        rmSync(tmpDir, { recursive: true, force: true });
    }
}

/**
 * Build an npm `overrides` object pointing all @gjsify/* packages to local tarballs.
 */
export function buildOverrides(tarballsDir, tarballMap) {
    const overrides = {};
    for (const [name, filename] of Object.entries(tarballMap)) {
        overrides[name] = `file:${join(tarballsDir, filename)}`;
    }
    return overrides;
}

/**
 * Convert a package name to its tarball file: reference, or return undefined.
 */
export function toFileRef(name, tarballsDir, tarballMap) {
    const filename = tarballMap[name];
    if (!filename) return undefined;
    return `file:${join(tarballsDir, filename)}`;
}

/** Synchronous sleep (no extra process) — used for retry backoff. */
function sleepSync(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Heuristic: did this `npm install` failure look like a transient registry /
 * network hiccup (vs a deterministic dependency error worth surfacing)?
 */
function isTransientInstallError(err) {
    const text = `${err?.message ?? ''}\n${err?.stdout ?? ''}\n${err?.stderr ?? ''}`;
    return /E404|ETARGET|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|network|registry\.npmjs\.org|\b(?:429|500|502|503|504)\b|Not Found|could not be found/i.test(
        text,
    );
}

/**
 * Run `npm install` in `projectDir`, retrying on transient failures. E2E
 * templates pull heavy `@girs/*` tarballs from the public registry in parallel;
 * the registry intermittently returns a transient 404 / network error for a
 * tarball that genuinely exists (observed: Fedora 43 passes while Fedora 44
 * fails on the identical commit). Retry with backoff so a registry hiccup
 * doesn't red a PR.
 *
 * Only the install is retried — callers' build/check steps stay deterministic
 * so a real regression still fails on the first attempt rather than being
 * masked by a retry.
 */
export function npmInstallWithRetry(projectDir, { label = 'project', attempts = 3, timeoutMs = 5 * 60 * 1000 } = {}) {
    for (let attempt = 1; ; attempt++) {
        try {
            execSync('npm install --no-audit --no-fund', { cwd: projectDir, stdio: 'pipe', timeout: timeoutMs });
            return;
        } catch (err) {
            if (attempt >= attempts || !isTransientInstallError(err)) throw err;
            const waitMs = 3000 * attempt;
            console.log(
                `  [${label}] npm install attempt ${attempt}/${attempts} hit a transient registry error — retrying in ${waitMs}ms…`,
            );
            sleepSync(waitMs);
        }
    }
}

/**
 * Write a package.json, install deps, and return the project dir.
 */
export function setupProject(projectDir, pkg, tarballsDir, tarballMap) {
    // Patch all @gjsify/* deps to local tarballs
    for (const field of ['dependencies', 'devDependencies']) {
        if (!pkg[field]) continue;
        for (const name of Object.keys(pkg[field])) {
            const ref = toFileRef(name, tarballsDir, tarballMap);
            if (ref) pkg[field][name] = ref;
        }
    }

    // Add overrides for transitive deps
    pkg.overrides = buildOverrides(tarballsDir, tarballMap);

    writeFileSync(join(projectDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

    console.log('  running npm install...');
    npmInstallWithRetry(projectDir, { label: 'setupProject', timeoutMs: 3 * 60 * 1000 });
    console.log('  npm install done');
}

/**
 * Build a Yarn `resolutions` map redirecting all @gjsify/* requests to local tarballs.
 * Used together with `nodeLinker: pnp` to simulate an external npm-installed consumer.
 */
export function buildYarnResolutions(tarballsDir, tarballMap) {
    const resolutions = {};
    for (const [name, filename] of Object.entries(tarballMap)) {
        resolutions[name] = `file:${join(tarballsDir, filename)}`;
    }
    return resolutions;
}

/**
 * Write a Yarn-PnP-flavoured project, install deps, and return the project dir.
 *
 * Distinct from setupProject (which uses npm + node-modules linker): this
 * exercises the gjsify CLI under Yarn 4 with `nodeLinker: pnp`, the same
 * setup external consumers like ts-for-gir use. It validates that the
 * two-hop PnP relay in @gjsify/cli's build action resolves transitive
 * @gjsify/* polyfills (fs, path, child_process, ...) without each one
 * needing to be a direct devDep.
 *
 * Requires `yarn` (>= 4) on PATH. The test skips itself if yarn is missing.
 */
export function setupProjectYarnPnp(projectDir, pkg, tarballsDir, tarballMap) {
    // Patch direct @gjsify/* deps to tarball file: refs.
    for (const field of ['dependencies', 'devDependencies']) {
        if (!pkg[field]) continue;
        for (const name of Object.keys(pkg[field])) {
            const ref = toFileRef(name, tarballsDir, tarballMap);
            if (ref) pkg[field][name] = ref;
        }
    }

    // Yarn `resolutions` is the PnP equivalent of npm `overrides` — pins every
    // transitive @gjsify/* (e.g. @gjsify/fs reached through @gjsify/node-polyfills)
    // to the same local tarball, so the test validates relay behavior, not registry
    // version skew.
    pkg.resolutions = buildYarnResolutions(tarballsDir, tarballMap);
    pkg.packageManager = 'yarn@4.14.1';

    writeFileSync(join(projectDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
    writeFileSync(
        join(projectDir, '.yarnrc.yml'),
        ['nodeLinker: pnp', 'enableScripts: false', 'enableGlobalCache: false', 'enableTelemetry: false', ''].join(
            '\n',
        ),
    );

    console.log('  running yarn install (PnP)...');
    execFileSync('yarn', ['install', '--no-immutable'], {
        cwd: projectDir,
        stdio: 'pipe',
        timeout: 5 * 60 * 1000,
        env: { ...process.env, YARN_ENABLE_HARDENED_MODE: '0' },
    });
    console.log('  yarn install done');
}

/**
 * True when the given executable is on PATH. Walks `process.env.PATH`
 * directly via `fs.existsSync` instead of shelling out to `which`(1):
 * the Fedora 43/44 minimal containers used by CI ship without `which`
 * installed (only `which-2.x` rpm provides it), so any `which`-based
 * check silently returns false on EVERY command and turns this helper
 * into a permanent "tool missing" gate. The PATH walk has zero
 * external-binary dependencies — works on any POSIX-shaped env.
 */
export function hasCommand(cmd) {
    const path = process.env.PATH;
    if (!path) return false;
    const sep = process.platform === 'win32' ? ';' : ':';
    for (const dir of path.split(sep)) {
        if (!dir) continue;
        try {
            if (existsSync(join(dir, cmd))) return true;
        } catch {
            // ignore inaccessible PATH entries
        }
    }
    return false;
}
