// `gjsify trust [packages..]` — configure npm "Trusted Publishers" (OIDC /
// GitHub Actions) for publishable workspace packages, natively (no `npm`).
//
// npm Trusted Publishing is configured PER PACKAGE against the registry's
// trust API (npm >= 11.10). This command sweeps every publishable workspace
// (same discovery as `gjsify foreach` / `publish`), skips packages already
// trusted for this repo+workflow, reports unpublished ones separately, and
// POSTs the GitHub config for the rest — so `.github/workflows/release.yml`
// can publish via OIDC with no long-lived NPM_TOKEN.
//
// 2FA: the registry challenges with 401 + `www-authenticate: otp`. We send a
// TOTP via the `npm-otp` header (prompted on demand, or `--otp`), matching
// `gjsify login`'s legacy/header-OTP path — no browser web-auth flow. After
// one successful OTP the registry opens a ~5-min skip window, so subsequent
// packages go through without re-prompting; when it lapses we re-prompt.
//
// Reference: refs/npm-cli/lib/trust-cmd.js + lib/commands/trust/github.js.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_REGISTRY, buildHeaders, registryFor, whoami, type NpmrcConfig } from '@gjsify/npm-registry';
import { discoverWorkspaces, filterWorkspaces } from '@gjsify/workspace';
import { mergePublishables } from '../utils/publishable-packages.js';
import type { Command } from '../types/index.js';
import { hasAnyCredential, loadNpmrc } from '../utils/load-npmrc.js';
import { OtpProvider, withOtpRetry } from '../utils/npm-otp.js';
import {
    classifyTrustList,
    githubTrustBody,
    normalizeWorkflowFile,
    parseRepoFromGitRemote,
    trustUrl,
    validateRepository,
    type TrustEntry,
} from '../utils/trust-registry.js';

interface TrustOptions {
    packages?: string[];
    repository?: string;
    workflow: string;
    environment?: string;
    registry?: string;
    otp?: string;
    'dry-run'?: boolean;
    force?: boolean;
    list?: boolean;
    'no-private'?: boolean;
}

