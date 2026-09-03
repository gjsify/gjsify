#!/usr/bin/env node
// `npm install` of a just-published `@gjsify/*` closure, with the registry's own
// propagation lag treated as "not there yet" instead of as a verdict.
//
// THE INCIDENT — v0.46.0, run 33735989472, measured to the second
//
// The release went red in three jobs (`Publish @gjsify/node-runtime-{darwin-arm64,
// darwin-x64,win32-x64}`), all in the same step, none of them in the publish:
//
//   npm error code ETARGET
//   npm error notarget No matching version found for @gjsify/child_process@^0.46.0.
//
//   09:25:10  `+ @gjsify/child_process@0.46.0`  — the publish client's own PUT receipt
//   09:28:31  `+ @gjsify/cli@0.46.0`            — 3m21s later, so the ORDER was right
//   09:28:35  the `publish` job completes
//   09:28:37  the three node-runtime legs start (`needs: publish` honoured)
//   09:29:06  ETARGET on a version written 3m56s earlier
//   09:29:21  npm's own `time['0.46.0']` for @gjsify/child_process
//
// The registry recorded the version FIFTEEN SECONDS AFTER the client that could not
// resolve it gave up. Nothing was out of order and nothing was missing: the packument
// npm served that installer predated a PUT it had already acknowledged.
//
// The control is what settles it. The identical step, same command, same closure,
// succeeded in every leg that happened to start later — `Publish @gjsify/napi` at
// 09:29:37, `Publish @gjsify/gtk-runtime-darwin-arm64` at 09:31:19 — and attempt 3 of
// the same run went green with no change to the tree at all. Those legs were not more
// correct; they were later. A step whose outcome is decided by its own scheduling
// reports its scheduling, not the thing it was written to check.
//
// THE ARGUMENT IS ALREADY IN THIS REPO, twice, and this is the third caller of it:
// `scripts/check-shipped-runtime-packages.mjs` ("Absence is re-queried a few times
// before it becomes a verdict") and `scripts/verify-published-closure.mjs` ("npm's CDN
// can serve a packument that predates a publish"). Both re-query before they conclude.
// The publish legs did not, because their registry read is inside `npm install` rather
// than in a probe of our own — which changes where the retry goes, not whether one is
// owed.
//
// WHY THE WINDOW IS BIGGER THAN THEIRS. Those two ask "does this packument exist" —
// one cheap GET, so 3 rounds × 5-10 s is a sane budget. This one asks npm to resolve a
// whole transitive closure (the CLI's 21 direct deps pull most of the release train),
// so the lag of ANY member is the lag of the install, and the measured lag of a single
// member was 4m11s between PUT and the registry's own timestamp. A 30-second budget
// would have failed this incident while looking like it had a retry.
//
// WHY `--prefer-online` ON RETRIES. npm caches packuments in `~/.npm/_cacache` and will
// happily satisfy a second resolution from the same stale document it just failed on —
// a retry loop that re-reads its own cache is the "green CI that checked nothing" shape
// with the polarity flipped: red CI that re-checked nothing. `--prefer-online` forces
// the staleness check (npm's documented knob for exactly this). Attempt 1 does NOT get
// it, so the common path stays byte-identical to the command that has shipped every
// release so far, and the flag appears only where it is load-bearing.
//
// ONE BEHAVIOUR DIFFERENCE FROM THE INLINE COMMAND, stated because it is visible in a
// log: each attempt's npm output is captured and re-emitted when that attempt ENDS, so
// a single install is quiet while it runs instead of streaming. Between attempts the
// wrapper prints its own line, so a retrying job still reports progress; the classifier
// needs the whole output, and `maxBuffer: Infinity` below is the other half of that.
//
// WHAT THIS DOES NOT DO. It does not tolerate a missing package. A name that was never
// published, or never bootstrapped for Trusted Publishing, is still absent after the
// window and still fails the job — the retry moves the verdict later, it does not
// weaken it. The failure message says how many rounds over how long, so a reader is
// never sent hunting for a lag that was not one. And a spec naming a package OUTSIDE
// the `@gjsify/` scope fails on the first attempt: the lag window exists because WE
// published that scope minutes ago, and an unresolvable `yargs@^99` is a manifest bug
// whose fix is not waiting.
//
// Usage:
//   node scripts/npm-install-published.mjs [options] -- <npm install args...>
//
//   --cwd <dir>               run npm there (default: process.cwd())
//   --window-ms <n>           total budget for retries (default 600000 = 10 min)
//   --attempts <n>            hard cap on attempts (default 12; window usually binds first)
//   --initial-delay-ms <n>    first backoff (default 5000)
//   --max-delay-ms <n>        backoff ceiling (default 60000)
//   --npm-bin <path>          the npm to run (default "npm") — the seam the e2e suite drives
//   --dry-run                 print the plan and the exact argv, run nothing, exit 0
//
// Exits 0 on a successful install, 1 on anything else.

