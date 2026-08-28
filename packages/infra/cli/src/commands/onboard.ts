// `gjsify onboard [--packages <glob>] [--include/--exclude <glob>] [--dry-run] …`
//
// One command that ensures EVERY publishable package in a monorepo is both
// PUBLISHED on npm AND has a Trusted Publisher configured for that repo's
// release workflow. It does the minimum work — publishing/trusting only what's
// missing — and folds the whole manual bootstrap sequence documented in
// docs/publishing.md into a single idempotent sweep:
//
//   1. Auth gate — `whoami` first. If the token is live, proceed without asking
//      for credentials; only when it is dead/missing do we run the `gjsify
//      login` flow (unless `--yes` on a non-TTY, which fails clearly).
//   2. Enumerate the publishable packages (non-private), from the root
//      manifest's `workspaces` globs and/or `--packages` directory globs, then
//      filter by `--include`/`--exclude`. Every source is reported with its
//      count — see utils/onboard-discovery.ts for why that is load-bearing.
//   3. Determine each package's state (bounded concurrency) by reading npm's
//      Trusted-Publisher config through the SAME requester path `gjsify trust`
//      uses: unpublished (404) / published-but-untrusted / published-and-trusted.
//      A 2FA-gated read is answered with the shared OTP (the first read is
//      serial so the prompt happens once); a transient 401 is retried once.
//   4. Act on the gaps, minimally: build+publish+trust an unpublished package;
//      trust a published-but-untrusted one; skip an already-done one.
//   5. Share ONE OTP across every read + publish + trust operation — the cached
//      code is tried before prompting, so a whole sweep of N packages typically
//      needs the user to type an OTP only once (see utils/npm-otp.ts).
//
// NOTHING here is specific to this repo. `--packages '*'` over a root that has
// no package.json at all is the shape `gjsify/types` needs (703 `@girs/*`
// directories, no workspace manifest), and it is the same code path that sweeps
// this monorepo's workspaces.
//
// Re-running when everything is already published + trusted does nothing and
// exits 0. `--dry-run` reports the plan and changes nothing.

import { spawnSync } from 'node:child_process';
import { DEFAULT_REGISTRY, whoami, type NpmrcConfig } from '@gjsify/npm-registry';
import { filterWorkspaces, type Workspace } from '@gjsify/workspace';
import type { Command } from '../types/index.js';
import { hasAnyCredential, loadNpmrc } from '../utils/load-npmrc.js';
import { OtpProvider } from '../utils/npm-otp.js';
import { publishWorkspace } from './publish.js';
import { createTrustRequester } from './trust.js';
import { runLogin, LoginError } from './login.js';
import { detectPackageManager } from './workspace.js';
import { spawnToCompletion } from '../utils/spawn.js';
import {
    assertEveryPatternMatches,
    assertRepositoryAgreement,
    collectOnboardPackages,
    describeSources,
    resolveRepoRoot,
} from '../utils/onboard-discovery.js';
import {
    githubTrustBody,
    normalizeWorkflowFile,
    parseRepoFromGitRemote,
    validateRepository,
} from '../utils/trust-registry.js';
import {
    DEFAULT_PROBE_CONCURRENCY,
    probeAllTrustStates,
    requestWaitingOutRateLimit,
    type PkgPlan,
} from '../utils/onboard-probe.js';

interface OnboardOptions {
    repository?: string;
    workflow: string;
    environment?: string;
    registry?: string;
    otp?: string;
    concurrency: number;
    packages?: string[];
    include?: string[];
    exclude?: string[];
    access: string;
    build: boolean;
    verbose?: boolean;
    'dry-run'?: boolean;
    json?: boolean;
    yes?: boolean;
}

/** Per-package outcome after the act phase (for the JSON summary). */
interface PkgResult {
    name: string;
    /** `already-done` | `published` | `trusted` | `published+trusted` | `skipped-dry-run` | `failed`. */
    result: string;
    detail?: string;
}

