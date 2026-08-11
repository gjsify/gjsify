// Shared E2E test helpers for @gjsify CLI/plugin workflows.

import { execFileSync, execSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import { readLockfileVersion } from '../../scripts/check-lockfile-current.mjs';
import { MONOREPO_ROOT, HOST_TARGET, registryOnlyDependencies } from './workspaces.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Re-exported, not re-derived: `pack.mjs` reads the same two from `workspaces.mjs`,
// and what a suite packs must be described by the same constants as what it asserts.
export { MONOREPO_ROOT, HOST_TARGET };

/**
 * The `lockfileVersion` a FRESH resolve writes — READ FROM THE WRITER, never restated.
 *
 * Four suites hardcoded `3`, each with its own rationale string ("v3 (path-keyed +
 * platform fields)"). The bump to 4 turned all four red at once and made those
 * rationales wrong — the version is a precondition they assert in passing, not their
 * point. A parse failure THROWS: a helper that guessed would turn every one of those
 * preconditions into a test that cannot fail.
 *
 * The reader is imported from `scripts/check-lockfile-current.mjs` (which needs the same
 * number for the TRACKED lockfile) rather than re-implemented.
 *
 * Deliberately NOT for fixtures: a suite that writes an OLD lockfile on purpose
 * (backwards-compat, torn-write recovery) keeps its literal, because that number is the
 * input being tested.
 */
export const LOCKFILE_VERSION = readLockfileVersion();

/**
 * The directory holding a bridge's committed prebuild for one target — since ADR 0017 a
 * per-target package `<bridge>-<target>/`, not a directory inside the bridge.
 *
 * ONE definition, imported, never composed at each call site: nine fixtures built this
 * path themselves through the `<os>-<arch>` unification, all nine needed a hand sweep,
 * and one was missed *because a composed string never appears as a literal to grep for*
 * (`status/open-todos.md`). The same fixtures then broke again on the ADR 0017 split, in
 * two suites the first sweep's grep could not see.
 *
 * The naming rule it encodes belongs to `platformPackageDirName()` in
 * `@gjsify/manifest-conformance`, which generates these directories.
 *
 * @param {string} pillar `node` | `web` | `framework` | `infra`
 * @param {...string} rest optional leaf segments inside the directory
 */
export function prebuildDir(pillar, bridge, target, ...rest) {
    return join(MONOREPO_ROOT, 'packages', pillar, `${bridge}-${target}`, 'prebuilds', target, ...rest);
}

/**
 * The same directory as an INSTALLED package resolves it, under a node_modules tree.
 * A consumer installs only their own target's package (that IS the split), so `target`
 * defaults to this host's.
 */
export function installedPrebuildDir(nodeModulesDir, bridge, target = HOST_TARGET, ...rest) {
    return join(nodeModulesDir, '@gjsify', `${bridge}-${target}`, 'prebuilds', target, ...rest);
}

/** Pack all workspace tarballs via pack.mjs; returns `{ "@gjsify/foo": "…foo.tgz" }`. */
export function packWorkspaces(tarballsDir) {
    const stdout = execFileSync('node', [join(__dirname, 'pack.mjs'), tarballsDir], {
        cwd: MONOREPO_ROOT,
        encoding: 'utf8',
        maxBuffer: 50 * 1024 * 1024,
        timeout: 10 * 60 * 1000,
    });
    return JSON.parse(stdout);
}

export function createTestEnvironment(prefix = 'gjsify-e2e-') {
    const tmpDir = mkdtempSync(join(tmpdir(), prefix));
    const tarballsDir = join(tmpDir, 'tarballs');

    console.log(`  tmp dir: ${tmpDir}`);
    console.log('  packing workspace packages...');
    const tarballMap = packWorkspaces(tarballsDir);
    console.log(`  packed ${Object.keys(tarballMap).length} packages`);

    return { tmpDir, tarballsDir, tarballMap };
}

/** Clean up a temporary directory unless GJSIFY_E2E_KEEP_TEMP is set. */
export function cleanupTestEnvironment(tmpDir) {
    if (process.env.GJSIFY_E2E_KEEP_TEMP) {
        console.log(`  keeping tmp dir: ${tmpDir}`);
    } else if (tmpDir) {
        rmSync(tmpDir, { recursive: true, force: true });
    }
}

/** Build an npm `overrides` object pointing all @gjsify/* packages to local tarballs. */
export function buildOverrides(tarballsDir, tarballMap) {
    const overrides = {};
    for (const [name, filename] of Object.entries(tarballMap)) {
        overrides[name] = `file:${join(tarballsDir, filename)}`;
    }
    return overrides;
}

/** A package name as a tarball `file:` reference, or `undefined` if not packed. */
export function toFileRef(name, tarballsDir, tarballMap) {
    const filename = tarballMap[name];
    if (!filename) return undefined;
    return `file:${join(tarballsDir, filename)}`;
}

/** Synchronous sleep (no extra process) — used for retry backoff. */
function sleepSync(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Heuristic: a transient registry/network hiccup vs a deterministic dependency error. */
function isTransientInstallError(err) {
    const text = `${err?.message ?? ''}\n${err?.stdout ?? ''}\n${err?.stderr ?? ''}`;
    return /E404|ETARGET|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|network|registry\.npmjs\.org|\b(?:429|500|502|503|504)\b|Not Found|could not be found/i.test(
        text,
    );
}

/**
 * Run `npm install` in `projectDir`, retrying on transient failures. E2E templates pull
 * heavy `@girs/*` tarballs from the public registry in parallel and the registry
 * intermittently 404s a tarball that genuinely exists (observed: Fedora 43 passes while
 * Fedora 44 fails on the identical commit).
 *
 * Only the install is retried — callers' build/check steps stay deterministic so a real
 * regression fails on the first attempt rather than being masked.
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

/** Write a package.json with all `@gjsify/*` deps pointed at local tarballs, then install. */
export function setupProject(projectDir, pkg, tarballsDir, tarballMap) {
    for (const field of ['dependencies', 'devDependencies']) {
        if (!pkg[field]) continue;
        for (const name of Object.keys(pkg[field])) {
            const ref = toFileRef(name, tarballsDir, tarballMap);
            if (ref) pkg[field][name] = ref;
        }
    }

    // Overrides cover the transitive deps `dependencies` patching cannot reach.
    pkg.overrides = buildOverrides(tarballsDir, tarballMap);

    writeFileSync(join(projectDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

    console.log('  running npm install...');
    npmInstallWithRetry(projectDir, { label: 'setupProject', timeoutMs: 3 * 60 * 1000 });
    console.log('  npm install done');
}

/**
 * Build a Yarn `resolutions` map redirecting all @gjsify/* requests to local tarballs.
 * Used with `nodeLinker: pnp` to simulate an external npm-installed consumer.
 */
export function buildYarnResolutions(tarballsDir, tarballMap) {
    const resolutions = {};
    for (const [name, filename] of Object.entries(tarballMap)) {
        resolutions[name] = `file:${join(tarballsDir, filename)}`;
    }
    return resolutions;
}

/**
 * Which packages a packed tree must fetch from npm that the registry cannot supply at
 * this workspace's version — i.e. what a Yarn-PnP install here is going to fail on.
 *
 * `pack.mjs` deliberately omits the foreign-target platform packages (see
 * `isForeignPlatformPackage`), so `resolutions` never covers them and Yarn goes to npm.
 * npm's node-modules linker drops an unresolvable OPTIONAL dependency silently, which is
 * why the npm-based suites never noticed; PnP resolves the whole graph up front and stops
 * with `YN0082: … No candidates found`.
 *
 * That is the suite asking for a version not published yet, in exactly one window: after
 * `release-cut.yml` bumped every workspace and before `release.yml` published. In that
 * window an external consumer cannot install the version either, so the scenario these
 * suites reconstruct is not merely untested, it is not constructible.
 *
 * Fails OPEN: a probe that cannot reach the registry reports nothing missing, so a network
 * problem yields the same honest red as before rather than disarming the suite.
 *
 * @returns {Promise<string[]>} `name@version` for each package npm 404s on
 */
export async function unpublishedRegistryDependencies({ timeoutMs = 30_000 } = {}) {
    const wanted = registryOnlyDependencies();
    if (wanted.length === 0) return [];

    const registry = (process.env.GJSIFY_E2E_REGISTRY ?? 'https://registry.npmjs.org').replace(/\/+$/, '');
    const signal = AbortSignal.timeout(timeoutMs);
    const missing = [];

    await Promise.all(
        wanted.map(async ({ name, version }) => {
            // `<registry>/<name>/<version>` returns that one version's manifest (a few KB)
            // or 404 — no packument download.
            const url = `${registry}/${name.replace('/', '%2f')}/${encodeURIComponent(version)}`;
            let res;
            try {
                res = await fetch(url, { signal, headers: { accept: 'application/json' } });
            } catch {
                return; // unreachable registry — fail open
            }
            // An unconsumed undici body holds its socket open and keeps the test process
            // alive past the last assertion.
            await res.body?.cancel().catch(() => {});
            if (res.status === 404) missing.push(`${name}@${version}`);
        }),
    );

    return missing.sort();
}

/**
 * `false` when the Yarn-PnP suites can run, otherwise the reason they cannot.
 * Shaped for `describe(name, { skip }, fn)`; both PnP suites share the wording
 * so the skip reads the same wherever it shows up in the log.
 */
export async function pnpRegistryGapSkipReason() {
    const missing = await unpublishedRegistryDependencies();
    if (missing.length === 0) return false;

    const sample = missing.slice(0, 3).join(', ');
    const more = missing.length > 3 ? ` (+${missing.length - 3} more)` : '';
    return (
        `the workspace version is not on npm yet — ${missing.length} unpacked ` +
        `dependency/-ies 404: ${sample}${more}. Yarn PnP resolves those from the ` +
        `registry because pack.mjs omits them by design, so this suite cannot build ` +
        `its external-consumer tree until release.yml has published. Re-runs after ` +
        `the publish exercise it again unchanged.`
    );
}

/**
 * Write a Yarn-PnP-flavoured project and install deps.
 *
 * Distinct from `setupProject` (npm + node-modules linker): this exercises the gjsify CLI
 * under Yarn 4 with `nodeLinker: pnp`, the setup external consumers like ts-for-gir use.
 * It validates that the PnP relay in `@gjsify/cli`'s build action resolves transitive
 * `@gjsify/*` polyfills without each one being a direct devDep.
 *
 * Requires `yarn` (>= 4) on PATH; the test skips itself if yarn is missing.
 */
export function setupProjectYarnPnp(projectDir, pkg, tarballsDir, tarballMap) {
    for (const field of ['dependencies', 'devDependencies']) {
        if (!pkg[field]) continue;
        for (const name of Object.keys(pkg[field])) {
            const ref = toFileRef(name, tarballsDir, tarballMap);
            if (ref) pkg[field][name] = ref;
        }
    }

    // Yarn `resolutions` is the PnP equivalent of npm `overrides`: pinning every transitive
    // `@gjsify/*` to the local tarball is what makes this test measure relay behaviour
    // rather than registry version skew.
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
    // `stdio: 'pipe'` is deliberate — yarn is chatty — but on FAILURE it hides the reason:
    // execFileSync's Error carries stdout/stderr as Buffers and a test reporter prints those
    // as `<Buffer 1b 5b …>`. Re-throwing with the captured output decoded costs nothing on
    // the happy path.
    try {
        runYarnInstall(projectDir);
    } catch (err) {
        const dump = (buf) => (buf ? Buffer.from(buf).toString('utf8').trimEnd() : '(empty)');
        console.error('  yarn install FAILED — captured output follows');
        console.error('  --- stdout ---\n' + dump(err.stdout));
        console.error('  --- stderr ---\n' + dump(err.stderr));
        throw err;
    }
    console.log('  yarn install done');
}

/** The install itself, split out so the caller above owns the diagnostics. */
function runYarnInstall(projectDir) {
    execFileSync('yarn', ['install', '--no-immutable'], {
        cwd: projectDir,
        stdio: 'pipe',
        timeout: 5 * 60 * 1000,
        env: {
            ...process.env,
            YARN_ENABLE_HARDENED_MODE: '0',
            // The `packageManager` field above makes Corepack fetch that exact Yarn, and
            // Corepack ASKS before downloading. With no TTY the prompt is not a pause but an
            // immediate exit 1, whose only trace is "Corepack is about to download …" — the
            // suite then reports its own tests as failures, naming the polyfills it never got
            // to build rather than the install that never happened. It stays invisible for as
            // long as the runner image happens to carry that Yarn in Corepack's cache.
            COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
        },
    });
}

/**
 * True when the given executable is on PATH. Walks `process.env.PATH` via `existsSync`
 * rather than shelling out to `which`(1): the minimal Fedora containers CI uses ship
 * without `which`, so a `which`-based check returns false for EVERY command and turns this
 * helper into a permanent "tool missing" gate.
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