import { spawnSync } from 'node:child_process';

/** npm error codes that mean "the registry does not offer this (yet)". */
const LAG_CODES = ['ETARGET', 'E404'];

/**
 * Package names an npm failure says it could not resolve.
 *
 * Three message shapes, because npm prints a different one per failure mode and a
 * classifier that knows only the ETARGET wording silently degrades to "retry
 * everything" the first time a release trips the 404 path:
 *
 *   notarget No matching version found for @gjsify/child_process@^0.46.0.
 *   404 Not Found - GET https://registry.npmjs.org/@gjsify%2fnode-runtime-win32-x64
 *   404  '@gjsify/tls-native@^0.4.20' is not in this registry.
 *
 * Returns [] when nothing parses — deliberately NOT an error. See `classifyNpmFailure`.
 */
export function unresolvedPackageNames(text) {
    const names = new Set();

    for (const m of text.matchAll(/No matching version found for (@?[^@\s]+(?:\/[^@\s]+)?)@/g)) {
        names.add(m[1]);
    }
    // `@scope%2fname` is how npm spells a scoped name in a registry URL.
    for (const m of text.matchAll(/404 Not Found - \w+ https?:\/\/[^/\s]+\/([^\s?]+)/g)) {
        names.add(decodeURIComponent(m[1]).replace(/^\/+/, ''));
    }
    for (const m of text.matchAll(/'(@?[^@'\s]+(?:\/[^@'\s]+)?)@[^']*' is not in this registry/g)) {
        names.add(m[1]);
    }

    return [...names];
}

/**
 * Is this npm failure a propagation lag we should re-query, or a verdict?
 *
 * The polarity is deliberate: a lag-shaped CODE earns a retry, and only a POSITIVELY
 * identified foreign package name takes it away. Parsing npm's prose is the fragile
 * half — it is English, it changes between majors — so an unparsable ETARGET must not
 * silently become "fail fast", which is the behaviour this whole file exists to remove.
 * An unknown code, by contrast, is not lag-shaped at all and gets no retry: EACCES,
 * ENOSPC, a 403 and a tarball integrity mismatch are all answers.
 *
 * @param {{ code: number|null, output: string }} result
 * @returns {{ verdict: 'lag'|'fatal', reason: string }}
 */
export function classifyNpmFailure({ code, output }) {
    if (code === 0) return { verdict: 'fatal', reason: 'classifyNpmFailure called on a successful install' };

    const matched = LAG_CODES.filter((c) => new RegExp(`npm (?:error|ERR!) code ${c}\\b`).test(output));
    if (matched.length === 0) {
        return { verdict: 'fatal', reason: 'no ETARGET/E404 in npm output — not a propagation shape' };
    }

    const names = unresolvedPackageNames(output);
    const foreign = names.filter((n) => !n.startsWith('@gjsify/'));
    if (foreign.length > 0) {
        return {
            verdict: 'fatal',
            reason: `${matched.join('+')} names ${foreign.join(', ')}, outside the @gjsify/ scope — nothing we just published can appear`,
        };
    }

    const subject = names.length > 0 ? names.join(', ') : 'an unnamed dependency (npm wording not recognised)';
    return { verdict: 'lag', reason: `${matched.join('+')} on ${subject}` };
}

/**
 * Quote one argv member for the cmd.exe command line Node builds under `shell: true`.
 *
 * TWO FACTS FORCE THIS. On Windows `npm` is `npm.cmd`, and since the CVE-2024-27980
 * fix Node refuses to spawn a `.bat`/`.cmd` without `shell: true` — so the shell is
 * not optional. And under `shell: true` Node builds the command line by JOINING argv
 * WITH SPACES and adds no quoting of its own, so an argument containing a space
 * silently becomes two arguments. The call sites pass exactly such a thing:
 * `--prefix "%RUNNER_TEMP%\bootstrap-cli"`, already expanded by the caller's shell.
 * Today's runners put that under `D:\a\_temp`, which has no space — which is the
 * definition of a latent trap rather than a fixed one.
 */
export function quoteForWin32Shell(arg) {
    if (!/[\s&|<>^"]/.test(arg)) return arg;
    // cmd.exe strips the outer double quotes and treats the rest literally; an inner
    // quote is escaped for the C runtime's parser, which is what npm's own launcher uses.
    return `"${arg.replaceAll('"', '\\"')}"`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Shared defaults, so the CLI layer and `bootstrap-published-cli.mjs` cannot drift. */
export const RETRY_DEFAULTS = {
    windowMs: 600_000,
    maxAttempts: 12,
    initialDelayMs: 5_000,
    maxDelayMs: 60_000,
};

/**
 * `npm install <npmArgs>` in `cwd`, re-querying a propagation lag until the window is
 * spent. Returns a process exit code — 0 installed, 1 anything else.
 *
 * Exported rather than private to `main` because `bootstrap-published-cli.mjs` needs
 * the same loop for the release legs' Node-runnable CLI, and a second copy of it is
 * how the two would come to disagree about what counts as a lag.
 */
export async function installWithRetry({
    cwd = process.cwd(),
    npmArgs,
    npmBin = 'npm',
    windowMs = RETRY_DEFAULTS.windowMs,
    maxAttempts = RETRY_DEFAULTS.maxAttempts,
    initialDelayMs = RETRY_DEFAULTS.initialDelayMs,
    maxDelayMs = RETRY_DEFAULTS.maxDelayMs,
    dryRun = false,
    label = 'npm-install-published',
}) {
    const install = ['install', ...npmArgs];
    console.log(
        `${label}: ${npmBin} ${install.join(' ')}\n` +
            `  cwd ${cwd} · window ${windowMs}ms · attempts <= ${maxAttempts} · backoff ${initialDelayMs}..${maxDelayMs}ms`,
    );

    if (dryRun) {
        console.log(`${label}: --dry-run, nothing executed.`);
        return 0;
    }

    const started = Date.now();
    let delay = initialDelayMs;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        // See the header: attempt 1 is the command that has always run; retries add
        // --prefer-online so npm re-reads the registry instead of its own cacache.
        const args = attempt === 1 ? install : [...install, '--prefer-online'];
        const onWindows = process.platform === 'win32';
        const run = spawnSync(npmBin, onWindows ? args.map(quoteForWin32Shell) : args, {
            cwd,
            encoding: 'utf8',
            // See quoteForWin32Shell: the shell is mandatory for npm.cmd, and it is
            // also what makes the quoting our problem.
            shell: onWindows,
            // NOT the 1 MiB default. spawnSync KILLS the child and reports ENOBUFS the
            // moment output passes maxBuffer, so a SUCCESSFUL install that simply talks
            // too much came back from here as exit 1 — measured: a 3 MiB stdout died as
            // `could not spawn "npm": … ENOBUFS` while the child had exited 0. One
            // lifecycle script is enough to reach it (node-gyp alone prints megabytes),
            // and this wrapper is now the sanctioned route for every workflow install,
            // so the ceiling would have been hit by a call site rather than a release.
            maxBuffer: Infinity,
        });

        if (run.error) {
            // `error` covers a genuinely missing npm AND anything that killed the child
            // before it could report; naming only the first sends the reader hunting.
            console.error(`${label}: "${npmBin}" did not complete: ${run.error.message}`);
            return 1;
        }
        process.stdout.write(run.stdout ?? '');
        process.stderr.write(run.stderr ?? '');

        if (run.status === 0) {
            if (attempt > 1) {
                console.log(
                    `${label}: resolved on attempt ${attempt} after ${Math.round((Date.now() - started) / 1000)}s — registry propagation, not a defect.`,
                );
            }
            return 0;
        }

        const output = `${run.stdout ?? ''}\n${run.stderr ?? ''}`;
        const { verdict, reason } = classifyNpmFailure({ code: run.status, output });
        if (verdict === 'fatal') {
            console.error(`${label}: failing immediately — ${reason}`);
            return 1;
        }

        const elapsed = Date.now() - started;
        const remaining = windowMs - elapsed;
        if (attempt === maxAttempts || remaining <= delay) {
            console.error(
                `${label}: ${reason}, still unresolved after ${attempt} attempt(s) over ` +
                    `${Math.round(elapsed / 1000)}s. Past a propagation lag this means the package is genuinely ` +
                    'absent — check that it was published and, for a new name, that its Trusted Publisher exists.',
            );
            return 1;
        }

        const human = delay >= 1000 ? `${Math.round(delay / 1000)}s` : `${delay}ms`;
        console.error(
            `${label}: ${reason} — re-querying in ${human} ` +
                `(attempt ${attempt + 1}/${maxAttempts}, ${Math.round(remaining / 1000)}s of window left).`,
        );
        await sleep(delay);
        delay = Math.min(delay * 2, maxDelayMs);
    }

    return 1;
}

/**
 * Read the numeric/string retry knobs an argv shares with `bootstrap-published-cli.mjs`.
 *
 * @param {string[]} opts
 * @param {(message: string) => never} fail
 */
export function retryOptionsFromArgv(opts, fail) {
    const flag = (name, fallback) => {
        const i = opts.indexOf(name);
        return i === -1 ? fallback : opts[i + 1];
    };
    const num = (name, fallback) => {
        const raw = flag(name, undefined);
        if (raw === undefined) return fallback;
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0) fail(`${name} expects a non-negative number, got "${raw}"`);
        return n;
    };
    return {
        flag,
        retry: {
            windowMs: num('--window-ms', RETRY_DEFAULTS.windowMs),
            maxAttempts: Math.max(1, num('--attempts', RETRY_DEFAULTS.maxAttempts)),
            initialDelayMs: num('--initial-delay-ms', RETRY_DEFAULTS.initialDelayMs),
            maxDelayMs: num('--max-delay-ms', RETRY_DEFAULTS.maxDelayMs),
            npmBin: flag('--npm-bin', 'npm'),
            dryRun: opts.includes('--dry-run'),
        },
    };
}

function usage(message) {
    console.error(`npm-install-published: ${message}\n`);
    console.error('Usage: node scripts/npm-install-published.mjs [options] -- <npm install args...>');
    process.exit(1);
}

async function main() {
    const argv = process.argv.slice(2);
    const sep = argv.indexOf('--');
    if (sep === -1) usage('missing `--` separator before the npm arguments');

    const opts = argv.slice(0, sep);
    const npmArgs = argv.slice(sep + 1);
    if (npmArgs.length === 0) usage('no npm arguments after `--`');

    const { flag, retry } = retryOptionsFromArgv(opts, usage);
    return installWithRetry({ cwd: flag('--cwd', process.cwd()), npmArgs, ...retry });
}

// Direct invocation only: the e2e suite imports `classifyNpmFailure` from here, and a
// bare top-level `main()` would run a whole install loop on import. Spelled the way
// `report-gate-history.mjs` spells it — `import.meta.main` is not available on every
// Node this repo's CI still runs.
if (process.argv[1] && process.argv[1].endsWith('npm-install-published.mjs')) process.exit(await main());