export const onboardCommand: Command<unknown, OnboardOptions> = {
    command: 'onboard',
    description:
        'Ensure every publishable package in a monorepo is both published on npm and has a Trusted Publisher configured for its release workflow — publishing/trusting only what is missing, one shared OTP across the whole sweep. Works on npm/yarn workspaces and, via --packages, on a monorepo with no workspace manifest at all. Idempotent.',
    builder: (yargs) =>
        yargs
            .option('repository', {
                description: 'GitHub repo as `owner/repo`. Default: inferred from the `origin` git remote.',
                type: 'string',
            })
            .option('workflow', {
                description: 'Workflow filename allowed to publish via OIDC (basename only).',
                type: 'string',
                default: 'release.yml',
            })
            .option('environment', {
                description: 'Optional GitHub Actions environment the workflow must run in.',
                type: 'string',
            })
            .option('registry', {
                description: `Registry override. Default: scope-aware lookup from .npmrc (falls back to ${DEFAULT_REGISTRY}).`,
                type: 'string',
            })
            .option('otp', {
                description:
                    'npm 2FA one-time code, used as the initial shared code. Prompted on demand (once) if omitted and a challenge occurs.',
                type: 'string',
            })
            .option('packages', {
                description:
                    'Directory glob naming package folders, resolved against the repo root (repeatable). For a monorepo that is not an npm/yarn workspace — `--packages "*"` in a repo whose 703 package directories sit at the top level. Merged with the root manifest\'s own `workspaces` globs when it has any. A pattern matching NO directory is a hard error.',
                type: 'string',
                array: true,
            })
            .option('include', {
                description: 'Glob pattern to include packages by NAME (repeatable). Applied after discovery.',
                type: 'string',
                array: true,
            })
            .option('exclude', {
                description: 'Glob pattern to exclude packages by NAME (repeatable). Applied after discovery.',
                type: 'string',
                array: true,
            })
            .option('access', {
                description:
                    'npm access for a FIRST publish — `public` or `restricted`. Only ever applied to a package this sweep publishes; an already-published package keeps whatever access it has.',
                type: 'string',
                choices: ['public', 'restricted'],
                default: 'public',
            })
            .option('build', {
                description:
                    "Run each to-be-published package's `build` script first. `--no-build` skips it, for a repo whose packages are generated artifacts with nothing to build.",
                type: 'boolean',
                default: true,
            })
            .option('verbose', {
                description:
                    'List every package in the plan table, including the ones already published + trusted (by default only the rows needing work are listed; the counts always cover all of them).',
                type: 'boolean',
                alias: 'v',
                default: false,
            })
            .option('concurrency', {
                description:
                    'How many packages to probe (read state) in parallel (kept small so a single token does not burst npm; the first read is always serial to prompt for the shared OTP once).',
                type: 'number',
                default: DEFAULT_PROBE_CONCURRENCY,
            })
            .option('dry-run', {
                description: 'Report the plan (what would be published / trusted) without changing anything.',
                type: 'boolean',
                default: false,
            })
            .option('json', {
                description: 'Emit a machine-readable summary object as the final line of stdout.',
                type: 'boolean',
                default: false,
            })
            .option('yes', {
                description:
                    'Non-interactive: never prompt. Fail clearly if a login or an OTP is required and not supplied via flags.',
                type: 'boolean',
                default: false,
            }),
    handler: async (args) => {
        const cwd = process.cwd();
        const dryRun = args['dry-run'] === true;
        const asJson = args.json === true;
        const nonInteractive = args.yes === true;
        const log = (msg = ''): void => {
            // In --json mode keep stdout clean for the final summary object;
            // route progress to stderr.
            if (asJson) process.stderr.write(`${msg}\n`);
            else process.stdout.write(`${msg}\n`);
        };

        let npmrc = await loadNpmrc(cwd);
        const defaultRegistry = args.registry ?? process.env.npm_config_registry ?? npmrc.registry ?? DEFAULT_REGISTRY;

        // 1. Auth gate — whoami first; only login when the token is dead/missing.
        let username: string | undefined;
        try {
            username = await ensureAuthenticated({
                npmrc,
                registry: defaultRegistry,
                cwd,
                nonInteractive,
                dryRun,
                otp: args.otp,
                log,
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (asJson) process.stdout.write(`${JSON.stringify({ ok: false, error: 'auth', message: msg })}\n`);
            else console.error(msg);
            return process.exit(1);
        }
        // Login may have written a fresh token — reload so the probes/ops use it.
        npmrc = await loadNpmrc(cwd);
        if (username) log(`gjsify onboard: authenticated as ${username}`);

        // Repository: flag wins, else infer from the origin remote.
        let repository = args.repository;
        if (!repository) {
            const r = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd, encoding: 'utf8' });
            if (r.status === 0) repository = parseRepoFromGitRemote(r.stdout) ?? undefined;
        }
        if (!repository || !validateRepository(repository)) {
            const msg = 'gjsify onboard: could not determine the GitHub repository — pass --repository owner/repo.';
            if (asJson) process.stdout.write(`${JSON.stringify({ ok: false, error: 'repository', message: msg })}\n`);
            else console.error(msg);
            return process.exit(1);
        }
        const workflow = normalizeWorkflowFile(args.workflow);
        const environment = args.environment;

        // 2. Enumerate the publishable packages (non-private), from every source
        //    that applies to this repo, then filter by name.
        const root = resolveRepoRoot(cwd);
        let all: Workspace[];
        let sources: string;
        try {
            if (args.packages && args.packages.length > 0) assertEveryPatternMatches(root, args.packages);
            const found = collectOnboardPackages(root, cwd, { patterns: args.packages });
            all = found.packages;
            sources = describeSources(found.sources);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (asJson) process.stdout.write(`${JSON.stringify({ ok: false, error: 'discovery', message: msg })}\n`);
            else console.error(msg);
            return process.exit(1);
        }
        const selected = filterWorkspaces(all, {
            noPrivate: true,
            include: args.include,
            exclude: args.exclude,
        }).filter((ws) => ws.name);
        if (selected.length === 0) {
            const msg =
                `gjsify onboard: no publishable packages found under ${root} ` +
                `(discovered ${all.length}${sources ? ` — ${sources}` : ''}). ` +
                (all.length > 0
                    ? 'Every discovered package is private or was filtered out by --include/--exclude.'
                    : 'Pass --packages with a directory glob if this repo has no workspace manifest.');
            if (asJson) process.stdout.write(`${JSON.stringify({ ok: false, error: 'no-packages', message: msg })}\n`);
            else console.error(msg);
            return process.exit(1);
        }

        // Every selected package must AGREE that it lives here. A workspace of
        // this repo is not the same claim as a package published from it —
        // `gjsify/ts-for-gir` has ~703 generated `@girs/*` workspaces that
        // publish from `gjsify/types`, and trusting those for the wrong
        // workflow breaks exactly the release this sweep exists to protect.
        try {
            assertRepositoryAgreement(selected, repository);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (asJson) {
                process.stdout.write(`${JSON.stringify({ ok: false, error: 'foreign-repository', message: msg })}\n`);
            } else {
                console.error(msg);
            }
            return process.exit(1);
        }

        // The blast radius of a sweep that writes to npm is exactly this list,
        // so say where it came from — a total alone cannot distinguish the right
        // set from a plausible wrong one.
        log(`gjsify onboard: root=${root} | ${sources}`);
        log(
            `gjsify onboard: ${selected.length} of ${all.length} package(s) selected | repo=${repository} workflow=${workflow}`,
        );
        if (dryRun) log('(dry-run — nothing will be published or configured)');
        log();

        // Shared OTP provider + trust requester, built ONCE up front so the
        // state-READ probes AND the act-phase writes share ONE OTP (typed once
        // for the whole sweep, cache-first — the file cache in utils/npm-otp.ts
        // extends that reuse across sibling `gjsify` invocations). The provider
        // is scoped to the default registry so the file cache keys correctly.
        const otpProvider = new OtpProvider(args.otp, nonInteractive ? async () => '' : undefined, {
            registry: defaultRegistry,
        });
        const trustRequest = createTrustRequester({ npmrc, otpProvider });

        // 3. Determine per-package state. Reads run through the SAME
        // `TrustRequester` path `gjsify trust` uses (identical endpoint + auth +
        // OTP handling) — so a 2FA-gated trust-state read is answered with the
        // shared code instead of the plain-fetch 401→`unreadable` cascade
        // (task #60). The first read is serial (prompts for the shared OTP once,
        // before the burst); the rest run at a SMALL concurrency cap so a single
        // token never faces a 127-wide parallel read.
        const plans = await probeAllTrustStates(trustRequest, selected, Math.max(1, args.concurrency), {
            registryOverride: args.registry,
            npmrc,
            repository,
            workflow,
        });

        // Summary table (published✓ / trusted✓ vs work to do).
        const toPublish = plans.filter((p) => p.action === 'publish-and-trust');
        const toTrust = plans.filter((p) => p.action === 'trust');
        const done = plans.filter((p) => p.action === 'skip');
        const blocked = plans.filter((p) => p.action === 'blocked');
        // A 703-package sweep prints 703 rows of "nothing to do" and buries the
        // handful that matter. Rows needing WORK are always listed; the finished
        // ones only under --verbose. The counts below cover all of them either
        // way — a row can be omitted from the listing, never from the tally.
        for (const p of plans) {
            if (p.action === 'skip' && args.verbose !== true) continue;
            log(`  ${statusCell(p)}  ${p.ws.name}`);
        }
        if (!args.verbose && done.length > 0) log(`  (${done.length} already published + trusted — pass -v to list)`);
        log();
        log(
            `Plan: ${done.length} already done, ${toPublish.length} to publish+trust, ${toTrust.length} to trust, ${blocked.length} unreadable.`,
        );
        // Name the cause when the unreadable ones are throttling rather than a
        // property of those packages. It lands on the TAIL of an alphabetical
        // sweep, which is exactly where it looks like "these packages are
        // special" instead of "we asked too fast".
        const throttled = blocked.filter((p) => p.httpStatus === 429).length;
        if (throttled > 0) {
            log(
                `  ${throttled} of those are npm rate limits (HTTP 429) that outlasted the backoff — ` +
                    'lower --concurrency and re-run; the sweep is idempotent and picks up where it left off.',
            );
        }

        const results: PkgResult[] = [];

        if (dryRun) {
            for (const p of plans) {
                results.push({
                    name: p.ws.name,
                    result:
                        p.action === 'skip' ? 'already-done' : p.action === 'blocked' ? 'failed' : 'skipped-dry-run',
                    detail:
                        p.action === 'publish-and-trust'
                            ? 'would publish + trust'
                            : p.action === 'trust'
                              ? 'would trust'
                              : p.action === 'blocked'
                                ? // Same shape the act phase reports, so a
                                  // `failed` row in a dry-run summary says WHY
                                  // rather than only that it did not succeed.
                                  `state HTTP ${p.httpStatus}`
                                : undefined,
                });
            }
            // A dry-run whose whole job is to REPORT THE PLAN must not exit 0
            // having failed to compute it. Every unreadable package is counted
            // as a failure here: run without a token, every trust read is a 401
            // and the summary is `0 to publish+trust, 0 to trust` — a plan that
            // was never determined, printed in the shape of a plan that found
            // nothing to do. Measured on `gjsify/types`: 703 packages, 703
            // unreadable, exit 0.
            finish(results, plans, {
                asJson,
                dryRun,
                failed: blocked.length,
                root,
                sources,
                discovered: all.length,
            });
            return;
        }

        // 4. Act on the gaps, minimally. Publishes + trust POSTs run SERIALLY so
        // the shared OTP is prompted at most once (and reused everywhere) —
        // reusing the `otpProvider` + `trustRequest` built for the probe phase.
        const trustBody = githubTrustBody({ repository, workflow, environment });

        let failed = 0;
        for (const p of plans) {
            if (p.action === 'skip') {
                results.push({ name: p.ws.name, result: 'already-done' });
                continue;
            }
            if (p.action === 'blocked') {
                log(`→ ${p.ws.name}: cannot read trust state (HTTP ${p.httpStatus}) — skipped`);
                results.push({ name: p.ws.name, result: 'failed', detail: `state HTTP ${p.httpStatus}` });
                failed++;
                continue;
            }

            let publishedNow = false;
            if (p.action === 'publish-and-trust') {
                log(`→ ${p.ws.name}: building + publishing…`);
                try {
                    if (args.build !== false) await buildIfPresent(p.ws, log);
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    log(`  build failed: ${msg}`);
                    results.push({ name: p.ws.name, result: 'failed', detail: `build: ${msg}` });
                    failed++;
                    continue;
                }
                const pub = await publishWorkspace({
                    wsDir: p.ws.location,
                    tag: 'latest',
                    access: args.access,
                    provenance: false,
                    tolerate: true, // a concurrent/racey publish is harmless
                    tolerateUntrustedNew: false,
                    trustedFlag: undefined,
                    registry: p.registry,
                    verbose: false,
                    json: false,
                    otpProvider,
                    seedOtpFirst: false,
                });
                if (!pub.ok) {
                    const detail = describePublishFailure(pub);
                    log(`  publish failed: ${detail}`);
                    results.push({ name: p.ws.name, result: 'failed', detail: `publish: ${detail}` });
                    failed++;
                    continue;
                }
                publishedNow = pub.action !== 'skipped-untrusted-new';
                log(`  published ${pub.name}@${'version' in pub ? pub.version : ''}`);
            }

            // Configure the Trusted Publisher. Through the rate-limit-aware
            // wrapper: a 703-package sweep that gets throttled on its READS gets
            // throttled on its WRITES too, and a bare 429 here would be recorded
            // as `trust failed` — a failure attributed to the package rather
            // than to the pacing.
            const created = await requestWaitingOutRateLimit(trustRequest, 'POST', p.url, trustBody);
            if (created.status >= 200 && created.status < 300) {
                log(`  trusted ${p.ws.name}`);
                results.push({
                    name: p.ws.name,
                    result: publishedNow ? 'published+trusted' : 'trusted',
                });
            } else if (created.status === 409) {
                results.push({ name: p.ws.name, result: publishedNow ? 'published+trusted' : 'trusted' });
            } else if (created.status === 404) {
                // Freshly-published package not yet provisioned for trust config.
                log(`  ${p.ws.name}: published but not yet trust-configurable (re-run onboard)`);
                results.push({
                    name: p.ws.name,
                    result: publishedNow ? 'published' : 'failed',
                    detail: 'trust config deferred (404)',
                });
                if (!publishedNow) failed++;
            } else {
                log(`  trust failed (HTTP ${created.status})`);
                results.push({
                    name: p.ws.name,
                    result: 'failed',
                    detail: `trust HTTP ${created.status}`,
                });
                failed++;
            }
        }

        finish(results, plans, { asJson, dryRun, failed, root, sources, discovered: all.length });
    },
};

