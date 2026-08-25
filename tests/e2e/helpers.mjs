// Shared E2E test helpers for @gjsify CLI/plugin workflows.

import { execFileSync, execSync, spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';

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
 * Block until the registry can resolve every `[name, range]` pair, or fail naming
 * what never arrived.
 *
 * WHY THIS EXISTS, measured on v0.43.0. A release cut pushes `chore: release
 * vX.Y.Z` to `main`, which starts `main.yml`, while the tag's `release: published`
 * event starts `release.yml` — CONCURRENTLY. The bumper has already written the new
 * version into every manifest, and `process-template.mjs` turns a template's
 * `file:` edge on a non-workspace package into `^<that version>`. So this suite
 * scaffolds a project asking the public registry for a version that `release.yml`
 * has not published yet, and `npm install` dies with
 * `ETARGET No matching version found for @gjsify/node-gi@^0.43.0`.
 *
 * The outcome was a coin toss rather than a bug: v0.43.0 red, v0.42.0 cancelled,
 * v0.41.0 cancelled then green, v0.40.0 green. That is the worst shape a gate can
 * have — a red that means nothing teaches everyone to ignore red on release
 * commits.
 *
 * Waiting is the fix rather than pointing the dependency at a local tarball,
 * because installing from the registry is exactly what this suite exists to prove:
 * a user runs `npm create @gjsify/app` against npm, and making the install
 * hermetic would delete the only coverage of the path that actually broke. The
 * wait also turns the race into real coverage of the release — if the publish never
 * lands, the deadline says so by name.
 *
 * On an ordinary commit every range resolves on the first probe, because the
 * checkout's version is the last released one.
 */
export function awaitRegistryResolvable(
    pending,
    { label = 'e2e', deadlineMs = 30 * 60 * 1000, intervalMs = 20 * 1000 } = {},
) {
    const outstanding = pending.filter(([name, range]) => !registryResolves(name, range));
    if (outstanding.length === 0) return;

    const deadline = Date.now() + deadlineMs;
    const budget =
        deadlineMs >= 60_000 ? `${Math.round(deadlineMs / 60_000)} min` : `${Math.round(deadlineMs / 1000)} s`;
    console.log(
        `  [${label}] waiting for the registry to carry ${outstanding
            .map(([n, r]) => `${n}@${r}`)
            .join(', ')} (up to ${budget})…`,
    );
    for (let left = outstanding; left.length > 0;) {
        if (Date.now() >= deadline) {
            throw new Error(
                `awaitRegistryResolvable: the registry still cannot resolve ` +
                    `${left.map(([n, r]) => `${n}@${r}`).join(', ')} after ` +
                    `${budget}. On a release commit that means the publish ` +
                    `did not land; otherwise the range is wrong.`,
            );
        }
        sleepSync(intervalMs);
        left = left.filter(([name, range]) => !registryResolves(name, range));
        if (left.length > 0)
            console.log(`  [${label}] still waiting for ${left.map(([n, r]) => `${n}@${r}`).join(', ')}…`);
    }
    console.log(`  [${label}] the registry carries every range now.`);
}

/**
 * Ask NPM ITSELF whether a range resolves — never a hand-rolled semver compare.
 * `npm install` is the consumer, so `npm view` is the one resolver whose answer
 * cannot disagree with it.
 */
function registryResolves(name, range) {
    try {
        const out = execFileSync('npm', ['view', `${name}@${range}`, 'version', '--json'], {
            stdio: ['ignore', 'pipe', 'pipe'],
            encoding: 'utf8',
            timeout: 60 * 1000,
        });
        const text = out.trim();
        return text.length > 0 && text !== '[]';
    } catch {
        // `npm view` exits non-zero for "no matching version" (E404/ETARGET) and for a
        // network hiccup alike, and here both mean the same thing: not resolvable yet,
        // ask again. A permanent failure is what the deadline above is for.
        return false;
    }
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

/** SIGTERM/SIGKILL a whole process group. ESRCH means it is already gone — nothing to do. */
function killGroup(pid, signal) {
    try {
        process.kill(-pid, signal);
    } catch (err) {
        if (err.code !== 'ESRCH') throw err;
    }
}

const outputDump = (output) => `\n--- output ---\n${output.trimEnd() || '(nothing printed)'}`;

/**
 * Start a process and resolve once it has PROVEN it came up.
 *
 * Readiness is a predicate, never a sleep, and it takes two shapes because the
 * processes do: a server announces its port on stdout (`ready`), a GTK app
 * announces nothing and has to be asked from the outside (`probe`). Pass either
 * or both; passing neither throws, because "started" would then mean "`spawn()`
 * returned", which is equally true of a bundle that dies in its first tick.
 *
 * That last case is why this exists. `tests/e2e/create-app` proved its scaffolded
 * templates with `node --check` on the built bundle, so one that scaffolded,
 * type-checked and then died at startup passed — which is how a CLI template with
 * no default command and a GTK template with a shared application id both shipped.
 *
 * `awaitExit` covers one-shot commands: resolve when the process has exited AND
 * `ready` matched what it printed, so the caller asserts on the exit code
 * instead of racing it.
 *
 * The child gets its own process GROUP. Callers start a package-manager script,
 * i.e. a shell that spawns a runtime that spawns the app; killing the pid alone
 * leaves the app holding its port or its bus name for whatever runs next.
 *
 * @returns {Promise<{child: import('node:child_process').ChildProcess, output: () => string,
 *   code: number|null, signal: string|null, exited: Promise<{code: number|null, signal: string|null}>,
 *   stop: () => Promise<{code: number|null, signal: string|null}>}>}
 */
export async function spawnUntilReady(command, args, options = {}) {
    const { cwd, env, ready, probe, awaitExit = false, timeoutMs = 60_000, pollMs = 250, label = command } = options;
    if (!ready && !probe) {
        throw new Error(`spawnUntilReady(${label}): pass \`ready\`, \`probe\` or both — otherwise "ready" is a sleep.`);
    }

    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let output = '';
    const collect = (chunk) => {
        output += chunk.toString();
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (err) => {
        output += `\n[spawn error] ${err.message}\n`;
    });

    // `close`, not `exit`: `exit` fires while the pipes may still hold the very
    // line the caller is waiting for, which reports a healthy process as "exited
    // before it was ready" with the evidence missing from the message.
    let closed;
    const exited = new Promise((resolve) => {
        child.on('close', (code, signal) => {
            closed = { code, signal };
            resolve(closed);
        });
    });

    const stop = async () => {
        if (!closed) {
            killGroup(child.pid, 'SIGTERM');
            const escalate = setTimeout(() => killGroup(child.pid, 'SIGKILL'), 5_000);
            escalate.unref();
            await exited;
            clearTimeout(escalate);
        }
        return exited;
    };

    const printed = () => (typeof ready === 'function' ? ready(output) : ready ? ready.test(output) : true);
    const handle = () => ({
        child,
        output: () => output,
        code: closed?.code ?? null,
        signal: closed?.signal ?? null,
        exited,
        stop,
    });

    const deadline = Date.now() + timeoutMs;
    let probeError;
    for (;;) {
        let isReady = printed();
        if (isReady && probe) {
            try {
                isReady = Boolean(await probe());
            } catch (err) {
                // Asking a port or a bus name that is not up yet is the NORMAL
                // not-ready answer, so it cannot be fatal — but it is the only
                // diagnosis a timeout has, so it is carried into that message.
                probeError = err;
                isReady = false;
            }
        }
        if (isReady && (!awaitExit || closed)) return handle();
        if (closed) {
            if (isReady) return handle();
            throw new Error(
                `${label} exited (code ${closed.code}, signal ${closed.signal}) before it was ready.` +
                    outputDump(output),
            );
        }
        if (Date.now() >= deadline) {
            await stop();
            const why = probeError ? `\nlast probe error: ${probeError.message}` : '';
            throw new Error(`${label} was not ready within ${timeoutMs}ms.${why}` + outputDump(output));
        }
        await sleep(pollMs);
    }
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
