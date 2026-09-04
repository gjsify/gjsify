// Shared E2E test helpers for @gjsify CLI/plugin workflows.

import { execFileSync, execSync, spawn } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
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
 * FAILS TOWARDS RUNNING, which is the only safe direction for a decision that ends in a
 * skip: `missing` is what disarms a suite, so nothing lands there without POSITIVE evidence
 * — the registry answered, it knows the package, and it does not have this version. Every
 * other outcome (unreachable, timeout, 5xx, a 404 on the package itself) reports nothing
 * missing, so the suite runs and a real problem stays red. `registryVersionState` is where
 * that rule lives.
 *
 * @param {{wanted?: {name: string, version: string}[], timeoutMs?: number}} [options]
 *   `wanted` defaults to `registryOnlyDependencies()` — the Yarn-PnP question. `create-app`
 *   passes the registry-bound ranges its templates carry instead; the probe is the same one.
 * @returns {Promise<string[]>} `name@version` for each package the registry knows but has
 *   not published at that version
 */
export async function unpublishedRegistryDependencies({
    wanted = registryOnlyDependencies(),
    timeoutMs = 30_000,
} = {}) {
    if (wanted.length === 0) return [];

    const registry = (process.env.GJSIFY_E2E_REGISTRY ?? 'https://registry.npmjs.org').replace(/\/+$/, '');
    const signal = AbortSignal.timeout(timeoutMs);
    const missing = [];

    await Promise.all(
        wanted.map(async ({ name, version }) => {
            if ((await registryVersionState(registry, name, version, signal)) === 'missing')
                missing.push(`${name}@${version}`);
        }),
    );

    return missing.sort();
}

/**
 * What the registry says about ONE exact `name@version`: `published`, `missing`, or
 * `unverified` — and the third state is the point.
 *
 * A bare 404 does not mean "not published yet". A registry that is down behind a proxy, an
 * auth failure, a mistyped `GJSIFY_E2E_REGISTRY`, a package renamed out from under the
 * manifest — all 404 identically, and all of them are RED conditions. Reading any of them as
 * "release in progress" converts a suite that should fail into a suite that skips, which is
 * the one outcome worse than the red this whole mechanism exists to remove. MEASURED against
 * a registry that 404s everything: the previous one-request probe reported every dependency
 * missing and both PnP suites went green-by-skip; with the confirmation below they run.
 *
 * So `missing` requires two answers, not one: the exact-version URL 404s AND the package's
 * own document is served. Then the registry is demonstrably up, demonstrably knows the name,
 * and demonstrably lacks this version — which is the release window and nothing else. The
 * second request only happens on the 404 path, so the common case stays one round trip.
 *
 * `<registry>/<name>/<version>` returns that one version's manifest (a few KB) rather than
 * the packument; the confirmation asks for the abbreviated packument for the same reason.
 *
 * @returns {Promise<'published' | 'missing' | 'unverified'>}
 */
async function registryVersionState(registry, name, version, signal) {
    const path = name.replace('/', '%2f');
    const ask = async (url, accept) => {
        let res;
        try {
            res = await fetch(url, { signal, headers: { accept } });
        } catch {
            return undefined;
        }
        // An unconsumed undici body holds its socket open and keeps the test process
        // alive past the last assertion.
        await res.body?.cancel().catch(() => {});
        return res.status;
    };

    const exact = await ask(`${registry}/${path}/${encodeURIComponent(version)}`, 'application/json');
    if (exact === undefined) return 'unverified';
    if (exact >= 200 && exact < 300) return 'published';
    if (exact !== 404) return 'unverified';

    const packument = await ask(`${registry}/${path}`, 'application/vnd.npm.install-v1+json');
    return packument !== undefined && packument >= 200 && packument < 300 ? 'missing' : 'unverified';
}

/**
 * The opening clause every release-window skip shares, so the three suites that can
 * hit this state read the same in a 146-suite log and one grep finds all of them.
 * The tail — WHY this particular suite cannot run — belongs to the caller.
 */
function registryGapClause(missing, noun) {
    const sample = missing.slice(0, 3).join(', ');
    const more = missing.length > 3 ? ` (+${missing.length - 3} more)` : '';
    return `the workspace version is not on npm yet — ${missing.length} ${noun} 404: ${sample}${more}.`;
}