/** Print the summary + exit with the right code. */
function finish(
    results: PkgResult[],
    plans: PkgPlan[],
    opts: {
        asJson: boolean;
        dryRun: boolean;
        failed?: number;
        /** Repo root the package set was resolved against. */
        root: string;
        /** Rendered enumeration sources + counts — the sweep's blast radius. */
        sources: string;
        /** How many packages discovery found BEFORE --include/--exclude. */
        discovered: number;
    },
): void {
    const failed = opts.failed ?? 0;
    if (opts.asJson) {
        process.stdout.write(
            `${JSON.stringify(
                {
                    ok: failed === 0,
                    dryRun: opts.dryRun,
                    // `root`/`sources`/`discovered` travel with the summary so a
                    // caller can check WHICH tree was swept, not just that a
                    // sweep reported itself finished.
                    root: opts.root,
                    sources: opts.sources,
                    discovered: opts.discovered,
                    total: plans.length,
                    published: results.filter((r) => r.result === 'published' || r.result === 'published+trusted')
                        .length,
                    trusted: results.filter((r) => r.result === 'trusted' || r.result === 'published+trusted').length,
                    alreadyDone: results.filter((r) => r.result === 'already-done').length,
                    failed,
                    results,
                },
                null,
                2,
            )}\n`,
        );
    } else {
        const line = opts.dryRun
            ? failed > 0
                ? `Dry-run INCOMPLETE — nothing changed, but ${failed} package(s) had an unreadable state, ` +
                  'so the plan above does not cover them. Authenticate (`gjsify login`) and re-run.'
                : 'Dry-run complete — nothing changed.'
            : `Done: ${results.filter((r) => r.result.includes('published')).length} published, ` +
              `${results.filter((r) => r.result === 'trusted' || r.result === 'published+trusted').length} trusted, ` +
              `${results.filter((r) => r.result === 'already-done').length} already done, ${failed} failed.`;
        process.stdout.write(`\n${line}\n`);
    }
    process.exit(failed > 0 ? 1 : 0);
}