export const trustCommand: Command<unknown, TrustOptions> = {
    command: 'trust [packages..]',
    description:
        'Configure npm Trusted Publishers (OIDC/GitHub Actions) for publishable workspace packages so release.yml can publish without a token. Native — no `npm` needed. Incremental: skips already-configured packages.',
    builder: (yargs) =>
        yargs
            .positional('packages', {
                description: 'Optional package-name globs to limit the sweep (default: all publishable workspaces).',
                type: 'string',
                array: true,
            })
            .option('repository', {
                description: 'GitHub repo as `owner/repo`. Default: inferred from the `origin` git remote.',
                type: 'string',
            })
            .option('workflow', {
                description: 'Workflow filename allowed to publish (basename only).',
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
                description: 'npm 2FA one-time code; sent as `npm-otp`. Prompted on demand if omitted.',
                type: 'string',
            })
            .option('dry-run', {
                description: 'List what would be configured without writing anything.',
                type: 'boolean',
                default: false,
            })
            .option('force', {
                description: 'Re-POST the config even for packages already trusted for this repo+workflow.',
                type: 'boolean',
                default: false,
            })
            .option('list', {
                description: 'Only report each package’s current trust state; configure nothing.',
                type: 'boolean',
                default: false,
            })
            .option('private', {
                description: 'Include private workspaces (default false — private packages are not publishable).',
                type: 'boolean',
                default: false,
            }),
    handler: async (args) => {
        const cwd = process.cwd();
        const npmrc = await loadNpmrc(cwd);

        if (!hasAnyCredential(npmrc)) {
            console.error('gjsify trust: no npm token configured. Run `gjsify login` first.');
            // `return` — a bare `process.exit()` is deferred under GJS and the
            // handler would keep going without credentials.
            return process.exit(1);
        }

        // Pre-flight: a present-but-DEAD token would otherwise surface as a
        // confusing per-package `401 "You must be logged in to publish
        // packages"`. Probe `/-/whoami` once and fail early with the real fix.
        // (Skipped for --dry-run, which never writes.) `whoami` throws on a
        // 401/non-2xx and returns `{}` on a dead-but-200 token — both are dead.
        const probeRegistry = args.registry ?? process.env.npm_config_registry ?? npmrc.registry ?? DEFAULT_REGISTRY;
        if (args['dry-run'] !== true) {
            let who: { username?: string };
            try {
                who = await whoami(probeRegistry, npmrc);
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                console.error(
                    `gjsify trust: npm auth check failed (${msg}).\n` +
                        'Your ~/.npmrc token is dead or revoked — refresh it with `npm login`, then re-run.\n' +
                        '(`gjsify trust` uses the ~/.npmrc bearer token directly — unlike `npm trust`, which logs in via the browser.)',
                );
                return process.exit(1);
            }
            if (!who.username) {
                console.error(
                    'gjsify trust: your npm token appears dead or revoked (registry returned an empty whoami).\n' +
                        'Refresh it with `npm login`, then re-run.',
                );
                // `return` — see the deferred-exit note on the guard above.
                return process.exit(1);
            }
            console.log(`gjsify trust: authenticated as ${who.username}`);
        }

        // Repository: flag wins, else infer from the origin remote.
        let repository = args.repository;
        if (!repository) {
            const r = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd, encoding: 'utf8' });
            if (r.status === 0) repository = parseRepoFromGitRemote(r.stdout) ?? undefined;
        }
        if (!repository) {
            console.error(
                'gjsify trust: could not determine the GitHub repository.\n' +
                    'Pass --repository owner/repo (no `origin` remote to infer from).',
            );
            // `return` — see the deferred-exit note on the guard above.
            return process.exit(1);
        }
        if (!validateRepository(repository)) {
            console.error(`gjsify trust: --repository must be "owner/repo", got "${repository}".`);
            // `return` — see the deferred-exit note on the guard above.
            return process.exit(1);
        }

        const workflow = normalizeWorkflowFile(args.workflow);
        const environment = args.environment;
        const listOnly = args.list === true;
        const dryRun = args['dry-run'] === true;
        const force = args.force === true;

        // Warn (don't fail) if the workflow file isn't present — the trust
        // config is still valid, but a typo'd workflow name silently never
        // publishes, so surface it.
        const wfPath = join(cwd, '.github', 'workflows', workflow);
        if (!existsSync(wfPath)) {
            console.warn(`gjsify trust: note — ${wfPath} not found; configuring trust for "${workflow}" anyway.`);
        }

        // Publishable workspaces: non-private by default, optionally name-filtered.
        const all = discoverWorkspaces(cwd, { includeRoot: true });
        // PLUS the publishable packages/node-gi/* packages (node-gi + gtk-runtime-*),
        // which publish via release.yml but are NOT root workspaces, so
        // discoverWorkspaces misses them and their Trusted Publisher would never get
        // configured. Dedup by name so a real workspace always wins.
        const merged = mergePublishables(all, cwd);
        const selected = filterWorkspaces(merged, {
            noPrivate: args.private !== true,
            include: args.packages && args.packages.length > 0 ? args.packages : undefined,
        }).filter((ws) => ws.name);

        if (selected.length === 0) {
            console.error('gjsify trust: no publishable packages matched.');
            // `return` — see the deferred-exit note on the guard above.
            return process.exit(1);
        }

        console.log(`gjsify trust: ${selected.length} package(s) | repo=${repository} workflow=${workflow}`);
        if (dryRun) console.log('(dry-run — nothing will be written)');
        console.log();

        // Cache-first OTP across the whole sweep (shared helper). Each request
        // tries WITHOUT an OTP first (npm's ~5-min 2FA-skip window covers the
        // packages after the first success) and only sends a code when actually
        // challenged: the cached `--otp` / last-typed code first, then a fresh
        // prompt when npm rejects it. See utils/npm-otp.ts.
        const otpProvider = new OtpProvider(args.otp);
        const request = createTrustRequester({ npmrc, otpProvider });

        let ok = 0;
        let skipped = 0;
        let unpublished = 0;
        let failed = 0;
        const needsPublish: string[] = [];
        const failures: string[] = [];

        for (const ws of selected) {
            const name = ws.name;
            const registry = args.registry ?? registryFor(name, npmrc) ?? DEFAULT_REGISTRY;
            const url = trustUrl(registry, name);
            process.stdout.write(`→ ${name.padEnd(42)} `);

            // Read current state.
            const listed = await request('GET', url);
            const state = classifyTrustList(listed.status, listed.json, { repository, workflow });

            if (listOnly) {
                if (state === 'trusted') console.log('trusted');
                else if (state === 'unpublished') console.log('unpublished');
                else if (state === 'auth-required') console.log('auth-required (could not read)');
                else if (state === 'untrusted') console.log('not trusted');
                else console.log(`error (HTTP ${listed.status})`);
                continue;
            }

            if (state === 'trusted' && !force) {
                console.log('already configured — skip');
                skipped++;
                continue;
            }
            if (state === 'unpublished') {
                console.log('not on npm yet — needs first-publish, skip');
                unpublished++;
                needsPublish.push(name);
                continue;
            }
            if (dryRun) {
                console.log('would configure');
                ok++;
                continue;
            }

            // Configure.
            const body = githubTrustBody({ repository, workflow, environment });
            const created = await request('POST', url, body);
            if (created.status >= 200 && created.status < 300) {
                console.log('configured');
                ok++;
            } else if (created.status === 409) {
                // Exact config already exists — idempotent, not a failure.
                console.log('already configured (409) — done');
                skipped++;
            } else if (created.status === 404) {
                console.log('not on npm yet — needs first-publish, skip');
                unpublished++;
                needsPublish.push(name);
            } else {
                console.log(`FAILED (HTTP ${created.status})`);
                failed++;
                failures.push(`${name} — HTTP ${created.status}${created.text ? `: ${firstLine(created.text)}` : ''}`);
            }
        }

        if (listOnly) return;

        console.log();
        console.log(
            `Done: ${ok} ${dryRun ? 'would-configure' : 'configured'}, ${skipped} already-configured, ${unpublished} unpublished, ${failed} failed.`,
        );
        if (needsPublish.length > 0) {
            console.log('Need a first publish before they can be trust-configured (then re-run `gjsify trust`):');
            for (const n of needsPublish) console.log(`  ${n}`);
        }
        if (failures.length > 0) {
            console.log(
                'Failed (re-run `gjsify trust` — it is incremental; usually a lapsed 2FA window or rate-limit):',
            );
            for (const f of failures) console.log(`  ${f}`);
            process.exit(1);
        }
    },
};

