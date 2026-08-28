// `gjsify onboard [--dry-run] [--otp <code>] [--registry <url>] [--json] [--yes]`
//
// One command that ensures EVERY publishable `@gjsify/*` workspace is both
// PUBLISHED on npm AND has a Trusted Publisher configured for this repo's
// `release.yml`. It does the minimum work — publishing/trusting only what's
// missing — and folds the whole manual bootstrap sequence documented in
// AGENTS.md ("New @gjsify/* package: first-publish + Trusted Publisher
// bootstrap") into a single idempotent sweep:
//
//   1. Auth gate — `whoami` first. If the token is live, proceed without asking
//      for credentials; only when it is dead/missing do we run the `gjsify
//      login` flow (unless `--yes` on a non-TTY, which fails clearly).
//   2. Enumerate publishable workspaces (non-private). `@girs/*` is excluded
//      by DEFAULT, not by rule: in this repo those are third-party type
//      packages nobody here publishes. `--include '@girs/*'` selects them,
//      which is what ts-for-gir needs — its `@girs/*` workspaces ARE its
//      publishables, a new GNOME cycle mints a dozen new npm names, and
//      gjsify/types publishes them over OIDC, which cannot create a name that
//      does not exist yet. The release script there names this command as the
//      way to bootstrap them; until now the command could not select them.
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
// Re-running when everything is already published + trusted does nothing and
// exits 0. `--dry-run` reports the plan and changes nothing.

import { spawnSync } from 'node:child_process';
import { DEFAULT_REGISTRY, whoami, type NpmrcConfig } from '@gjsify/npm-registry';
import { discoverWorkspaces, filterWorkspaces, type Workspace } from '@gjsify/workspace';
import { mergePublishables } from '../utils/publishable-packages.js';
import type { Command } from '../types/index.js';
import { hasAnyCredential, loadNpmrc } from '../utils/load-npmrc.js';
import { OtpProvider } from '../utils/npm-otp.js';
import { publishWorkspace } from './publish.js';
import { createTrustRequester } from './trust.js';
import { runLogin, LoginError } from './login.js';
import { detectPackageManager } from './workspace.js';
import { spawnToCompletion } from '../utils/spawn.js';
import { findWorkspaceRoot } from '../utils/workspace-root.js';
import {
    githubTrustBody,
    normalizeWorkflowFile,
    parseRepoFromGitRemote,
    validateRepository,
} from '../utils/trust-registry.js';
import { DEFAULT_PROBE_CONCURRENCY, probeAllTrustStates, type PkgPlan } from '../utils/onboard-probe.js';

interface OnboardOptions {
    include?: string[];
    repository?: string;
    workflow: string;
    environment?: string;
    registry?: string;
    otp?: string;
    concurrency: number;
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
        'Ensure every publishable @gjsify/* workspace is both published on npm and has a Trusted Publisher configured — publishing/trusting only what is missing, one shared OTP across the whole sweep. Idempotent.',
    builder: (yargs) =>
        yargs
            .option('include', {
                description:
                    "Only onboard workspaces matching these name globs. Passing any pattern also lifts the default `@girs/*` exclusion, so `--include '@girs/*'` is how a ts-for-gir style repo bootstraps its generated type packages.",
                type: 'array',
                string: true,
            })
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

        // 2. Enumerate publishable workspaces (non-private, exclude @girs/*).
        const root = findWorkspaceRoot(cwd) ?? cwd;
        // Non-workspace publishables (packages/{node-gi,napi}/*) publish through
        // release.yml but `discoverWorkspaces` cannot see them — without this
        // merge the sweep reports "all done" while a package that was never
        // published is simply absent from the list.
        const all = mergePublishables(discoverWorkspaces(root, { includeRoot: true }), cwd);
        // `@girs/*` is excluded by default because in THIS repo they are
        // third-party dependencies. An explicit `--include` means the caller
        // knows which packages are theirs, so the default no longer applies —
        // otherwise `--include '@girs/*'` would silently select nothing, which
        // is the failure mode a bootstrap command can least afford.
        const include = args.include?.filter((pattern) => pattern.length > 0);
        const exclude = include && include.length > 0 ? undefined : ['@girs/*'];
        const selected = filterWorkspaces(all, { noPrivate: true, include, exclude }).filter((ws) => ws.name);
        if (selected.length === 0) {
            const msg =
                include && include.length > 0
                    ? `gjsify onboard: no publishable workspace matches --include ${include.join(' ')}.`
                    : 'gjsify onboard: no publishable workspace packages found.';
            if (asJson) process.stdout.write(`${JSON.stringify({ ok: false, error: 'no-packages', message: msg })}\n`);
            else console.error(msg);
            return process.exit(1);
        }

        log(`gjsify onboard: ${selected.length} package(s) | repo=${repository} workflow=${workflow}`);
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
        for (const p of plans) log(`  ${statusCell(p)}  ${p.ws.name}`);
        log();
        log(
            `Plan: ${done.length} already done, ${toPublish.length} to publish+trust, ${toTrust.length} to trust, ${blocked.length} unreadable.`,
        );

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
                              : undefined,
                });
            }
            finish(results, plans, { asJson, dryRun });
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
                    await buildIfPresent(p.ws, log);
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
                    access: 'public',
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

            // Configure the Trusted Publisher.
            const created = await trustRequest('POST', p.url, trustBody);
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

        finish(results, plans, { asJson, dryRun, failed });
    },
};

/** Print the summary + exit with the right code. */
function finish(
    results: PkgResult[],
    plans: PkgPlan[],
    opts: { asJson: boolean; dryRun: boolean; failed?: number },
): void {
    const failed = opts.failed ?? 0;
    if (opts.asJson) {
        process.stdout.write(
            `${JSON.stringify(
                {
                    ok: failed === 0,
                    dryRun: opts.dryRun,
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
            ? 'Dry-run complete — nothing changed.'
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