/** A compact per-package status cell for the summary table. */
function statusCell(p: PkgPlan): string {
    switch (p.action) {
        case 'skip':
            return 'published✓ trusted✓';
        case 'trust':
            return 'published✓ trust…  ';
        case 'publish-and-trust':
            return 'publish…   trust… ';
        case 'blocked':
            return `unreadable (${p.httpStatus})`;
    }
}

/**
 * Run the whoami liveness check, and only run the login flow when the token is
 * dead/missing. Returns the authenticated username. Throws on a non-interactive
 * gate that would need input.
 */
async function ensureAuthenticated(ctx: {
    npmrc: NpmrcConfig;
    registry: string;
    cwd: string;
    nonInteractive: boolean;
    dryRun: boolean;
    otp?: string;
    log: (msg?: string) => void;
}): Promise<string | undefined> {
    const { npmrc, registry, cwd, nonInteractive, dryRun, otp, log } = ctx;
    // A live token short-circuits — no credential prompt.
    if (hasAnyCredential(npmrc)) {
        try {
            const who = await whoami(registry, npmrc);
            if (who.username) return who.username;
        } catch {
            /* fall through to the login path */
        }
    }
    // Token dead or missing.
    if (dryRun) {
        log('gjsify onboard: no live npm token — dry-run continues (state reads may be limited).');
        return undefined;
    }
    if (nonInteractive) {
        throw new Error(
            'gjsify onboard: not authenticated and --yes was passed — run `gjsify login` first (or omit --yes to log in interactively).',
        );
    }
    log('gjsify onboard: no live npm token — logging in…');
    try {
        const res = await runLogin({ registry, otp, cwd });
        return res.username;
    } catch (err) {
        if (err instanceof LoginError) throw new Error(err.message);
        throw err;
    }
}