/**
 * `false` when the Yarn-PnP suites can run, otherwise the reason they cannot.
 * Shaped for `describe(name, { skip }, fn)`; both PnP suites share the wording
 * so the skip reads the same wherever it shows up in the log.
 */
export async function pnpRegistryGapSkipReason() {
    const missing = await unpublishedRegistryDependencies();
    if (missing.length === 0) return false;

    return (
        `${registryGapClause(missing, 'unpacked dependency/-ies')} Yarn PnP resolves those ` +
        `from the registry because pack.mjs omits them by design, so this suite cannot build ` +
        `its external-consumer tree until release.yml has published. Re-runs after ` +
        `the publish exercise it again unchanged.`
    );
}

/**
 * `false` when the `create-app` E2E suite can run, otherwise the reason it cannot.
 *
 * WHY THIS EXISTS, measured on v0.43.0. A release cut pushes `chore: release vX.Y.Z` to
 * `main`, which starts `main.yml`, while the tag's `release: published` event starts
 * `release.yml` — CONCURRENTLY. The bumper has already written the new version into every
 * manifest, and `process-template.mjs` turns a template's `file:` edge on a non-workspace
 * package into `^<that version>`. So this suite scaffolds a project asking the public
 * registry for a version `release.yml` has not published yet, and `npm install` dies with
 * `ETARGET No matching version found for @gjsify/node-gi@^0.43.0`. The outcome was a coin
 * toss rather than a bug: v0.43.0 red, v0.42.0 cancelled, v0.41.0 cancelled then green,
 * v0.40.0 green. That is the worst shape a gate can have — a red that means nothing teaches
 * everyone to ignore red on release commits.
 *
 * WHY IT SKIPS RATHER THAN WAITS (#1523). The first fix was a 30-minute wait. Measured from
 * the registry's own `.time[version]`, the publish takes 43-70 min (v0.44.0 70, v0.45.0 43,
 * v0.46.0 46 — three for three over budget), because `@gjsify/node-gi` is one of the
 * platform packages whose payload job runs AFTER the ~199-package serial sweep, so it sets
 * the tail and the tail is what this suite waited on. A deadline shorter than the thing it
 * waits on does not wait, it fails: for an hour after every release every PR reaching this
 * suite went red with text that read like a publishing incident. Raising the number parks a
 * runner for an hour and re-breaks as the package count grows; resolving against the local
 * build would delete the only coverage of the path that broke (a real consumer `npm install`
 * from npm). Recognising the state is the honest answer, and this repo already had the
 * vocabulary for it — the same `describe(..., { skip })` the two PnP suites use.
 *
 * What the wait ALSO did — "if the publish never lands, the deadline says so by name" — is
 * not lost, and was never really this suite's job: `scripts/verify-published-closure.mjs
 * --phase post-release` enumerates `packages/node-gi/*` and `packages/napi/*` explicitly and
 * reports every `notLive` name at the end of `release.yml`.
 *
 * Propagation lag between "the version resolves" and "the tarball is fetchable" is absorbed
 * where it can actually bite — `npmInstallWithRetry`, at the install, which starts minutes
 * after any pre-flight probe would have finished.
 *
 * FAIL-CLOSED, THREE TIMES OVER, because a detector that leans towards "release in progress"
 * turns a red hour into a permanently green suite, which is strictly worse than the bug:
 *
 * 1. A range is a candidate only if `pinnedFloorVersion` recognises its spelling.
 * 2. It is `missing` only if `registryVersionState` says so — the registry answered AND
 *    knows the package. Unreachable, 5xx, or a registry that 404s everything all run.
 * 3. The version must be THIS RELEASE TRAIN'S. `^0.48.0` unresolvable while the checkout is
 *    releasing 0.48.0 is the window; `^99.0.0` unresolvable is a wrong range, and it still
 *    fails the suite the way it always did. Without this the skip would forgive any range
 *    that happens not to resolve, which is how a mis-set deadline becomes a mis-set gate.
 *    The train version is the root manifest's, the same anchor
 *    `scripts/verify-published-closure.mjs` probes every candidate at.
 *
 * @param {[string, string][]} pending `[name, range]` pairs the scaffolded project will ask
 *   the registry for — same shape the wait took, so the call site swapped one for the other.
 */