/** Parsed result of a trust-registry request. */
export interface TrustRequestResult {
    status: number;
    json: unknown;
    text: string;
    /**
     * Response headers, so a caller can honour npm's own `Retry-After` on a 429
     * instead of guessing a backoff. Optional because test doubles construct this
     * shape by hand and a missing header is a well-defined "it said nothing".
     */
    headers?: Headers;
}

/** A `(method, url, body?) => TrustRequestResult` function bound to a registry auth + OTP context. */
export type TrustRequester = (method: string, url: string, body?: unknown) => Promise<TrustRequestResult>;

/**
 * Build a trust-registry requester bound to an npmrc + a shared
 * {@link OtpProvider}. Each request runs through `withOtpRetry` so a 2FA
 * challenge reuses the cached code before prompting — the same instance passed
 * to `createTrustRequester` and to the publish flow shares ONE OTP across a
 * whole `gjsify onboard` sweep.
 */
export function createTrustRequester(ctx: { npmrc: NpmrcConfig; otpProvider: OtpProvider }): TrustRequester {
    return async (method, url, body) => {
        const doFetch = (code?: string): Promise<Response> => {
            const headers = buildHeaders(url, { npmrc: ctx.npmrc });
            headers['accept'] = 'application/json';
            if (body !== undefined) headers['content-type'] = 'application/json';
            if (code) headers['npm-otp'] = code;
            const init: RequestInit = { method, headers };
            if (body !== undefined) init.body = JSON.stringify(body);
            return fetch(url, init);
        };
        const res = await withOtpRetry(doFetch, ctx.otpProvider);
        const text = await res.text().catch(() => '');
        let json: unknown = undefined;
        try {
            json = text ? JSON.parse(text) : undefined;
        } catch {
            /* non-JSON body — leave json undefined */
        }
        return { status: res.status, json, text, headers: res.headers };
    };
}

function firstLine(s: string): string {
    return s.split('\n')[0].slice(0, 200);
}

// Re-export so consumers/tests can reach the entry config shape.
export type { TrustEntry };