/** Run the package's `build` script (if it declares one) before publishing. */
async function buildIfPresent(ws: Workspace, log: (msg?: string) => void): Promise<void> {
    const scripts = (ws.manifest.scripts as Record<string, string> | undefined) ?? {};
    if (typeof scripts.build !== 'string') return; // nothing to build
    const pm = detectPackageManager();
    const argv = ['run', 'build'];
    log(`  $ ${pm} ${argv.join(' ')}`);
    // Through `spawnToCompletion`, which resolves the package manager the way
    // the rest of the CLI does. `detectPackageManager()` returns `npm` on every
    // non-GJS host, and a bare `spawn('npm', …)` is ENOENT on Windows — npm is
    // a `.cmd` shim that `CreateProcess` never finds (see
    // utils/win32-command.ts). This is the pre-publish build, so the break
    // landed between "about to publish" and the publish itself.
    //
    // `completion: 'return'` — this resolves to a caller that goes on to
    // publish, so under GJS it must not leave a main loop armed.
    const { code } = await spawnToCompletion(pm, argv, {
        completion: 'return',
        cwd: ws.location,
        env: { ...process.env },
    });
    if (code !== 0) throw new Error(`build exited with code ${code}`);
}

/** Human-readable reason for a failed publish outcome. */
function describePublishFailure(pub: Awaited<ReturnType<typeof publishWorkspace>>): string {
    switch (pub.action) {
        case 'otp-required':
            return 'npm required a 2FA code (re-run with --otp, or on a TTY)';
        case 'oidc-failed':
        case 'oidc-no-token':
            return 'OIDC/token auth failed';
        case 'diagnostic':
            return `HTTP 404 (${pub.diag.reason})`;
        case 'error':
            return `HTTP ${pub.status} ${pub.statusText}`;
        default:
            return 'unknown';
    }
}