export async function createAppRegistryGapSkipReason(pending, { timeoutMs = 30_000 } = {}) {
    const trainVersion = JSON.parse(readFileSync(join(MONOREPO_ROOT, 'package.json'), 'utf8')).version;
    const wanted = [];
    for (const [name, spec] of pending) {
        const version = pinnedFloorVersion(spec);
        if (version && version === trainVersion) wanted.push({ name, version });
    }
    const missing = await unpublishedRegistryDependencies({ wanted, timeoutMs });
    if (missing.length === 0) return false;

    return (
        `${registryGapClause(missing, 'registry-bound template dependency/-ies')} A scaffolded ` +
        `project installs those from npm — that IS what this suite proves — and patchPackageJson ` +
        `does not remap them because they are not workspace members, so it cannot build its ` +
        `consumer tree until release.yml has published. Re-runs after the publish exercise it ` +
        `again unchanged.`
    );
}

/**
 * The one exact version a range is MINTED FROM, or `undefined` when the spelling is not one
 * `process-template.mjs` writes.
 *
 * Deliberately NOT a semver range match — the question is not "what could satisfy this", it
 * is "which version was this range generated for", and the generator answers it: every
 * registry-bound edge in `dist-templates/` was written by `resolveWorkspaceDeps` as
 * `^${version}` / `~${version}` / the literal version, read off the target manifest. Reading
 * that literal back is exact where a semver compare would be a guess.
 *
 * Anything else — `>=1 <2`, `*`, a dist-tag, a URL — returns `undefined` and therefore never
 * reaches the probe and can never produce a skip. That is the fail-closed default: a spelling
 * this function does not recognise is a spelling it must not disarm a suite over.
 */
function pinnedFloorVersion(spec) {
    return /^[\^~]?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/.exec(spec.trim())?.[1];
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

/**
 * Why a suite will not run — or, when `GJSIFY_E2E_REQUIRE` names it, a THROW.
 *
 * THE CLASS (#1550). A suite behind a SKIP gate reports the same thing whether it
 * passed or never ran: nothing. `react-native-devtools` names a long list of
 * preconditions and
 * is the only external observer of `AppRegistry.runApplication`'s body (ADR 0043);
 * `devtools-export` and `terminal-native` are ledgered beside it in
 * `scripts/e2e-unlisted-suites.mjs` for the same reason. Put any of them on a CI
 * host missing ONE precondition and the job goes green having measured nothing —
 * the defect `scripts/report-probe-outcome.mjs` exists to end one layer up,
 * relocated into a workflow where it looks like coverage instead.
 *
 * SO A HOST THAT MEANS TO RUN A SUITE SAYS SO, and a missing precondition is then a
 * failure NAMING it rather than a silence. `GJSIFY_E2E_REQUIRE` is a
 * comma-separated list of suite directory names, or `all`; `1` is accepted as a
 * spelling of `all`, because that is what a workflow author writes first.
 *
 * PER-SUITE, and that is not a convenience. `devtools-export` has a MEASURED and
 * still unexplained failure in the containerised runner — the application owns
 * `org.example.reprotest` and then loses it — so a switch that demanded every
 * ledgered suite at once would turn an open question into a red gate. A host
 * asserts only what it has been shown to provide.
 *
 * @param {string} suite the suite's directory name under `tests/e2e/`
 * @param {ReadonlyArray<readonly [string, boolean]>} preconditions `[what it needs, is it here]`
 * @returns {false | string} `false` to RUN — the value `node:test`'s `skip` wants — or the reason
 */
export function e2eSkipReason(suite, preconditions) {
    const missing = preconditions.filter(([, ok]) => !ok).map(([what]) => what);
    if (missing.length === 0) return false;
    const reason = `${suite}: host is missing ${missing.length} of ${preconditions.length} precondition(s) — ${missing.join('; ')}`;
    const required = (process.env.GJSIFY_E2E_REQUIRE ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry !== '');
    if (required.includes(suite) || required.includes('all') || required.includes('1')) {
        throw new Error(
            `${reason}.\n` +
                `    GJSIFY_E2E_REQUIRE names "${suite}", so skipping is a FAILURE here: a host that\n` +
                '    claims it can run this suite and then goes quiet reports exactly what a host that\n' +
                '    ran it and found nothing wrong reports. Install the missing precondition, or stop\n' +
                '    naming this suite in GJSIFY_E2E_REQUIRE.',
        );
    }
    return reason;
}
